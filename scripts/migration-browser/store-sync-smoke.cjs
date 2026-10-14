/* Production browser integration: no injected wallet state or fixture overrides. */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { randomBytes, createHash } = require('node:crypto');

const repo = path.resolve(__dirname, '../..');
const extension = process.env.STORE_SMOKE_EXTENSION || path.join(repo, 'extension');
const out = process.env.STORE_SMOKE_OUTPUT || path.join(repo, 'output/migration-store-browser');
fs.mkdirSync(out, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gero-migration-store-'));
const password = `Migration-${randomBytes(18).toString('hex')}!`;
const names = ['Migration synthetic A', 'Migration synthetic B'];
function artifactDigest() {
  const digest = createHash('sha256');
  function visit(directory, prefix = '') {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name);
      const relative = `${prefix}${name}`;
      if (fs.statSync(file).isDirectory()) visit(file, `${relative}/`);
      else digest.update(relative).update('\0').update(createHash('sha256').update(fs.readFileSync(file)).digest('hex')).update('\n');
    }
  }
  visit(extension);
  return digest.digest('hex');
}
const report = { startedAt: new Date().toISOString(), profile, extension, checks: [], errors: [], blockedRequests: 0,
  network: 'Offline context, all HTTP routes aborted, dead proxy and DNS blocking; no transaction actions',
  fixtures: 'No store/storage/IndexedDB writes from the harness; wallets created by production UI',
  manifestSha256: createHash('sha256').update(fs.readFileSync(path.join(extension, 'manifest.json'))).digest('hex'),
  artifactSha256: artifactDigest(), nodeVersion: process.version,
  coverageLimits: [
    'Fresh synthetic password wallets only; no existing user profile, live provider, hardware device, transaction signing or submission.',
    'Side-panel document is opened in a browser tab; native browser side-panel chrome is not automated.',
    'Offline wallet login publishes identity before first-restore synchronization completes. Wallet switching is verified at the real background broadcast boundary.',
    'No configured session unlock method on these new wallets: startup intentionally clears a persisted stray lock, separately from password encryption used to protect wallet secrets.',
  ],
  sourceEvidence: [
    { file: 'src/services/walletManager.service.ts', symbol: 'login / loginWallet', explanation: 'Unchanged per-wallet pendingLogins deduplication and first-restore synchronization wait.' },
    { file: 'src/services/websocket.service.ts', symbol: 'waitForSync', explanation: 'Unchanged 300000ms offline synchronization safety timeout.' },
    { file: 'src/chrome/background.ts', symbol: 'module startup', explanation: 'Startup calls walletManager.login and clears isLocked if persisted unlockMethod is absent.' },
  ],
};
let context;
let page;
let stage = 'launch';
const check = name => { report.checks.push(name); console.log(JSON.stringify({ check: name })); };

async function launch() {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, viewport: { width: 1440, height: 1100 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=<-loopback>', '--host-resolver-rules=MAP * ~NOTFOUND'],
  });
  await context.setOffline(true);
  await context.route(/^https?:/, async route => { report.blockedRequests++; await route.abort(); });
  context.on('page', opened => opened.on('pageerror', error => report.errors.push(error.message)));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 30000 });
  report.extensionId = worker.url().split('/')[2];
  report.chromium = context.browser().version();
  return `chrome-extension://${report.extensionId}`;
}

// Independent read-only subscriber to the production worker protocol. It records
// only public identity/lock/collection counts, never credential or seed fields.
async function observe(target) {
  await target.evaluate(() => {
    const state = { walletId: null, walletName: null, network: null, locked: false, wallets: [], updates: 0 };
    const port = chrome.runtime.connect({ name: 'store-sync' });
    port.onMessage.addListener(message => {
      if (message.type !== 'STORE_UPDATE') return;
      const update = message.updates;
      if (message.storeName === 'walletStore') {
        if ('loggedWallet' in update) {
          state.walletId = update.loggedWallet?.id ?? null;
          state.walletName = update.loggedWallet?.name ?? null;
          state.network = update.loggedWallet?.network ?? null;
        }
        if ('isLocked' in update) state.locked = update.isLocked;
        if ('isSyncing' in update) state.syncing = update.isSyncing;
        if ('transactions' in update) state.transactionCount = update.transactions?.length ?? 0;
      }
      if (message.storeName === 'geroStore' && update.wallets) {
        state.wallets = Object.values(update.wallets).map(wallet => ({ id: wallet.id, name: wallet.name, network: wallet.network }));
      }
      state.updates++;
    });
    port.postMessage({ type: 'STORE_SUBSCRIBE', storeName: 'walletStore' });
    port.postMessage({ type: 'STORE_SUBSCRIBE', storeName: 'geroStore' });
    window.__migrationStoreObserver = { state, port };
  });
}
async function snapshot(target) { return target.evaluate(() => ({ ...window.__migrationStoreObserver.state })); }
async function expectState(target, expected) {
  await target.waitForFunction(expected => Object.entries(expected).every(([key, value]) => window.__migrationStoreObserver?.state[key] === value), expected, { timeout: 45000 });
}
async function command(target, method, data = {}) {
  // Exercise the real, sender-validated background handler from its own page.
  const response = await target.evaluate(({ method, data }) => chrome.runtime.sendMessage({ method, data, target: 'gerowallet', sender: 'options' }), { method, data });
  assert.equal(response?.data?.success, true, `${method} must succeed`);
}

async function createWallet(name, awaitInitialSync = false) {
  stage = `create ${name}: start`;
  const start = page.getByRole('button', { name: /Create your first wallet|Get Started/i }).first();
  await start.click({ timeout: 30000 });
  const cardano = page.getByRole('button', { name: 'Cardano', exact: true });
  await cardano.click();
  const preprod = page.getByRole('button', { name: 'Preprod', exact: true });
  if (!await preprod.isVisible()) await page.getByText('Testnet Networks', { exact: true }).click();
  await preprod.click();
  await page.getByRole('button', { name: /^Create Wallet/ }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).last().click();
  stage = `create ${name}: security`;
  const security = page.locator('.step-security');
  await security.locator('input[type="text"]').first().fill(name);
  const tile = security.locator('.security-tile').filter({ hasText: 'Password' });
  if (await tile.count()) await tile.click();
  await security.getByRole('button', { name: 'Continue', exact: true }).click();
  stage = `create ${name}: confirm`;
  const confirm = page.locator('.step-create-confirm');
  await confirm.locator('input[type="password"]').nth(0).fill(password);
  await confirm.locator('input[type="password"]').nth(1).fill(password);
  for (const checkbox of await confirm.locator('input[type="checkbox"]').all()) await checkbox.check();
  await confirm.getByRole('button', { name: /^Create$/i }).click();
  stage = `create ${name}: background login`;
  await expectState(page, { walletName: name, locked: false });
  if (awaitInitialSync) {
    stage = 'await offline first-login safety timeout';
    const started = Date.now();
    console.log(JSON.stringify({ stage, timeoutMs: 330000 }));
    await page.waitForURL(url => !url.hash.startsWith('#/welcome'), { timeout: 330000 });
    await expectState(page, { walletName: name, syncing: false });
    report.firstLogin = { elapsedAfterIdentityMs: Date.now() - started, url: page.url(), synchronization: 'Timed out with every external network request blocked; this does not certify live synchronization.' };
    check('Offline first login exits welcome after the normal synchronization safety timeout');
  } else if (page.url().includes('#/welcome')) {
    report.offlineLimitation = 'First-restore login waits for network sync. firstLogin records the bounded dashboard check for wallet A; wallet B dashboard completion and live synchronization are not certified.';
  }
  check(`Production UI creates ${name}; real background publishes its identity and wallet record offline`);
}

(async () => {
  try {
    let base = await launch();
    page = await context.newPage();
    await page.goto(`${base}/index.html#/welcome`);
    await observe(page);
    await createWallet(names[0], true);
    const first = await snapshot(page);
    // A real process restart exercises persisted state. With no live provider,
    // the next startup can enter first-restore wait again; no sync is fabricated.
    stage = 'restart after offline creation';
    await page.waitForFunction(async id => (await chrome.storage.local.get('walletStore')).walletStore?.loggedWallet?.id === id, first.walletId);
    await context.close();
    base = await launch();
    page = await context.newPage();
    await page.goto(`${base}/index.html`);
    await observe(page);
    await expectState(page, { walletId: first.walletId });
    check('Browser restart hydrates the UI-created wallet from production persistence');
    let second = await context.newPage();
    await second.goto(`${base}/index.html`);
    await observe(second);
    await expectState(second, { walletId: first.walletId, locked: false });
    check('A newly opened options page hydrates the live background wallet');
    let side = await context.newPage();
    await side.goto(`${base}/sidepanel/index.html`);
    await observe(side);
    await expectState(side, { walletId: first.walletId, locked: false });
    await side.getByText(names[0], { exact: true }).first().waitFor({ timeout: 30000 });
    check('Production side-panel UI renders the created wallet from real stores');

    stage = 'lock broadcasts';
    await command(page, 'LOCK');
    for (const target of [page, second, side]) await expectState(target, { walletId: first.walletId, locked: true });
    check('Background lock broadcasts reach both options pages and side panel');
    stage = 'unlock';
    await command(page, 'UNLOCK', { walletId: (await snapshot(page)).walletId, unlockCredential: password, password, unlockMethod: 'password' });
    for (const target of [page, second, side]) await expectState(target, { locked: false });
    check('Real password authentication unlocks all subscribed interfaces');

    stage = 'logout';
    await command(page, 'LOGOUT');
    for (const target of [page, second, side]) await expectState(target, { walletId: null });
    await page.goto(`${base}/index.html#/welcome`);
    await page.reload();
    await observe(page);
    await createWallet(names[1]);
    const last = await snapshot(page);
    assert.notEqual(last.walletId, first.walletId);
    for (const target of [second, side]) await expectState(target, { walletId: last.walletId });
    check('Second UI-created wallet replaces prior identity across subscribers');

    // Restart after B to clear the previous startup's pending login for A.
    // Otherwise unchanged pendingLogins deduplication can join A's old offline
    // synchronization wait instead of starting a fresh switch in this process.
    await page.waitForFunction(async id => (await chrome.storage.local.get('walletStore')).walletStore?.loggedWallet?.id === id, last.walletId);
    await context.close();
    base = await launch();
    page = await context.newPage();
    second = await context.newPage();
    side = await context.newPage();
    for (const target of [page, second, side]) {
      await target.goto(`${base}/${target === side ? 'sidepanel/index.html' : 'index.html'}`);
      await observe(target);
      await expectState(target, { walletId: last.walletId });
    }

    stage = 'switch back';
    // Select the stored public wallet in the real login handler. No state is injected.
    await page.evaluate(async id => {
      const { geroStore } = await chrome.storage.local.get('geroStore');
      const wallet = Object.values(geroStore.wallets).find(item => item.id === id);
      window.__migrationLoginStatus = 'pending';
      void chrome.runtime.sendMessage({ method: 'LOGIN', data: { wallet }, target: 'gerowallet', sender: 'options' })
        .then(response => { window.__migrationLoginStatus = response?.data?.success ? 'success' : 'failed'; });
    }, first.walletId);
    for (const target of [page, second, side]) await expectState(target, { walletId: first.walletId });
    check('Real wallet switch replaces current identity without fixture-pinned fields');

    stage = 'restart';
    await command(page, 'LOCK');
    await expectState(side, { locked: true });
    await page.waitForFunction(async id => {
      const { walletStore } = await chrome.storage.local.get('walletStore');
      return walletStore?.loggedWallet?.id === id && walletStore.isLocked === true;
    }, first.walletId);
    report.persistedLockBeforeShutdown = true;
    report.configuredUnlockMethod = await page.evaluate(async id => {
      const name = `wallet-${id}`;
      if (!(await indexedDB.databases()).some(database => database.name === name)) throw new Error('Wallet database must already exist');
      return new Promise((resolve, reject) => {
        const opening = indexedDB.open(name);
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const db = opening.result;
          const request = db.transaction('config', 'readonly').objectStore('config').getAll();
          request.onerror = () => { db.close(); reject(request.error); };
          request.onsuccess = () => { db.close(); resolve(request.result.find(config => config.key === 'unlockMethod')?.value ?? null); };
        };
      });
    }, first.walletId);
    assert.equal(report.configuredUnlockMethod, null, 'This scenario requires a newly created wallet without a configured session unlock method');
    check('Real persistence stores the selected wallet and lock before process shutdown');
    await context.close();
    base = await launch();
    page = await context.newPage();
    await page.goto(`${base}/index.html`);
    await observe(page);
    await expectState(page, { walletId: first.walletId, locked: false });
    const restored = await snapshot(page);
    const persistedWallets = await page.evaluate(async () => {
      const { geroStore } = await chrome.storage.local.get('geroStore');
      return Object.values(geroStore.wallets).map(wallet => ({ id: wallet.id, name: wallet.name }));
    });
    assert.deepEqual(persistedWallets.map(wallet => wallet.name).sort(), names);
    check('Fresh browser process restores selected wallet and both records; existing no-unlock-method policy clears the stray lock');
    report.finalState = restored;
    report.persistedWallets = persistedWallets;
    assert.deepEqual(report.errors, [], 'Production pages must not raise uncaught errors');
    assert.equal(artifactDigest(), report.artifactSha256, 'The tested extension artifact changed during the run');
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.stage = stage;
    report.failure = error.stack;
    if (page && !page.isClosed()) {
      report.url = page.url();
      report.controls = await page.getByRole('button').allTextContents().catch(() => []);
      report.finalState = await snapshot(page).catch(() => null);
      report.loginStatus = await page.evaluate(() => window.__migrationLoginStatus).catch(() => null);
      await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {});
    }
    process.exitCode = 1;
  } finally {
    await context?.close();
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, stage, report: path.join(out, 'report.json'), checks: report.checks.length }));
  }
})();
