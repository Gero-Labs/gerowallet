import { describe, it, expect } from 'vitest';
import {
  CONTENT_SCRIPT_OPTIONS_METHODS,
  EXTENSION_PAGE_ONLY_METHODS,
  isOptionsSenderAllowed,
  isOwnExtensionPageSender,
  panelMaySettleRequest,
} from './senderTrust';

const OWN = 'abcdefghijklmnopabcdefghijklmnop';

type S = chrome.runtime.MessageSender;

describe('isOwnExtensionPageSender', () => {
  it('accepts an own extension page (chrome-extension:// url), even in a tab', () => {
    const sender = { id: OWN, url: `chrome-extension://${OWN}/options.html`, tab: { id: 7 } } as unknown as S;
    expect(isOwnExtensionPageSender(sender, OWN)).toBe(true);
  });

  it('accepts by chrome-extension:// origin when url is absent', () => {
    const sender = { id: OWN, origin: `chrome-extension://${OWN}` } as unknown as S;
    expect(isOwnExtensionPageSender(sender, OWN)).toBe(true);
  });

  it('rejects a content script (own id + tab, but http page url)', () => {
    const sender = { id: OWN, url: 'https://evil.example/', tab: { id: 7 } } as unknown as S;
    expect(isOwnExtensionPageSender(sender, OWN)).toBe(false);
  });

  it('rejects a different extension id', () => {
    const sender = { id: 'someotherextensionidsomeotherext', url: `chrome-extension://x/y.html` } as unknown as S;
    expect(isOwnExtensionPageSender(sender, OWN)).toBe(false);
  });

  it('rejects when sender or ownId is missing (fail closed)', () => {
    expect(isOwnExtensionPageSender(undefined, OWN)).toBe(false);
    expect(isOwnExtensionPageSender({ id: OWN, url: `chrome-extension://${OWN}/a` } as unknown as S, undefined)).toBe(false);
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
    expect(isOwnExtensionPageSender({ id: OWN, url: 'chrome-extension://someotherextensionidsomeotherext/a.html' } as unknown as S, OWN)).toBe(false);
    expect(isOwnExtensionPageSender({ id: OWN, url: `chrome-extension://${OWN}evil/a.html` } as unknown as S, OWN)).toBe(false);
    expect(isOwnExtensionPageSender({ id: OWN, origin: `chrome-extension://${OWN}evil` } as unknown as S, OWN)).toBe(false);
  });
});

describe('isOptionsSenderAllowed (default-deny options channel)', () => {
  const page = { id: OWN, url: `chrome-extension://${OWN}/sidepanel/index.html` } as unknown as S;
  const contentScript = { id: OWN, url: 'https://evil.example/', tab: { id: 3 }, frameId: 0 } as unknown as S;

  it('lets our own extension pages call any options method', () => {
    for (const m of ['UNLOCK', 'SIGN_TX', 'VERIFY_SPENDING_PASSWORD', 'TRUST_CROSS_DEVICE', 'WC_PAIR']) {
      expect(isOptionsSenderAllowed(m, page, OWN)).toBe(true);
    }
  });

  it('refuses every privileged method from a content script, including ones never listed anywhere', () => {
    for (const m of ['UNLOCK', 'LOGIN', 'RESTORE', 'LOGOUT', 'SIGN_TX', 'SIGN_DATA', 'VERIFY_SPENDING_PASSWORD',
      'UNLOCK_MPC_WALLET', 'REVEAL_MPC_SRP', 'SEND_BITCOIN', 'WC_APPROVE_SESSION', 'TRUST_CROSS_DEVICE', 'SOME_FUTURE_METHOD']) {
      expect(isOptionsSenderAllowed(m, contentScript, OWN)).toBe(false);
    }
  });

  it('allows only the content-script allowlist from a content script', () => {
    expect(isOptionsSenderAllowed('WC_PAIR', contentScript, OWN)).toBe(true);
  });

  it('fails closed with no sender or no runtime id', () => {
    expect(isOptionsSenderAllowed('UNLOCK', undefined, OWN)).toBe(false);
    expect(isOptionsSenderAllowed('UNLOCK', page, undefined)).toBe(false);
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
