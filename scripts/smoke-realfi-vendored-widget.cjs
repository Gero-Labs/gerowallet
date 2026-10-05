// Run from the wallet repository root with `node scripts/smoke-realfi-vendored-widget.cjs`.
// Requires the local Vite install and Chromium; PLAYWRIGHT_MODULE may point at an existing
// Playwright installation (the shared gerowallet-e2e-tests install is the default fallback).
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const repoRoot = path.resolve(__dirname, '..');
const fixtureUrl = 'http://127.0.0.1:3331/test/realfi-widget/index.html';
const units = {
  usdcx: '1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e345553444378',
  usdrf: '7d9e4a0ee1a3f5d5ff8159ea91a83310cf2795ee7a87170c7aea05ae55534472',
};

function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_MODULE,
    path.resolve(repoRoot, '../gerowallet-e2e-tests/node_modules/playwright'),
    'playwright',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { return require(candidate); } catch { /* Try the next installed test runtime. */ }
  }
  throw new Error('Playwright is unavailable. Set PLAYWRIGHT_MODULE to the installed Playwright package path.');
}

async function waitForServer(server) {
  const deadline = Date.now() + 30_000;
  const url = `${fixtureUrl}?pair=usdcx-usdrf`;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Vite exited early with ${server.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch { /* Vite is still starting. */ }
    await delay(150);
  }
  throw new Error('Timed out waiting for the widget smoke fixture server.');
}

async function main() {
  const { chromium } = loadPlaywright();
  const vite = spawn(process.execPath, [
    path.join(repoRoot, 'node_modules/vite/bin/vite.js'),
    '--config', path.join(repoRoot, 'test/realfi-widget/vite.config.mts'),
    '--host', '127.0.0.1', '--port', '3331', '--strictPort',
  ], { cwd: repoRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser;
  const viteErrors = [];
  // Drain both pipes so a verbose Vite session can never block the child process.
  vite.stdout.on('data', () => {});
  vite.stderr.on('data', (chunk) => viteErrors.push(String(chunk)));

  try {
    await waitForServer(vite);
    browser = await chromium.launch({
      headless: true,
      ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}),
    });

    for (const testCase of [
      { name: 'USDCx → USDrf', query: 'usdcx-usdrf', input: units.usdcx, output: units.usdrf, tickerIn: 'USDCx', tickerOut: 'USDrf' },
      { name: 'lovelace → USDCx', query: 'ada-usdcx', input: 'lovelace', output: units.usdcx, tickerIn: 'ADA', tickerOut: 'USDCx' },
    ]) {
      const page = await browser.newPage({ viewport: { width: 520, height: 900 } });
      const errors = [];
      const metadataUnits = [];
      const quotes = [];
      const unexpectedExternalRequests = [];
      const unhandledMockEndpoints = [];
      let buildCalls = 0;
      page.on('pageerror', (error) => errors.push(error.message));

      await page.route('**/*', async (route) => {
        if (new URL(route.request().url()).origin !== new URL(fixtureUrl).origin) {
          unexpectedExternalRequests.push(route.request().url());
          await route.abort('blockedbyclient');
          return;
        }
        await route.continue();
      });

      await page.route('**/mock/api/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const metadataMatch = url.pathname.match(/\/api\/market\/tokens\/([^/]+)\/metadata$/);

        if (metadataMatch && request.method() === 'GET') {
          const unit = decodeURIComponent(metadataMatch[1]);
          metadataUnits.push(unit);
          const metadata = unit === units.usdcx
            ? { assetId: unit, ticker: 'USDCx', decimals: 6 }
            : { assetId: unit, ticker: 'USDrf', decimals: 6 };
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(metadata) });
          return;
        }

        if (url.pathname.endsWith('/api/aggregator/quote') && request.method() === 'POST') {
          const body = request.postDataJSON();
          quotes.push(body);
          const response = {
            routes: [{
              dex: 'MinswapV2',
              tokenIn: body.tokenIn,
              tokenOut: body.tokenOut,
              amountIn: body.amountIn,
              expectedOutput: '2345678',
              minimumOutput: '2300000',
              verified: true,
            }],
            bestRouteIndex: 0,
          };
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
          return;
        }

        if (url.pathname.endsWith('/api/aggregator/build-tx') && request.method() === 'POST') {
          buildCalls += 1;
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ unsignedTxCbor: '00' }) });
          return;
        }

        if (url.pathname.endsWith('/api/aggregator/supported-dexes')) {
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ routing: ['MinswapV2'], building: ['MinswapV2'] }) });
          return;
        }

        if (url.pathname.endsWith('/api/config/swap')) {
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ limitEnabled: false, experimentalRoutesEnabled: false }) });
          return;
        }

        if (url.pathname.endsWith('/api/aggregator/tokens')) {
          await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
          return;
        }

        unhandledMockEndpoints.push(`${request.method()} ${url.pathname}`);
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ errorCode: 'UNMOCKED_SMOKE_ENDPOINT', message: 'Unexpected widget request in smoke test.' }),
        });
      });

      await page.goto(`${fixtureUrl}?pair=${testCase.query}`);
      await page.locator('gero-swap .gs-card2-title').first().waitFor();
      await page.waitForFunction(({ inTicker, outTicker }) => {
        const cards = [...document.querySelectorAll('gero-swap .gs-card2')];
        return cards.length >= 2 &&
          cards[0].querySelector('.gs-pill-ticker')?.textContent?.trim() === inTicker &&
          cards[1].querySelector('.gs-pill-ticker')?.textContent?.trim() === outTicker;
      }, { inTicker: testCase.tickerIn, outTicker: testCase.tickerOut });

      const widgetUnits = await page.evaluate(() => ({
        tokenIn: window.widgetSmoke?.widget.getAttribute('token-in'),
        tokenOut: window.widgetSmoke?.widget.getAttribute('token-out'),
        signer: window.widgetSmoke?.widget.signer,
      }));
      assert.deepEqual(widgetUnits, { tokenIn: testCase.input, tokenOut: testCase.output, signer: undefined });

      const quoteResponse = page.waitForResponse((response) =>
        response.url().endsWith('/api/aggregator/quote') && response.request().method() === 'POST');
      await page.locator('gero-swap input.gs-amount-input').first().fill('1.234567');
      await quoteResponse;
      await page.waitForFunction(() => document.querySelector('gero-swap .gs-amount-ro')?.textContent?.trim() === '2.3');

      assert.ok(metadataUnits.includes(testCase.output), `${testCase.name}: output token decimals should come from mocked metadata`);
      if (testCase.input !== 'lovelace') {
        assert.ok(metadataUnits.includes(testCase.input), `${testCase.name}: input token decimals should come from mocked metadata`);
      }
      assert.ok(quotes.some((quote) =>
        quote.tokenIn === testCase.input && quote.tokenOut === testCase.output && quote.amountIn === '1234567'),
      `${testCase.name}: quote should use the selected units and 6-decimal base amount`);
      assert.equal(buildCalls, 0, `${testCase.name}: smoke test must not build or fund a transaction`);
      assert.deepEqual(unexpectedExternalRequests, [], `${testCase.name}: the browser must not make external requests`);
      assert.deepEqual(unhandledMockEndpoints, [], `${testCase.name}: every widget API request must be explicitly mocked`);
      assert.deepEqual(errors, [], `${testCase.name}: widget should not throw in the browser`);
      console.log(`PASS actual vendored bundle ${testCase.name}: selected labels and attributes, mocked metadata, quote units, amountIn=1234567, no build/sign.`);
      await page.close();
    }
  } finally {
    if (browser) await browser.close();
    vite.kill();
  }
  if (viteErrors.length) process.stderr.write(viteErrors.join(''));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
