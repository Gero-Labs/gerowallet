import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BRING_OPT_OUT_KEY,
  forgetBringWalletAddress,
  isBringOptedOut,
  mayReleaseAddress,
  readBringOptOut,
} from './bringAddressSharing';

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

describe('isBringOptedOut (Bring SDK 1.8.0 opt-out window)', () => {
  it('is off when no opt-out is stored (the default: cashback on)', () => {
    expect(isBringOptedOut(undefined, NOW)).toBe(false);
    expect(isBringOptedOut(null, NOW)).toBe(false);
  });

  it('is on for the window setTurnOff(true) writes', () => {
    expect(isBringOptedOut([NOW - 1, NOW - 1 + Number.MAX_SAFE_INTEGER], NOW)).toBe(true);
  });

  it('follows a time-limited opt-out from Bring\'s popup, inclusive at both ends', () => {
    const window = [NOW - DAY, NOW + DAY];
    expect(isBringOptedOut(window, NOW)).toBe(true);
    expect(isBringOptedOut(window, NOW - DAY)).toBe(true);
    expect(isBringOptedOut(window, NOW + DAY)).toBe(true);
    expect(isBringOptedOut(window, NOW + DAY + 1)).toBe(false);
    expect(isBringOptedOut(window, NOW - DAY - 1)).toBe(false);
  });

  it('reads an older SDK\'s bare end timestamp', () => {
    expect(isBringOptedOut(NOW + DAY, NOW)).toBe(true);
    expect(isBringOptedOut(NOW - DAY, NOW)).toBe(false);
  });

  it('keeps the address private on any format it does not know', () => {
    for (const odd of [[NOW + DAY, NOW], [NOW], [NOW, NOW + 1, NOW + 2], ['a', 'b'], 'yes', true, {}, Number.NaN]) {
      expect(isBringOptedOut(odd, NOW)).toBe(true);
    }
  });
});

describe('readBringOptOut', () => {
  it('reads Bring\'s own key from chrome.storage.local', async () => {
    const get = vi.fn(async () => ({ [BRING_OPT_OUT_KEY]: [Date.now() - 1, Date.now() + DAY] }));
    expect(await readBringOptOut({ get } as never)).toBe(true);
    expect(get).toHaveBeenCalledWith('bring_optOut');
    expect(await readBringOptOut({ get: async () => ({}) } as never)).toBe(false);
  });

  it('fails closed when storage cannot be read', async () => {
    expect(await readBringOptOut({ get: async () => { throw new Error('gone'); } } as never)).toBe(true);
  });
});

describe('mayReleaseAddress', () => {
  const request = (over: Partial<Parameters<typeof mayReleaseAddress>[0]> = {}) => ({
    origin: undefined,
    locked: false,
    isWhitelisted: () => false,
    bringOptedOut: async () => false,
    ...over,
  });

  describe('our content script, for Bring (no origin)', () => {
    it('gets the address while cashback is on', async () => {
      expect(await mayReleaseAddress(request({ bringOptedOut: async () => false }))).toBe(true);
    });

    it('gets nothing once the user turns cashback off', async () => {
      expect(await mayReleaseAddress(request({ bringOptedOut: async () => true }))).toBe(false);
    });

    it('gets nothing while the wallet is locked, cashback on or off', async () => {
      expect(await mayReleaseAddress(request({ locked: true }))).toBe(false);
      expect(await mayReleaseAddress(request({ locked: true, bringOptedOut: async () => true }))).toBe(false);
    });
  });

  describe('a page (relay-stamped origin)', () => {
    it('needs the connected-sites whitelist, whatever the cashback switch says', async () => {
      const isWhitelisted = (o: string) => o === 'https://dapp.example';
      expect(await mayReleaseAddress(request({ origin: 'https://dapp.example', isWhitelisted }))).toBe(true);
      expect(await mayReleaseAddress(request({ origin: 'https://other.example', isWhitelisted }))).toBe(false);
      expect(await mayReleaseAddress(request({ origin: 'https://dapp.example', isWhitelisted, bringOptedOut: async () => true }))).toBe(true);
    });

    it('never takes the Bring path, even with an empty or opaque origin', async () => {
      const bringOptedOut = vi.fn(async () => false);
      expect(await mayReleaseAddress(request({ origin: '', bringOptedOut }))).toBe(false);
      expect(await mayReleaseAddress(request({ origin: 'null', bringOptedOut }))).toBe(false);
      expect(bringOptedOut).not.toHaveBeenCalled();
    });
  });
});

describe('forgetBringWalletAddress', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('sends the SDK\'s empty WALLET_ADDRESS_UPDATE, which removes the stored address', async () => {
    const sendMessage = vi.fn((_msg: unknown, cb: () => void) => cb());
    vi.stubGlobal('chrome', { runtime: { sendMessage, lastError: undefined } });
    await forgetBringWalletAddress();
    expect(sendMessage).toHaveBeenCalledWith({ from: 'bringweb3', action: 'WALLET_ADDRESS_UPDATE' }, expect.any(Function));
  });

  it('resolves when nothing answers', async () => {
    vi.stubGlobal('chrome', { runtime: { sendMessage: () => { throw new Error('no worker'); } } });
    await expect(forgetBringWalletAddress()).resolves.toBeUndefined();
  });
});
