// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BRING_SDK_INVARIANTS,
  BRING_SDK_PATCHES,
  STORAGE_GETTER,
  __geroBringFrameOrigin,
  __geroBringEvent,
  __geroCashbackPage,
  __geroIsBringOrigin,
  __geroIsWebUrl,
  bringSdkPatch,
  patchBringSdk,
} from './bring-sdk-patch.mjs';

/**
 * Runs the patch over the SDK files actually installed (both the ESM build Vite
 * resolves and the CJS build), then loads the patched ESM build in happy-dom
 * against a fake `chrome` and acts as a hostile page would. Every behavioural
 * case also runs on the unpatched SDK and must fail there, so the tests prove
 * the patch, not the fixture.
 */

// Node's URL resolution, not the global one (happy-dom's under this environment).
const DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../node_modules/@bringweb3/chrome-extension-kit/dist');
const ESM = readFileSync(join(DIST, 'index.mjs'), 'utf8');
const CJS = readFileSync(join(DIST, 'index.js'), 'utf8');
const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop';
const BRING_FRAME = 'https://iframe.bringweb3.io';
const GETTER = STORAGE_GETTER.exec(ESM)?.[1];

/**
 * A fresh SDK instance (it keeps its iframe in module state). The ESM build only
 * imports uuid (stubbed) and has one export list, so it runs as a function body
 * that returns its exports, plus the storage getter under `__bringGet`.
 */
function loadSdk(code) {
  let exported = '';
  const body = code
    .replace(/import\{v4 as ([\w$]+),validate as ([\w$]+)\}from"uuid";/g, 'const $1=()=>"00000000-0000-4000-8000-000000000000",$2=()=>!0;')
    .replace(/export\{([^}]*)\};?\s*$/, (_m, list) => {
      exported = list.split(',').map(pair => pair.trim().split(/\s+as\s+/)).map(([local, name]) => `${name}:${local}`).join(',');
      return '';
    });
  if (!exported) throw new Error('SDK export list not found');
  // eslint-disable-next-line no-new-func -- evaluating the patched SDK build under test
  return new Function(`${body}\nreturn {${exported},__bringGet:${GETTER}};`)();
}

function installChrome(storage = {}) {
  const listeners = [];
  const sendMessage = vi.fn((_msg, cb) => cb?.({}));
  const event = () => ({ addListener: vi.fn() });
  globalThis.chrome = {
    runtime: {
      id: EXT_ID,
      lastError: undefined,
      sendMessage,
      onMessage: { addListener: fn => listeners.push(fn) },
    },
    // Worker-side listeners the SDK registers at load; never fired here.
    tabs: { onRemoved: event() },
    webNavigation: { onBeforeNavigate: event(), onCommitted: event(), onCompleted: event(), onHistoryStateUpdated: event() },
    webRequest: { onBeforeRedirect: event() },
    storage: {
      onChanged: event(),
      local: {
        get: (keys, cb) => {
          const out = {};
          for (const k of [].concat(keys)) if (k in storage) out[k] = storage[k];
          cb(out);
        },
        set: (obj, cb) => { Object.assign(storage, obj); cb?.(); },
        remove: (keys, cb) => { for (const k of [].concat(keys)) delete storage[k]; cb?.(); },
      },
    },
  };
  return { listeners, sendMessage, storage };
}

async function initContentScript(code, overrides = {}) {
  const env = installChrome();
  const sdk = await loadSdk(code);
  const promptLogin = vi.fn(async () => {});
  let push = null;
  await sdk.bringInitContentScript({
    getWalletAddress: async () => 'addr1qxwallet',
    promptLogin,
    walletAddressUpdateCallback: fn => { push = fn; },
    theme: 'dark',
    text: 'lower',
    switchWallet: false,
    ...overrides,
  });
  return { ...env, promptLogin, push: () => push() };
}

/**
 * Frames never load here (no network), so each gets a stand-in window: what the
 * SDK posts to, and the `source` of the messages it sends.
 */
function withWindow(frame) {
  Object.defineProperty(frame, 'contentWindow', { value: { postMessage: vi.fn() }, configurable: true });
  return frame;
}

/** Bring's worker asking this tab to show its popup, as the SDK does. */
async function injectBringPopup(listeners) {
  const reply = vi.fn();
  for (const listener of listeners) {
    listener({ from: 'bringweb3', action: 'INJECT', domain: location.href, page: '', iframeUrl: `${BRING_FRAME}/popup`, token: 'tok' }, {}, reply);
  }
  const frame = document.getElementById(`bringweb3-iframe-${EXT_ID}`);
  expect(frame?.src.startsWith(BRING_FRAME)).toBe(true);
  return withWindow(frame);
}

function plantFrame(src, id = `bringweb3-iframe-${EXT_ID}`) {
  const frame = document.createElement('iframe');
  frame.id = id;
  frame.src = src;
  document.documentElement.appendChild(frame);
  return withWindow(frame);
}

function post(data, { origin = location.origin, source = window } = {}) {
  window.dispatchEvent(new MessageEvent('message', { data: { from: 'bringweb3', extensionId: EXT_ID, ...data }, origin, source }));
}

const sentActions = sendMessage => sendMessage.mock.calls.map(([msg]) => msg?.action);
const PATCHED = patchBringSdk(ESM);

// Each SDK instance adds window listeners; drop them so one test's instance
// (the unpatched control above all) never answers another test's messages.
let added = [];
const addEventListener = window.addEventListener.bind(window);
beforeEach(() => {
  // No network: frames never load their page (happy-dom logs each skipped load).
  if (window.happyDOM?.settings) window.happyDOM.settings.disableIframePageLoading = true;
  added = [];
  // The SDK re-injects its popup when the page removes it; cleanup here would
  // trigger that from a finished test's instance.
  vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} });
  vi.spyOn(window, 'addEventListener').mockImplementation((type, fn, opts) => {
    added.push([type, fn, opts]);
    addEventListener(type, fn, opts);
  });
});
afterEach(() => {
  for (const [type, fn, opts] of added) window.removeEventListener(type, fn, opts);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.querySelectorAll('iframe').forEach(f => f.remove());
  delete globalThis.chrome;
});

describe('patchBringSdk on the installed SDK', () => {
  it.each([['index.mjs', ESM], ['index.js', CJS]])('every invariant and patch matches %s exactly once', (_name, code) => {
    expect(() => patchBringSdk(code)).not.toThrow();
    const out = patchBringSdk(code);
    expect(out).not.toContain('document.querySelector(`#${F}-${chrome.runtime.id}`)');
    expect(out).not.toMatch(/walletAddress:[\w$]+\},"\*"\)/);
    expect(out).toContain('__geroCashbackPage(');
    expect(out).toContain('__geroBringEvent(');
    expect(out).toContain('__geroIsWebUrl(');
  });

  it('fails the build, naming each pattern, when the SDK changes', () => {
    const drifted = ESM.replace('"bring_"', '"bring2_"').replace('onClose:me}))', 'onClose:me}),!0)');
    expect(() => patchBringSdk(drifted, 'sdk.mjs')).toThrow(/storage key prefix[\s\S]*content-script bridge/);
    expect(() => patchBringSdk('export{}', 'sdk.mjs')).toThrow(/does not match the reviewed Bring SDK 1\.8\.0/);
  });

  it('lists what it checks', () => {
    expect(BRING_SDK_INVARIANTS.length).toBeGreaterThanOrEqual(7);
    expect(BRING_SDK_PATCHES.map(p => p.name)).toHaveLength(6);
  });

  it('the Vite plugin patches only the SDK module', () => {
    const id = join(DIST, 'index.mjs');
    expect(bringSdkPatch.transform(ESM, id)?.code).toBe(PATCHED);
    expect(bringSdkPatch.transform(ESM, '/src/other.js')).toBeNull();
    expect(bringSdkPatch.transform(ESM, `\0${id}`)).toBeNull();
    expect(() => bringSdkPatch.transform('export{}', id)).toThrow();
  });
});

describe('helpers', () => {
  it('accepts only https bringweb3.io origins', () => {
    expect(__geroIsBringOrigin('https://iframe.bringweb3.io')).toBe(true);
    expect(__geroIsBringOrigin('https://bringweb3.io')).toBe(true);
    for (const bad of ['http://iframe.bringweb3.io', 'https://evilbringweb3.io', 'https://bringweb3.io.evil.com',
      'https://iframe.bringweb3.io/path', 'null', '', undefined, 'chrome-extension://x']) {
      expect(__geroIsBringOrigin(bad)).toBe(false);
    }
  });

  it('reads a frame origin from its src, Bring frames only', () => {
    expect(__geroBringFrameOrigin({ src: `${BRING_FRAME}/popup?x=1#token=t` })).toBe(BRING_FRAME);
    expect(__geroBringFrameOrigin({ src: 'https://evil.example/sink' })).toBeNull();
    expect(__geroBringFrameOrigin(null)).toBeNull();
  });

  it('allows http(s) redirects only', () => {
    expect(__geroIsWebUrl('https://shop.example/x')).toBe(true);
    expect(__geroIsWebUrl('http://shop.example/x')).toBe(true);
    for (const bad of ['javascript:alert(1)', 'chrome://settings', 'chrome-extension://id/index.html', 'data:text/html,x', '/index.html', undefined]) {
      expect(__geroIsWebUrl(bad)).toBe(false);
    }
  });

  it('trusts Bring\'s own frame, and from other Bring frames only another wallet\'s activation, defused', () => {
    const frame = { contentWindow: {} };
    const hadChrome = 'chrome' in globalThis;
    const saved = globalThis.chrome;
    globalThis.chrome = { runtime: { id: EXT_ID } };
    try {
      const own = { origin: BRING_FRAME, source: frame.contentWindow, data: { action: 'OPT_OUT' } };
      expect(__geroBringEvent(own, frame)).toBe(own);
      expect(__geroBringEvent({ origin: BRING_FRAME, source: {}, data: { action: 'OPT_OUT' } }, frame)).toBeNull();
      expect(__geroBringEvent({ origin: 'https://evil.example', source: frame.contentWindow, data: { action: 'OPT_OUT' } }, frame)).toBeNull();
      // An activation from a frame that is not ours, naming this extension: never ours.
      expect(__geroBringEvent({ origin: BRING_FRAME, source: {}, data: { action: 'ACTIVATE', extensionId: EXT_ID } }, frame)).toBeNull();
      expect(__geroBringEvent({ origin: BRING_FRAME, source: {}, data: { action: 'ACTIVATE' } }, null)).toBeNull();
      const foreign = __geroBringEvent({ origin: BRING_FRAME, source: {}, data: {
        action: 'ACTIVATE', extensionId: 'another-wallet', domain: 'shop.example', redirectUrl: 'https://x.example', followups: [{ id: 'f' }],
      } }, frame);
      expect(foreign?.data).toMatchObject({ action: 'ACTIVATE', extensionId: 'another-wallet', domain: 'shop.example' });
      expect(foreign?.data.redirectUrl).toBeUndefined();
      expect(foreign?.data.followups).toBeUndefined();
    } finally {
      if (hadChrome) globalThis.chrome = saved; else delete globalThis.chrome;
    }
  });
});

describe('wallet address push', () => {
  it('never reaches an iframe the page planted under Bring\'s id', async () => {
    for (const src of ['https://evil.example/sink', `${BRING_FRAME}/looks-like-bring`]) {
      const sdk = await initContentScript(PATCHED);
      const planted = plantFrame(src);
      const spy = vi.spyOn(planted.contentWindow, 'postMessage');
      await sdk.push();
      expect(spy).not.toHaveBeenCalled();
      // Bring's worker still gets it: that is the cashback feature.
      expect(sentActions(sdk.sendMessage)).toContain('WALLET_ADDRESS_UPDATE');
      planted.remove();
    }
  });

  it('(control) the unpatched SDK posts it to the planted iframe with targetOrigin "*"', async () => {
    const sdk = await initContentScript(ESM);
    const planted = plantFrame('https://evil.example/sink');
    const spy = vi.spyOn(planted.contentWindow, 'postMessage');
    await sdk.push();
    expect(spy).toHaveBeenCalledWith({ action: 'WALLET_ADDRESS_UPDATE', walletAddress: 'addr1qxwallet' }, '*');
  });

  it('goes to Bring\'s own iframe, pinned to its Bring origin', async () => {
    const sdk = await initContentScript(PATCHED);
    const frame = await injectBringPopup(sdk.listeners);
    const spy = vi.spyOn(frame.contentWindow, 'postMessage');
    await sdk.push();
    expect(spy).toHaveBeenCalledWith({ action: 'WALLET_ADDRESS_UPDATE', walletAddress: 'addr1qxwallet' }, BRING_FRAME);

    // The page points Bring's iframe somewhere else: nothing is posted.
    spy.mockClear();
    frame.src = 'https://evil.example/';
    await sdk.push();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('content-script bridge', () => {
  const PAGE_ACTIONS = ['PROMPT_LOGIN', 'OPT_OUT', 'OPT_OUT_SPECIFIC', 'OPEN_CASHBACK_PAGE', 'ACTIVATE', 'ERASE_NOTIFICATION', 'STOP_REMINDERS'];

  it('ignores every action a page posts', async () => {
    const sdk = await initContentScript(PATCHED);
    await injectBringPopup(sdk.listeners);
    sdk.sendMessage.mockClear();
    for (const action of PAGE_ACTIONS) post({ action, url: 'chrome://settings', time: Number.MAX_SAFE_INTEGER, redirectUrl: 'https://evil.example' });
    expect(sdk.promptLogin).not.toHaveBeenCalled();
    expect(sdk.sendMessage).not.toHaveBeenCalled();
  });

  it('(control) the unpatched SDK lets a page flip the opt-out and prompt a login', async () => {
    const sdk = await initContentScript(ESM);
    sdk.sendMessage.mockClear();
    post({ action: 'OPT_OUT', time: Number.MAX_SAFE_INTEGER });
    post({ action: 'PROMPT_LOGIN' });
    expect(sentActions(sdk.sendMessage)).toContain('OPT_OUT');
    expect(sdk.promptLogin).toHaveBeenCalled();
  });

  it('ignores a genuine Bring page the attacker framed itself, except another wallet\'s activation', async () => {
    const sdk = await initContentScript(PATCHED);
    await injectBringPopup(sdk.listeners);
    const other = plantFrame(`${BRING_FRAME}/elsewhere`, 'attacker-frame');
    sdk.sendMessage.mockClear();
    post({ action: 'OPT_OUT', time: 1 }, { origin: BRING_FRAME, source: other.contentWindow });
    post({ action: 'PROMPT_LOGIN' }, { origin: BRING_FRAME, source: other.contentWindow });
    expect(sdk.sendMessage).not.toHaveBeenCalled();
    expect(sdk.promptLogin).not.toHaveBeenCalled();
    // Naming this extension, it would be treated as our own activation: refused.
    post({ action: 'ACTIVATE', domain: 'shop.example', redirectUrl: 'https://evil.example', followups: [{ id: 'f' }] },
      { origin: BRING_FRAME, source: other.contentWindow });
    expect(sdk.sendMessage).not.toHaveBeenCalled();
    // Another wallet's activation only quiets our popup: no redirect, no follow-ups.
    post({ action: 'ACTIVATE', domain: 'shop.example', extensionId: 'another-wallet', redirectUrl: 'https://evil.example', followups: [{ id: 'f' }] },
      { origin: BRING_FRAME, source: other.contentWindow });
    expect(sentActions(sdk.sendMessage)).toEqual(['ACTIVATE']);
    const [activation] = sdk.sendMessage.mock.calls[0];
    expect(activation.extensionId).toBe('another-wallet');
    expect(activation.redirectUrl).toBeUndefined();
    expect(activation.followups).toBeUndefined();
  });

  it('still serves Bring\'s own iframe', async () => {
    const sdk = await initContentScript(PATCHED);
    const frame = await injectBringPopup(sdk.listeners);
    sdk.sendMessage.mockClear();
    post({ action: 'PROMPT_LOGIN' }, { origin: BRING_FRAME, source: frame.contentWindow });
    post({ action: 'OPT_OUT', time: 86_400_000 }, { origin: BRING_FRAME, source: frame.contentWindow });
    expect(sdk.promptLogin).toHaveBeenCalledTimes(1);
    expect(sentActions(sdk.sendMessage)).toEqual(['OPT_OUT']);
    // A message from Bring's frame after the page navigated it elsewhere.
    sdk.sendMessage.mockClear();
    post({ action: 'OPT_OUT', time: 1 }, { origin: 'https://evil.example', source: frame.contentWindow });
    expect(sdk.sendMessage).not.toHaveBeenCalled();
  });
});

describe('stored wallet address while cashback is turned off', () => {
  const now = Date.now();
  const cases = [
    ['turned off (setTurnOff(true))', [now - 1000, now - 1000 + Number.MAX_SAFE_INTEGER], undefined],
    ['turned off for a day from Bring\'s popup', [now - 1000, now + 86_400_000], undefined],
    ['turned on (no opt-out)', undefined, 'addr1qxstale'],
    ['an expired opt-out', [now - 2000, now - 1000], 'addr1qxstale'],
  ];

  it.each(cases)('%s', async (_label, optOut, expected) => {
    installChrome({ bring_walletAddress: 'addr1qxstale', ...(optOut ? { bring_optOut: optOut } : {}) });
    const sdk = await loadSdk(PATCHED);
    expect(await sdk.__bringGet('walletAddress')).toBe(expected);
    expect(await sdk.__bringGet('optOut')).toEqual(optOut);
  });

  it('(control) the unpatched SDK keeps reading it while turned off', async () => {
    installChrome({ bring_walletAddress: 'addr1qxstale', bring_optOut: [now - 1000, now + 86_400_000] });
    const sdk = await loadSdk(ESM);
    expect(await sdk.__bringGet('walletAddress')).toBe('addr1qxstale');
  });
});

describe('worker patches', () => {
  it('OPEN_CASHBACK_PAGE opens Gero\'s cashback page or Bring\'s own pages, nothing else', () => {
    expect(PATCHED).toMatch(/case"OPEN_CASHBACK_PAGE":let\{url:[\w$]+\}=[\w$]+;return [\w$]+\(__geroCashbackPage\(/);
    const hadChrome = 'chrome' in globalThis;
    const saved = globalThis.chrome;
    globalThis.chrome = { runtime: { id: EXT_ID, getURL: (p) => `chrome-extension://${EXT_ID}${p}` } };
    try {
      const configured = '/index.html#/cashback';
      expect(__geroCashbackPage('https://portal.bringweb3.io/offers/42', configured)).toBe('https://portal.bringweb3.io/offers/42');
      expect(__geroCashbackPage(`chrome-extension://${EXT_ID}/index.html#/cashback/claims`, configured))
        .toBe(`chrome-extension://${EXT_ID}/index.html#/cashback/claims`);
      expect(__geroCashbackPage('/index.html#/cashback?tab=deals', configured)).toBe(`chrome-extension://${EXT_ID}/index.html#/cashback?tab=deals`);
      for (const url of ['chrome://settings', 'https://evil.example/', 'http://portal.bringweb3.io/',
        `chrome-extension://${EXT_ID}/index.html#/settings`, `chrome-extension://${EXT_ID}/index.html#/cashbackx`,
        'chrome-extension://another-extension-id/index.html#/cashback', 'javascript:alert(1)', '', undefined]) {
        expect(__geroCashbackPage(url, configured)).toBe(configured);
      }
    } finally {
      if (hadChrome) globalThis.chrome = saved; else delete globalThis.chrome;
    }
  });

  it('an activation redirect must be http(s)', () => {
    expect(PATCHED).toMatch(/[\w$]+&&[\w$]+&&__geroIsWebUrl\([\w$]+\)&&await [\w$]+\([\w$]+\)&&chrome\.tabs\.update/);
  });
});
