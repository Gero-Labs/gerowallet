// Throwaway driver for the B0 spike. Reuses the e2e repo's Playwright and the
// contract mock's Web Push encryption. Node >= 20.
//
//   node run.mjs <browser> <step> [--hold=SECONDS] [--ui=none|dashboard|sidepanel] [--show=0|1]
//   browser: chrome | edge | opera
//   steps:   subscribe  -> Q4: subscribe in this browser, save the subscription
//            cdp        -> Q2: deliver a push with CDP ServiceWorker.deliverPushMessage, then the synthetic fallback
//            push       -> Q3: send a REAL Web Push through the browser's push service (uses the saved subscription)
//            click      -> Q1: show notifications, hold the browser open so the OS toast can be clicked, read the log
//            log        -> print the worker's log
//
// Profiles live in %TEMP%/gero-b0/<browser> so a subscription survives between steps.
import crypto from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const E2E = 'D:/GeroRepos/gitRepos/gerowallet-open/gerowallet-e2e-tests';
const { chromium } = await import(pathToFileURL(join(E2E, 'node_modules/playwright/index.mjs')).href);
const { encryptWebPush, generateVapidKeys } = await import(pathToFileURL(join(E2E, 'tests/fixtures/mock-relay.mjs')).href);

const [browser = 'chrome', step = 'log', ...rest] = process.argv.slice(2);
const opt = Object.fromEntries(rest.map((a) => a.replace(/^--/, '').split('=')));
const hold = Number(opt.hold || 0);
const root = join(tmpdir(), 'gero-b0');
mkdirSync(root, { recursive: true });
const profile = join(root, browser);
const extension = join(here, 'extension');
const subFile = join(root, `sub-${browser}.json`);
const vapidFile = join(root, 'vapid.json');
if (!existsSync(vapidFile)) writeFileSync(vapidFile, JSON.stringify(generateVapidKeys())); // local pair, never committed
const vapid = JSON.parse(readFileSync(vapidFile, 'utf8'));

const launchOptions = {
  chrome: { channel: 'chrome' },
  edge: { channel: 'msedge' },
  opera: { executablePath: join(process.env.LOCALAPPDATA, 'Programs/Opera/opera.exe') },
}[browser];
if (!launchOptions) throw new Error(`unknown browser ${browser}`);

// Branded Chrome 137+ ignores --load-extension; the supported path is the CDP
// Extensions.loadUnpacked command behind --enable-unsafe-extension-debugging.
// Playwright's defaults add --disable-extensions (kills that too) and
// --disable-background-networking (starves the push service), so drop both.
const context = await chromium.launchPersistentContext(profile, {
  ...launchOptions,
  headless: false,
  viewport: { width: 1100, height: 800 },
  ignoreDefaultArgs: ['--disable-extensions', '--disable-background-networking', '--disable-component-update'],
  args: ['--enable-unsafe-extension-debugging'],
});
const browserCdp = await context.browser().newBrowserCDPSession();
let worker = context.serviceWorkers()[0] || null;
if (!worker) {
  const r = await browserCdp.send('Extensions.loadUnpacked', { path: extension });
  console.log('loaded through CDP Extensions.loadUnpacked:', JSON.stringify(r));
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 20_000 });
}
const extensionId = worker.url().split('/')[2];
const call = (fn, ...args) => worker.evaluate(({ fn, args }) => self.spike[fn](...args), { fn, args });
const version = await context.browser()?.version?.();
console.log(`[${browser}] ${version || ''} extension ${extensionId}`);

// ---- RFC 8292 VAPID header (same shape as the mock's, which does not export it) ----
function b64u(buf) { return Buffer.from(buf).toString('base64url'); }
function vapidHeader(endpoint) {
  const jwk = (() => { const p = Buffer.from(vapid.publicKey, 'base64url'); return { kty: 'EC', crv: 'P-256', x: b64u(p.subarray(1, 33)), y: b64u(p.subarray(33)), d: vapid.privateKey }; })();
  const enc = (o) => b64u(JSON.stringify(o));
  const input = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:dev@example.invalid' })}`;
  const sig = crypto.sign('sha256', Buffer.from(input), { key: crypto.createPrivateKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${input}.${b64u(sig)}, k=${vapid.publicKey}`;
}
async function sendRealPush(sub, payload) {
  const body = encryptWebPush(JSON.stringify(payload), sub.keys.p256dh, sub.keys.auth);
  const r = await fetch(sub.endpoint, { method: 'POST', body, headers: {
    'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '60', Urgency: 'high', Authorization: vapidHeader(sub.endpoint) } });
  return { status: r.status, text: (await r.text()).slice(0, 200) };
}

async function openUi(ui) {
  if (ui === 'dashboard') { const p = await context.newPage(); await p.goto(`chrome-extension://${extensionId}/index.html`); await p.bringToFront(); return; }
  if (ui === 'sidepanel') {
    // Open the panel from a real extension page click so a user gesture exists.
    const p = await context.newPage();
    await p.goto(`chrome-extension://${extensionId}/index.html`);
    await p.setContent(`<button id="b">open side panel</button><script>document.getElementById('b').onclick = () => chrome.windows.getCurrent().then(w => chrome.sidePanel.open({ windowId: w.id }).then(() => document.title = 'opened', e => document.title = 'ERR ' + e.message));</script>`);
    await p.click('#b');
    await p.waitForFunction(() => document.title !== '', null, { timeout: 5000 }).catch(() => {});
    console.log('side panel open from page click:', await p.title());
    await p.close(); // only the side panel stays
  }
}

const printLog = async () => { for (const e of await call('readLog')) console.log(' log', new Date(e.t).toISOString().slice(11, 23), JSON.stringify(e)); };

try {
  if (step === 'subscribe') {
    try {
      const sub = await call('subscribe', vapid.publicKey);
      writeFileSync(subFile, JSON.stringify(sub, null, 2));
      console.log('subscribed', { reused: sub.reused, endpoint: sub.endpoint, expirationTime: sub.expirationTime });
    } catch (e) { console.log('subscribe FAILED:', String(e.message || e)); }
  } else if (step === 'cdp') {
    await call('clearLog');
    // The ServiceWorker domain is not on the browser session; attach to an extension page.
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/index.html`);
    const cdp = await context.newCDPSession(page);
    const regs = new Map();
    cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => { for (const r of registrations) regs.set(r.registrationId, r); });
    await cdp.send('ServiceWorker.enable');
    await new Promise((r) => setTimeout(r, 1000));
    const reg = [...regs.values()].find((r) => r.scopeURL.includes(extensionId));
    console.log('registrations seen:', [...regs.values()].map((r) => r.scopeURL));
    if (!reg) console.log('no registration for the extension scope');
    else {
      try {
        await cdp.send('ServiceWorker.deliverPushMessage', { origin: `chrome-extension://${extensionId}`, registrationId: reg.registrationId, data: JSON.stringify({ source: 'cdp', show: true, title: 'B0 via CDP', tag: 'b0-cdp' }) });
        console.log('deliverPushMessage: accepted by the browser');
      } catch (e) { console.log('deliverPushMessage FAILED:', String(e.message || e)); }
    }
    await new Promise((r) => setTimeout(r, 1500));
    console.log('after CDP delivery, log:'); await printLog();
    await call('clearLog');
    console.log('synthetic fallback:', await call('syntheticPush', JSON.stringify({ source: 'synthetic', show: true, title: 'B0 synthetic', tag: 'b0-syn' })));
    await new Promise((r) => setTimeout(r, 1500));
    await printLog();
    console.log('notifications now shown:', JSON.stringify(await call('shownNotifications')));
  } else if (step === 'push') {
    if (!existsSync(subFile)) throw new Error('run subscribe first');
    const sub = JSON.parse(readFileSync(subFile, 'utf8'));
    await call('clearLog');
    await openUi(opt.ui || 'none');
    const show = opt.show !== '0';
    for (let i = 0; i < Number(opt.count || 1); i++) {
      console.log('sending real push (show=' + show + ', ui=' + (opt.ui || 'none') + ') ->', await sendRealPush(sub, { source: 'push-service', show, title: 'B0 real push', tag: 'b0-real-' + Date.now() }));
      await new Promise((r) => setTimeout(r, 4000));
      // Chrome's forced "updated in the background" notice is a persistent notification on
      // this registration (tag user_visible_auto_notification), so it would show up here.
      console.log('notifications now shown:', JSON.stringify(await call('shownNotifications')));
    }
    await printLog();
  } else if (step === 'click') {
    await call('clearLog');
    console.log('SW notification:', await call('showFromWorker', 'b0-click-' + Date.now()));
    console.log('chrome.notifications:', await call('showChrome', 'b0-chrome-' + Date.now()));
  } else if (step === 'log') {
    await printLog();
  }
  if (hold) {
    console.log(`holding the browser open for ${hold}s ...`);
    await new Promise((r) => setTimeout(r, hold * 1000));
    console.log('log at the end of the hold:'); await printLog();
    console.log('notifications at the end of the hold:', JSON.stringify(await call('shownNotifications')));
  }
} finally {
  await context.close();
}
