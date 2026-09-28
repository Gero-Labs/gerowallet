// Handover §4.3 "Real push service": the REAL wallet build in branded Google Chrome,
// subscribed through Google's push service (FCM), registered against the contract mock
// running locally on 127.0.0.1:6300 (the production CSP allows that port), then pushed
// by the mock through FCM. Throwaway driver; reuses the e2e repo's Playwright and the
// template wallet its global setup restored (.tmp/post-v27-wallet-template.json).
//
//   1. build the worker with VITE_NOTIFY_API_URL=http://localhost:6300/api/notify/v1
//   2. node spikes/notify-manual/real-push.mjs [--suspend=SECONDS]
//
// It prints what the worker shows (registration.getNotifications()) after each push.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';

const E2E = 'D:/GeroRepos/gitRepos/gerowallet-open/gerowallet-e2e-tests';
const WALLET = resolve('extension');
const PASSWORD = 'TestPassword123!'; // the e2e template wallet's password (public test vector wallet)
const { chromium } = await import(pathToFileURL(join(E2E, 'node_modules/playwright/index.mjs')).href);
const { createNotifyMock } = await import(pathToFileURL(join(E2E, 'tests/fixtures/mock-relay.mjs')).href);
const opt = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const suspendSeconds = Number(opt.suspend || 0);

// ---- the mock on the CSP-allowed loopback port ----
let mock;
const server = http.createServer((req, res) => mock.handle(req, res).catch((e) => { res.writeHead(500); res.end(String(e)); }));
await new Promise((r) => server.listen(6300, '127.0.0.1', r));
mock = createNotifyMock({ publicBase: 'http://127.0.0.1:6300' });
const ctl = async (path, body) => { const r = await fetch(`http://127.0.0.1:6300/__mock/${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const t = await r.text(); return t ? JSON.parse(t) : null; };
console.log('mock on http://127.0.0.1:6300, VAPID kid', mock.vapid.kid);

// ---- branded Chrome with the real wallet build ----
const profile = mkdtempSync(join(tmpdir(), 'gero-real-push-'));
const template = JSON.parse(readFileSync(join(E2E, '.tmp/post-v27-wallet-template.json'), 'utf8'));
const KEY_FIELDS = ['publicKey', 'encryptedPrivateKey', 'encryptedMnemonic', 'passwordLastUpdate', 'addressType', 'encryptionMethod'];
const record = { id: 4, name: 'Notify Cardano', chain: 'Cardano', network: 'Preprod', type: 'Normal', order: 0, icon: '', baseAddress: '', ...Object.fromEntries(KEY_FIELDS.map((f) => [f, template[f]])) };

async function launch() {
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chrome', headless: false, viewport: { width: 1200, height: 900 },
    ignoreDefaultArgs: ['--disable-extensions', '--disable-background-networking', '--disable-component-update'],
    args: ['--enable-unsafe-extension-debugging'],
  });
  const cdp = await context.browser().newBrowserCDPSession();
  await cdp.send('Extensions.loadUnpacked', { path: WALLET });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 30_000 });
  return { context, worker, extensionId: worker.url().split('/')[2] };
}

// Seed (same shape as the e2e fixture), then restart so the worker logs the wallet in.
{
  const { context, worker } = await launch();
  await new Promise((r) => setTimeout(r, 4000));
  await worker.evaluate(async ({ record }) => {
    const db = await new Promise((resolve, reject) => { const q = indexedDB.open('GeroWalletDatabase'); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error); });
    await new Promise((resolve, reject) => { const tx = db.transaction(['wallets'], 'readwrite'); tx.objectStore('wallets').clear(); tx.objectStore('wallets').put(record); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    db.close();
    await chrome.storage.local.set({
      geroStore: { wallets: { [record.id]: record }, config: { welcomeDone: true, locale: 'us' }, network: { blockchain: 'Cardano', network: 'Preprod' } },
      walletStore: { loggedWallet: record, isLocked: false, isSyncing: false, transactions: [], utxos: [], tokens: {}, collections: {}, programmableTokens: {}, programmableLockedLovelace: '0', keys: null, collateral: null, account: null, contacts: {}, connectedDapps: [], config: { locale: 'us', currency: 'usd', hideBalances: false, hideUnverifiedTokens: false } },
    });
  }, { record });
  await context.close();
  console.log('seeded the template wallet; restarting Chrome');
}

const { context, worker, extensionId } = await launch();
const page = await context.newPage();
await page.goto(`chrome-extension://${extensionId}/index.html#/`);
// Let the worker log in and finish its catch-up against production gero-sync (the fixture's settle rule).
for (let i = 0; i < 90; i++) {
  const s = await worker.evaluate(async () => { const { walletStore: ws, loadingState: ls } = await chrome.storage.local.get(['walletStore', 'loadingState']); return { logged: !!ws?.loggedWallet, syncing: !!ws?.isSyncing, busy: !!(ls && (ls.isRestoring || ls.isSyncing || ls.loading || ls.syncPending || ls.connecting)) }; });
  if (s.logged && !s.syncing && !s.busy && i > 5) break;
  await new Promise((r) => setTimeout(r, 1000));
}
const send = (method, data = {}) => page.evaluate(({ method, data }) => new Promise((resolve) => chrome.runtime.sendMessage({ id: `m-${Date.now()}`, method, data, target: 'gerowallet', sender: 'options' }, (r) => resolve(r?.data))), { method, data });
const shown = () => worker.evaluate(async () => (await self.registration.getNotifications()).map((n) => ({ title: n.title, body: n.body, tag: n.tag, silent: n.silent, requireInteraction: n.requireInteraction })));
const closeAll = () => worker.evaluate(async () => { for (const n of await self.registration.getNotifications()) n.close(); });

try {
  console.log('state before:', JSON.stringify((await send('NOTIFY_GET_STATE'))?.state?.device));
  const on = await send('NOTIFY_SET_BROWSER_ENABLED', { enabled: true });
  console.log('browser on ->', on?.result, JSON.stringify(on?.state?.device));
  let enabled = await send('NOTIFY_ENABLE_WALLET', { password: PASSWORD });
  if (enabled?.result !== 'ok') { await new Promise((r) => setTimeout(r, 10_000)); enabled = await send('NOTIFY_ENABLE_WALLET', { password: PASSWORD }); }
  console.log('wallet on ->', enabled?.result);
  const state = await ctl('state');
  console.log('mock device:', state.devices[0]?.transport, state.devices[0]?.webpush?.endpoint?.slice(0, 60) + '…', 'links:', state.devices[0]?.links?.length);
  if (!state.devices[0]?.webpush) throw new Error('no real subscription registered');

  await closeAll();
  const first = await ctl('push', { t: 'funds', c: 'funds', d: 'activity', a: { ada: '12.5' }, x: { tx: 'a'.repeat(64) }, eventId: 'funds:manual:1' });
  console.log('FCM answered', first.status, 'for e', first.payload?.e);
  for (let i = 0; i < 20 && !(await shown()).length; i++) await new Promise((r) => setTimeout(r, 1000));
  console.log('worker shows (page open, unfocused?):', JSON.stringify(await shown()));
  await closeAll();

  if (suspendSeconds > 0) {
    console.log(`leaving every extension page and waiting ${suspendSeconds}s so the worker can go idle…`);
    for (const p of context.pages()) await p.goto('about:blank'); // closing the last tab would close Chrome
    await new Promise((r) => setTimeout(r, suspendSeconds * 1000));
    // Read the worker through raw CDP targets: Playwright's handle does not survive the idle period.
    const cdp = await context.browser().newBrowserCDPSession();
    const workerTarget = async () => (await cdp.send('Target.getTargets')).targetInfos.find((t) => t.type === 'service_worker' && t.url.includes(extensionId));
    console.log('worker target before the push:', (await workerTarget()) ? 'ALIVE (the sync socket keep-alive holds it)' : 'TERMINATED (idle)');
    const second = await ctl('push', { t: 'new_device', c: 'remoteSigning', d: 'pairedDevices', x: { deviceId: 'b'.repeat(32) }, eventId: 'paired:manual:2' });
    console.log('FCM answered', second.status);
    // Playwright's CDPSession cannot route to an attached target, so read through its worker
    // handle: the one from before if it survived, else the next 'serviceworker' event.
    const readShown = async () => {
      const w = context.serviceWorkers().find((x) => x.url().includes(extensionId)) || await context.waitForEvent('serviceworker', { timeout: 5000 }).catch(() => null);
      if (!w) return null;
      return w.evaluate(async () => (await self.registration.getNotifications()).map((n) => ({ title: n.title, body: n.body, tag: n.tag, requireInteraction: n.requireInteraction }))).catch((e) => { console.log('  read failed:', String(e).slice(0, 120)); return null; });
    };
    let list = null;
    for (let i = 0; i < 25 && !(list && list.length); i++) { await new Promise((r) => setTimeout(r, 1000)); list = await readShown(); }
    console.log('worker target after the push:', (await workerTarget()) ? 'alive' : 'none');
    console.log('worker shows after the idle period:', JSON.stringify(list));
  }
  console.log('mock route log:', (await ctl('state')).log.map((l) => l.route).join(' | '));
} finally {
  await context.close();
  server.close();
  rmSync(profile, { recursive: true, force: true });
}
