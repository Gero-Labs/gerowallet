import { describe, it, expect } from 'vitest';
import { isOwnExtensionPageSender, EXTENSION_PAGE_ONLY_METHODS } from './senderTrust';

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
});
