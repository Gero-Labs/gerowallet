// Run: node test/visual-parity/theme-isolation-browser.cjs
// Exercise the real host Vuetify instance and vendored custom element together.
// Own ephemeral server/browser, synthetic tokens only, and no wallet or signer.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '../..');
const output = process.env.VISUAL_PARITY_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'gero-theme-isolation-'));
const report = { passed: false, measurements: {}, pageErrors: [], externalRequests: [], apiRequests: [] };
const sha256 = value => createHash('sha256').update(value).digest('hex');

(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({
    configFile: path.join(__dirname, 'vite.config.mts'), logLevel: 'error',
    // Review worktrees may share dependencies through a Windows junction.
    server: { fs: { allow: [root, fs.realpathSync(path.join(root, 'node_modules'))] } },
  });
  let browser;
  fs.mkdirSync(output, { recursive: true });
  report.bundleSha256 = sha256(fs.readFileSync(path.join(root, 'src/vendor/gero-swap/gero-swap.js')));
  try {
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    const context = await browser.newContext({ viewport: { width: 1100, height: 780 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === origin && url.pathname.startsWith('/theme-test-api/')) {
        report.apiRequests.push({ method: request.method(), path: url.pathname });
        if (request.method() === 'GET' && url.pathname === '/theme-test-api/api/config/swap') {
          return route.fulfill({ json: { experimentalRoutesEnabled: false, limitEnabled: false } });
        }
        return route.fulfill({ status: 500, json: { error: 'Unexpected synthetic widget request' } });
      }
      if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
      report.externalRequests.push(url.origin);
      return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', error => report.pageErrors.push(error.message));
    await page.goto(`${origin}/test/visual-parity/index.html`, { timeout: 60000 });
    await page.getByTestId('chip-primary').waitFor();
    await page.getByRole('button', { name: 'Open overlay', exact: true }).click();
    await page.getByTestId('overlay-primary').waitFor();
    await page.evaluate(() => document.fonts.ready);

    const capture = async name => {
      // Chip/icon transitions can outlast Vue's next tick after a chain switch.
      await page.waitForFunction(() => {
        const channels = getComputedStyle(document.querySelector('.v-application')).getPropertyValue('--v-theme-primary');
        const expected = `rgb(${channels.split(',').map(channel => channel.trim()).join(', ')})`;
        return [['[data-testid="chip-primary"]', 'backgroundColor'], ['[data-testid="icon-button-primary"] .v-icon', 'color'],
          ['[data-testid="overlay-primary"]', 'backgroundColor']].every(([selector, property]) => getComputedStyle(document.querySelector(selector))[property] === expected);
      });
      const measurement = await page.evaluate(() => {
        const color = (selector, property) => getComputedStyle(document.querySelector(selector))[property];
        const host = document.querySelector('.v-application');
        const stylesheet = document.getElementById('vuetify-theme-stylesheet');
        const widget = document.querySelector('gero-swap');
        return {
          primary: getComputedStyle(host).getPropertyValue('--v-theme-primary').trim().replace(/\s/g, ''),
          chip: color('[data-testid="chip-primary"]', 'backgroundColor'),
          icon: color('[data-testid="icon-button-primary"] .v-icon', 'color'),
          overlay: color('[data-testid="overlay-primary"]', 'backgroundColor'),
          hostStyles: stylesheet?.textContent || '',
          hostStylesheetCount: document.querySelectorAll('#vuetify-theme-stylesheet').length,
          widgetStylesheetCount: document.querySelectorAll('#gero-swap-theme-stylesheet').length,
          widgetSwitchColor: widget ? color('gero-swap .gs-switch', 'color') : null,
        };
      });
      const { hostStyles, ...colors } = measurement;
      report.measurements[name] = { ...colors, hostStylesSha256: sha256(hostStyles) };
      return measurement;
    };
    const assertHost = (measurement, baseline, name) => {
      for (const property of ['primary', 'chip', 'icon', 'overlay']) {
        assert.equal(measurement[property], baseline[property], `${name}: widget must preserve host ${property}`);
      }
      assert.equal(measurement.hostStyles, baseline.hostStyles, `${name}: widget must not replace host theme definitions`);
      assert.equal(measurement.hostStylesheetCount, 1, `${name}: retain one host theme stylesheet`);
    };
    const assertWidget = (measurement, name) => {
      assert.equal(measurement.widgetStylesheetCount, 1, `${name}: widget owns a separate theme stylesheet`);
      assert.equal(measurement.widgetSwitchColor, 'rgb(0, 199, 243)', `${name}: widget keeps its cyan accent`);
    };
    const mountWidget = async () => {
      await page.evaluate(origin => {
        const widget = document.createElement('gero-swap');
        widget.setAttribute('mode', 'native');
        widget.setAttribute('network', 'preprod');
        widget.setAttribute('base-url', `${origin}/theme-test-api`);
        widget.setAttribute('token-in', 'lovelace');
        widget.setAttribute('history-mode', 'off');
        widget.tokens = [{ unit: 'lovelace', ticker: 'ADA', decimals: 6, balance: '0' }];
        document.querySelector('.fixture').append(widget);
      }, origin);
      await page.locator('gero-swap .gs-switch').waitFor({ state: 'attached' });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };
    const unmountWidget = async () => {
      await page.evaluate(() => document.querySelector('gero-swap').remove());
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };
    const changeChain = async chain => {
      await page.evaluate(async chain => {
        const { updateVuetifyTheme } = await import('/src/plugins/vuetify.ts');
        updateVuetifyTheme(chain);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }, chain);
    };

    const cardano = await capture('cardano-before-widget');
    assert.equal(cardano.primary, '51,199,221', 'Fixture uses the production Cardano accent');
    assert.equal(cardano.chip, 'rgb(51, 199, 221)');
    assert.equal(cardano.icon, 'rgb(51, 199, 221)');
    assert.equal(cardano.overlay, 'rgb(51, 199, 221)');
    await changeChain('Midnight');
    const midnight = await capture('midnight-before-widget');
    assert.equal(midnight.primary, '167,139,250', 'Fixture uses the production Midnight accent');
    await changeChain('Cardano');
    assertHost(await capture('cardano-restored-before-widget'), cardano, 'Cardano restored');

    await page.addStyleTag({ url: `${origin}/src/vendor/gero-swap/gero-swap.css` });
    await page.addScriptTag({ url: `${origin}/src/vendor/gero-swap/gero-swap.js` });
    await page.evaluate(() => customElements.whenDefined('gero-swap'));
    await mountWidget();
    const first = await capture('cardano-mounted');
    assertHost(first, cardano, 'Initial widget mount');
    assertWidget(first, 'Initial widget mount');

    await unmountWidget();
    assertHost(await capture('cardano-unmounted'), cardano, 'Widget removal');
    await mountWidget();
    const remounted = await capture('cardano-remounted');
    assertHost(remounted, cardano, 'Widget remount');
    assertWidget(remounted, 'Widget remount');

    await changeChain('Midnight');
    const switched = await capture('midnight-mounted');
    assertHost(switched, midnight, 'Midnight chain switch');
    assertWidget(switched, 'Midnight chain switch');
    await unmountWidget();
    await mountWidget();
    const midnightRemounted = await capture('midnight-remounted');
    assertHost(midnightRemounted, midnight, 'Midnight widget remount');
    assertWidget(midnightRemounted, 'Midnight widget remount');

    await changeChain('Cardano');
    const returned = await capture('cardano-returned');
    assertHost(returned, cardano, 'Return to Cardano');
    assertWidget(returned, 'Return to Cardano');
    await unmountWidget();
    assertHost(await capture('cardano-final-unmounted'), cardano, 'Final widget removal');
    assert.deepEqual(report.pageErrors, []);
    assert.deepEqual(report.externalRequests, [], 'No external requests from the isolated widget fixture');
    assert.ok(report.apiRequests.length > 0, 'The actual widget loaded its mocked configuration');
    assert.ok(report.apiRequests.every(request => request.method === 'GET' && request.path === '/theme-test-api/api/config/swap'));
    report.passed = true;
  } finally {
    if (browser) await browser.close();
    await server.close();
    fs.writeFileSync(path.join(output, 'theme-isolation-report.json'), JSON.stringify(report, null, 2));
    console.log(`Theme isolation evidence: ${output}`);
  }
  console.log('Theme isolation passed: host chip/icon/overlay, mount/unmount/remount, Midnight/Cardano, independent widget accent.');
})().catch(error => { console.error(error); process.exitCode = 1; });
