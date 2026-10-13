import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [target] = process.argv.slice(2);
if (!['vuetify3', 'vuetify4'].includes(target)) throw new Error('Choose vuetify3 or vuetify4.');
if (process.versions.node !== '24.19.0') throw new Error('Use Node 24.19.0.');
const require = createRequire(import.meta.url);
const requireTarget = createRequire(join(root, 'targets', target, 'package.json'));
const playwrightRoot = process.env.PILOT_PLAYWRIGHT_PATH || dirname(requireTarget.resolve('playwright/package.json'));
const { chromium } = require(playwrightRoot);
// Playwright's library exports Chromium; assertions below use Node and explicit polling,
// so the separately versioned @playwright/test runner is unnecessary.
const artifacts = join(root, 'artifacts', target);
await mkdir(artifacts, { recursive: true });
const profile = await mkdtemp(join(artifacts, 'profile-'));
const extension = join(root, 'targets', target, 'dist');
const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
assert.ok(manifest.content_security_policy.extension_pages.split('; ').includes("script-src 'self' 'wasm-unsafe-eval'"));
const report = {
  target, started: new Date().toISOString(), node: process.versions.node,
  playwright: require(join(playwrightRoot, 'package.json')).version,
  csp: manifest.content_security_policy.extension_pages,
  scope: 'Synthetic isolated MV3 pilot only. Sidepanel document at 375x820, not browser-native side-panel chrome. Same production script restrictions; tighter network/frame/style policy. No production wallet, encrypted storage, WebAuthn, hardware, chain, widget implementation or signing proof.',
  dependencies: JSON.parse(await readFile(join(root, 'targets', target, 'package.json'), 'utf8')).dependencies,
  checks: [], errors: [], passed: false,
};
async function hashes(directory, prefix = '') {
  const result = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const key = `${prefix}${entry.name}`;
    if (entry.isDirectory()) Object.assign(result, await hashes(join(directory, entry.name), `${key}/`));
    else result[key] = createHash('sha256').update(await readFile(join(directory, entry.name))).digest('hex');
  }
  return result;
}
report.artifactSha256 = await hashes(extension);
report.inputSha256 = { ...(await hashes(join(root, 'src'), 'src/')), ...(await hashes(join(root, 'public'), 'public/')), ...(await hashes(join(root, 'scripts'), 'scripts/')) };
for (const file of ['package.json', 'tsconfig.json', `targets/${target}/package.json`, `targets/${target}/package-lock.json`]) {
  report.inputSha256[file] = createHash('sha256').update(await readFile(join(root, file))).digest('hex');
}
let context;
async function poll(condition, description, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((done) => setTimeout(done, 30));
  }
  throw new Error(`Timed out: ${description}`);
}
const text = (page, id) => page.getByTestId(id).innerText();
const equal = async (page, id, value) => poll(async () => await text(page, id) === String(value), `${id} = ${value}`);
const click = async (page, id) => { await page.bringToFront(); await page.getByTestId(id).click(); };
const amount = async (page, value) => { await page.bringToFront(); await page.getByTestId('amount').locator('input').fill(value); };
const dispatches = (page) => page.evaluate(() => window.__pilotApproveDispatches);
async function launch() {
  const result = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  report.chromium = result.browser()?.version();
  return result;
}
async function extensionId() {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker');
  return new URL(worker.url()).hostname;
}
async function open(id, surface) {
  const page = await context.newPage();
  await page.setViewportSize(surface === 'sidepanel' ? { width: 375, height: 820 } : { width: 1280, height: 900 });
  page.on('pageerror', (error) => report.errors.push({ surface, kind: 'pageerror', message: error.message }));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      report.errors.push({ surface, kind: 'console', message: message.text() });
    }
  });
  await page.addInitScript(() => {
    window.__pilotViolations = [];
    window.__pilotApproveDispatches = 0;
    // Passive observation only: preserve arguments, return value, and background behavior.
    const sendMessage = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = function (...args) {
      if (args[0]?.namespace === 'gero-migration-pilot' && args[0]?.type === 'approve') window.__pilotApproveDispatches += 1;
      return sendMessage.apply(this, args);
    };
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__pilotViolations.push({ directive: event.effectiveDirective, blockedURI: event.blockedURI });
    });
  });
  await page.goto(`chrome-extension://${id}/${surface}.html`);
  await poll(async () => (await text(page, 'revision')) !== '-1', `${surface} hydrated`);
  return page;
}
async function check(name, run) {
  await run();
  report.checks.push(name);
  console.log(`PASS ${target}: ${name}`);
}
try {
  context = await launch();
  const id = await extensionId();
  const options = await open(id, 'options');
  const sidepanel = await open(id, 'sidepanel');
  report.extensionId = id;
  await check('Two separately built UI documents hydrate from the real MV3 worker', async () => {
    assert.match(await text(options, 'surface'), /options/);
    assert.match(await text(sidepanel, 'surface'), /sidepanel/);
    await equal(options, 'locked', true);
    await equal(sidepanel, 'locked', true);
  });
  await check('Router guard rejects protected deep link while locked', async () => {
    await options.goto(`chrome-extension://${id}/options.html#/approval`);
    await options.getByTestId('home').waitFor();
    assert.equal(new URL(options.url()).hash, '#/');
  });
  await check('Background unlock broadcasts into both reactive app snapshots', async () => {
    await click(options, 'unlock');
    await equal(options, 'locked', false);
    await equal(sidepanel, 'locked', false);
    await click(options, 'approval-link');
    await options.getByTestId('approval-page').waitFor();
    await click(sidepanel, 'approval-link');
    await sidepanel.getByTestId('approval-page').waitFor();
  });
  await check('Each app renders all three precompiled locales and literal @ under CSP', async () => {
    for (const page of [options, sidepanel]) {
      for (const [locale, expected] of [['us', 'English locale loaded'], ['de', 'Deutsche Übersetzung geladen'], ['es', 'Traducción española cargada']]) {
        await page.getByTestId('locale').selectOption(locale);
        await poll(async () => (await text(page, 'localized')).includes(expected), `locale ${locale}`);
        assert.match(await text(page, 'localized'), /support@example\.invalid/);
      }
      await page.getByTestId('locale').selectOption('us');
    }
  });
  await check('Invalid asynchronous validation dispatches zero approvals', async () => {
    for (const value of ['', '0', '-1', '11', 'not-a-number']) {
      await amount(options, value);
      await click(options, 'submit');
      await equal(options, 'pending', false);
      assert.equal(await text(options, 'approvals'), '0');
      assert.equal(await dispatches(options), 0);
      assert.match(await text(options, 'result'), /valid amount/);
    }
  });
  await check('Pending submission is disabled and accepted exactly once after validation/authorization', async () => {
    await amount(options, '2');
    await click(options, 'submit');
    await equal(options, 'pending', true);
    assert.equal(await options.getByTestId('submit').isDisabled(), true);
    assert.equal(await text(options, 'approvals'), '0');
    assert.equal(await dispatches(options), 0);
    await equal(options, 'approvals', 1);
    await equal(sidepanel, 'approvals', 1);
    await equal(options, 'in-flight', 0);
    assert.equal(await text(options, 'approvals'), '1');
    assert.equal(await dispatches(options), 1);
  });
  await check('Cancel and edits invalidate pending validation and authorization', async () => {
    for (const stage of ['validating', 'authenticating']) {
      for (const action of ['cancel', 'edit']) {
        await amount(options, '3');
        await click(options, 'submit');
        await poll(async () => (await text(options, 'result')).toLowerCase().includes(stage === 'validating' ? 'validating' : 'authorization'), stage);
        assert.equal(await dispatches(options), 1, 'Old operation has not dispatched before cancellation');
        // Dispatch immediately at the observed pending phase. Pointer actionability waits
        // can outlive a short async phase in a background extension document.
        if (action === 'cancel') await options.getByTestId('cancel').dispatchEvent('click');
        else await amount(options, '4');
        await equal(options, 'in-flight', 0);
        assert.equal(await text(options, 'approvals'), '1', `Cancellation during ${stage} by ${action}`);
        assert.equal(await dispatches(options), 1, `No stale dispatch during ${stage} by ${action}`);
        await equal(options, 'pending', false);
      }
    }
  });
  await check('Wallet/network replacement during validation and authorization dispatches nothing; fresh approval is required', async () => {
    for (const stage of ['validating', 'authorization']) for (const action of ['wallet-change', 'network-change']) {
      await amount(options, '3');
      await click(options, 'submit');
      await poll(async () => (await text(options, 'result')).toLowerCase().includes(stage), `${stage} pending`);
      assert.equal(await dispatches(options), 1);
      await sidepanel.getByTestId(action).dispatchEvent('click');
      await equal(options, 'in-flight', 0);
      assert.equal(await text(options, 'approvals'), '1');
      assert.equal(await dispatches(options), 1);
      assert.equal(await text(options, 'wallet'), await text(sidepanel, 'wallet'));
      assert.equal(await text(options, 'network'), await text(sidepanel, 'network'));
    }
    await click(options, 'submit');
    await equal(options, 'approvals', 2);
    await equal(sidepanel, 'approvals', 2);
    assert.equal(await dispatches(options), 2);
  });
  await check('KeepAlive preserves input across actual navigation, pauses timer, and cancels pending work', async () => {
    await amount(options, '7');
    await click(options, 'submit');
    await equal(options, 'pending', true);
    const ticksBefore = Number(await text(options, 'ticks'));
    await options.getByTestId('home-link').dispatchEvent('click');
    await options.getByTestId('home').waitFor();
    await equal(options, 'in-flight', 0);
    await new Promise((done) => setTimeout(done, 500));
    assert.equal(await text(options, 'approvals'), '2');
    assert.equal(await dispatches(options), 2);
    await click(options, 'approval-link');
    await options.getByTestId('approval-page').waitFor();
    assert.equal(await options.getByTestId('amount').locator('input').inputValue(), '7');
    const ticksOnReturn = Number(await text(options, 'ticks'));
    assert.ok(ticksOnReturn - ticksBefore <= 2, 'timer must pause while cached');
    await poll(async () => Number(await text(options, 'ticks')) > ticksOnReturn, 'timer resumed');
    await equal(options, 'pending', false);
  });
  await check('Vuetify dialog opens and closes in both apps', async () => {
    for (const page of [options, sidepanel]) {
      await click(page, 'dialog-open');
      await page.getByTestId('dialog-close').waitFor();
      await click(page, 'dialog-close');
      await page.getByTestId('dialog-close').waitFor({ state: 'hidden' });
    }
  });
  await check('Native custom element receives attributes/signer property and emits token-change', async () => {
    for (const page of [options, sidepanel]) {
      const contract = await page.locator('gero-swap').evaluate(async (node) => ({ mode: node.getAttribute('mode'), network: node.getAttribute('network'), networkId: await node.signer.getNetworkId() }));
      assert.equal(contract.mode, 'native');
      assert.equal(contract.network, `cardano-${await text(page, 'network')}`);
      assert.equal(contract.networkId, 0);
      await click(page, 'swap-contract-event');
      await equal(page, 'swap-events', 1);
    }
  });
  await check('Lock during validation and authorization dispatches nothing and evicts protected routes in both apps', async () => {
    for (const stage of ['validating', 'authorization']) {
    if (stage === 'authorization') {
      await click(options, 'unlock');
      await equal(options, 'locked', false);
      await equal(sidepanel, 'locked', false);
      await click(options, 'approval-link');
      await options.getByTestId('approval-page').waitFor();
      await click(sidepanel, 'approval-link');
      await sidepanel.getByTestId('approval-page').waitFor();
    }
    await amount(options, '5');
    await click(options, 'submit');
    await poll(async () => (await text(options, 'result')).toLowerCase().includes(stage), `${stage} pending`);
    assert.equal(await dispatches(options), 2);
    await sidepanel.getByTestId('lock').dispatchEvent('click');
    await options.getByTestId('home').waitFor();
    await sidepanel.getByTestId('home').waitFor();
    await equal(options, 'in-flight', 0);
    assert.equal(await text(options, 'approvals'), '2');
    assert.equal(await dispatches(options), 2);
    }
  });
  await check('Normal journeys produce no CSP violations or page errors under the production script restriction', async () => {
    for (const page of [options, sidepanel]) {
      assert.deepEqual(await page.evaluate(() => window.__pilotViolations), []);
    }
    assert.deepEqual(report.errors, []);
  });
  await options.screenshot({ path: join(artifacts, 'options.png'), fullPage: true });
  await sidepanel.screenshot({ path: join(artifacts, 'sidepanel.png'), fullPage: true });
  const persisted = { revision: await text(options, 'revision'), wallet: await text(options, 'wallet'), network: await text(options, 'network'), approvals: await text(options, 'approvals') };
  await context.close();
  context = await launch();
  const restartId = await extensionId();
  await check('Full browser/worker restart hydrates persisted state without fixture overrides', async () => {
    for (const surface of ['options', 'sidepanel']) {
      const page = await open(restartId, surface);
      for (const [key, value] of Object.entries(persisted)) await equal(page, key, value);
      await equal(page, 'locked', true);
    }
  });
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.failure = error.stack;
  process.exitCode = 1;
  console.error(error);
} finally {
  await context?.close();
  report.finished = new Date().toISOString();
  await writeFile(join(artifacts, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n');
}
