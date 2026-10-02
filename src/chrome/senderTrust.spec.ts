import { describe, it, expect } from 'vitest';
import {
  CONTENT_SCRIPT_OPTIONS_METHODS,
  EXTENSION_PAGE_ONLY_METHODS,
  isOptionsSenderAllowed,
  isOwnExtensionPageSender,
  panelMaySettleRequest,
  type OwnExtension,
} from './senderTrust';

const OWN = 'abcdefghijklmnopabcdefghijklmnop';
/** Chromium: pages under chrome-extension://<id>/ (what runtime.getURL('') returns). */
const CHROME: OwnExtension = { id: OWN, root: `chrome-extension://${OWN}/` };
/** Firefox: the page host is a per-install UUID, not the add-on id. */
const FIREFOX: OwnExtension = { id: 'wallet@gerowallet.io', root: 'moz-extension://3f1c9a52-7d1e-4b8e-9a4f-2c6d0e5b7a10/' };

type S = chrome.runtime.MessageSender;

describe('isOwnExtensionPageSender', () => {
  it('accepts an own extension page (chrome-extension:// url), even in a tab', () => {
    const sender = { id: OWN, url: `chrome-extension://${OWN}/options.html`, tab: { id: 7 } } as unknown as S;
    expect(isOwnExtensionPageSender(sender, CHROME)).toBe(true);
  });

  it('accepts by chrome-extension:// origin when url is absent', () => {
    const sender = { id: OWN, origin: `chrome-extension://${OWN}` } as unknown as S;
    expect(isOwnExtensionPageSender(sender, CHROME)).toBe(true);
  });

  it('rejects a content script (own id + tab, but http page url)', () => {
    const sender = { id: OWN, url: 'https://evil.example/', tab: { id: 7 } } as unknown as S;
    expect(isOwnExtensionPageSender(sender, CHROME)).toBe(false);
  });

  it('rejects a different extension id', () => {
    const sender = { id: 'someotherextensionidsomeotherext', url: `chrome-extension://x/y.html` } as unknown as S;
    expect(isOwnExtensionPageSender(sender, CHROME)).toBe(false);
  });

  it('rejects when sender or ownId is missing (fail closed)', () => {
    expect(isOwnExtensionPageSender(undefined, CHROME)).toBe(false);
    expect(isOwnExtensionPageSender({ id: OWN, url: `chrome-extension://${OWN}/a` } as unknown as S, { id: undefined, root: CHROME.root })).toBe(false);
    expect(isOwnExtensionPageSender({ id: OWN, url: `chrome-extension://${OWN}/a` } as unknown as S, { id: OWN, root: undefined })).toBe(false);
  });

  it('gates exactly the sensitive cross-device methods', () => {
    expect(EXTENSION_PAGE_ONLY_METHODS.has('TRUST_CROSS_DEVICE')).toBe(true);
    expect(EXTENSION_PAGE_ONLY_METHODS.has('REQUEST_CROSS_DEVICE_SIGNATURE')).toBe(true);
    expect(EXTENSION_PAGE_ONLY_METHODS.has('WC_PAIR')).toBe(false);
    expect(EXTENSION_PAGE_ONLY_METHODS.has('SIGN_TX')).toBe(false);
  });

  it('gates the support-chat handshake (it takes spending auth and signs with the stake key)', () => {
    expect(EXTENSION_PAGE_ONLY_METHODS.has('SUPPORT_CHAT_AUTH')).toBe(true);
  });

  it('gates the CIP-113 signing preflight (only the wallet’s own pages sign)', () => {
    expect(EXTENSION_PAGE_ONLY_METHODS.has('CIP113_SIGN_PREFLIGHT')).toBe(true);
  });

  it('rejects another extension page and look-alike id prefixes', () => {
    expect(isOwnExtensionPageSender({ id: OWN, url: 'chrome-extension://someotherextensionidsomeotherext/a.html' } as unknown as S, CHROME)).toBe(false);
    expect(isOwnExtensionPageSender({ id: OWN, url: `chrome-extension://${OWN}evil/a.html` } as unknown as S, CHROME)).toBe(false);
    expect(isOwnExtensionPageSender({ id: OWN, origin: `chrome-extension://${OWN}evil` } as unknown as S, CHROME)).toBe(false);
  });
});

describe('isOwnExtensionPageSender on Firefox (PR #1241 review)', () => {
  it('accepts our moz-extension page, by url or origin', () => {
    expect(isOwnExtensionPageSender({ id: FIREFOX.id, url: `${FIREFOX.root}index.html` } as unknown as S, FIREFOX)).toBe(true);
    expect(isOwnExtensionPageSender({ id: FIREFOX.id, origin: FIREFOX.root!.slice(0, -1) } as unknown as S, FIREFOX)).toBe(true);
  });

  it('rejects a Firefox content script, another UUID, and a URL built from the add-on id', () => {
    expect(isOwnExtensionPageSender({ id: FIREFOX.id, url: 'https://evil.example/' } as unknown as S, FIREFOX)).toBe(false);
    expect(isOwnExtensionPageSender({ id: FIREFOX.id, url: 'moz-extension://00000000-0000-4000-8000-000000000000/i.html' } as unknown as S, FIREFOX)).toBe(false);
    expect(isOwnExtensionPageSender({ id: FIREFOX.id, url: `moz-extension://${FIREFOX.id}/i.html` } as unknown as S, FIREFOX)).toBe(false);
    expect(isOwnExtensionPageSender({ id: 'other@addon', url: `${FIREFOX.root}index.html` } as unknown as S, FIREFOX)).toBe(false);
  });

  it('fails closed on a root that is not an extension page root', () => {
    for (const root of ['https://evil.example/', 'moz-extension://uuid/sub/', 'not a url', '']) {
      expect(isOwnExtensionPageSender({ id: OWN, url: `${root}x.html` } as unknown as S, { id: OWN, root })).toBe(false);
    }
  });
});

describe('isOptionsSenderAllowed (default-deny options channel)', () => {
  const page = { id: OWN, url: `chrome-extension://${OWN}/sidepanel/index.html` } as unknown as S;
  const contentScript = { id: OWN, url: 'https://evil.example/', tab: { id: 3 }, frameId: 0 } as unknown as S;

  it('lets our own extension pages call any options method', () => {
    for (const m of ['UNLOCK', 'SIGN_TX', 'VERIFY_SPENDING_PASSWORD', 'TRUST_CROSS_DEVICE', 'WC_PAIR']) {
      expect(isOptionsSenderAllowed(m, page, CHROME)).toBe(true);
    }
  });

  it('refuses every privileged method from a content script, including ones never listed anywhere', () => {
    for (const m of ['UNLOCK', 'LOGIN', 'RESTORE', 'LOGOUT', 'SIGN_TX', 'SIGN_DATA', 'VERIFY_SPENDING_PASSWORD',
      'UNLOCK_MPC_WALLET', 'REVEAL_MPC_SRP', 'SEND_BITCOIN', 'WC_APPROVE_SESSION', 'TRUST_CROSS_DEVICE', 'SOME_FUTURE_METHOD']) {
      expect(isOptionsSenderAllowed(m, contentScript, CHROME)).toBe(false);
    }
  });

  it('allows only the content-script allowlist from a content script', () => {
    expect(isOptionsSenderAllowed('WC_PAIR', contentScript, CHROME)).toBe(true);
  });

  it('fails closed with no sender or no runtime id', () => {
    expect(isOptionsSenderAllowed('UNLOCK', undefined, CHROME)).toBe(false);
    expect(isOptionsSenderAllowed('UNLOCK', page, { id: undefined, root: CHROME.root })).toBe(false);
  });

  it('tripwire: the content-script allowlist stays tiny and never overlaps the sensitive set', () => {
    expect([...CONTENT_SCRIPT_OPTIONS_METHODS]).toEqual(['WC_PAIR']);
    for (const m of CONTENT_SCRIPT_OPTIONS_METHODS) expect(EXTENSION_PAGE_ONLY_METHODS.has(m)).toBe(false);
  });
});

describe('panelMaySettleRequest', () => {
  it("lets a panel settle its own tab's prompt and tabless ones only", () => {
    expect(panelMaySettleRequest(5, 5)).toBe(true);
    expect(panelMaySettleRequest(Number.NaN, 5)).toBe(true);
    expect(panelMaySettleRequest(Number.NaN, -1)).toBe(true);
    expect(panelMaySettleRequest(5, 6)).toBe(false);
    expect(panelMaySettleRequest(5, -1)).toBe(false);
  });
});
