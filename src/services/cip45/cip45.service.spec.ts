import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Cip45Pairing } from './types';

// Adaptation vs. the brief: the brief's mock types every callback/param as
// `any`, and casts `globalThis`/`chrome.storage.local.set` with `as any`.
// This repo's eslint.config.mjs runs `@typescript-eslint/no-explicit-any` as
// an error with no test-file exemption, and tsconfig.json turns on
// `noPropertyAccessFromIndexSignature`, so the mock is typed narrowly here
// instead: a local `MockConnectMessage` shape, `unknown[]` for the messaging
// passthrough, `vi.mocked()` for the spy assertion, bracket access on the
// `Record<string, ...>` callbacks bag, and a single `as unknown as typeof
// chrome` cast for the minimal chrome stub (the existing `@ts-expect-error`
// pattern in src/chrome/mpcLoginShareCache.spec.ts only suppresses the
// diagnostic on the line directly below it, which doesn't cover the
// per-property excess/missing-member errors TS reports deeper inside a
// multi-line object literal). Test behavior is unchanged from the brief.

interface MockConnectMessage {
  connected: boolean;
  error: boolean;
  errorMessage?: string;
  dApp: { name: string; url: string; address: string };
}

const connectMock = vi.fn();
const destroyMock = vi.fn();
// Fix round 1, finding 1 coverage: counts how many GeroPeerConnect instances
// the (mocked) library constructor actually built, so the concurrent-init
// test below can assert the mutex collapsed two racing callers into one.
const constructorMock = vi.fn();
const callbacks: Record<string, (msg: MockConnectMessage) => void> = {};

vi.mock('@fabianbormann/cardano-peer-connect', () => ({
  CardanoPeerConnect: class {
    connect = connectMock;
    destroy = destroyMock;
    getIdenticon = () => 'data:image/png;base64,xyz';
    setOnConnect = (cb: (msg: MockConnectMessage) => void) => { callbacks['onConnect'] = cb; };
    setOnDisconnect = (cb: (msg: MockConnectMessage) => void) => { callbacks['onDisconnect'] = cb; };
    setOnServerShutdown = (cb: (msg: MockConnectMessage) => void) => { callbacks['onServerShutdown'] = cb; };
    setOnApiInject = () => {};
    constructor(_walletInfo: unknown, _args: unknown) { constructorMock(); }
  },
}));

const sendToBackgroundFromOptions = vi.fn().mockResolvedValue({ data: { success: true } });
vi.mock('@/chrome/messaging', () => ({
  Messaging: { sendToBackgroundFromOptions: (...a: unknown[]) => sendToBackgroundFromOptions(...a) },
}));

vi.mock('@/stores/walletStore', () => ({
  walletStore: { loggedWallet: { id: 'w1' } },
  default: {},
}));

// Minimal chrome mock, same spirit as src/chrome/mpcLoginShareCache.spec.ts
// (see the adaptation note above for why this uses a cast instead of that
// file's `@ts-expect-error` line).
const chromeMock = {
  storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) } },
  runtime: { getManifest: () => ({ version: '9.9.9' }) },
};
globalThis.chrome = chromeMock as unknown as typeof chrome;

describe('Cip45Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('pair() connects to the parsed peer id and records the pairing on success', async () => {
    const { cip45Service } = await import('./cip45.service');
    const pairPromise = cip45Service.pair('dapp-abc:peerjs:' + Date.now());
    // simulate the library confirming the connection
    await vi.waitFor(() => expect(connectMock).toHaveBeenCalledWith('dapp-abc'));
    callbacks['onConnect']({ connected: true, error: false, dApp: { name: 'Demo', url: 'https://demo.example', address: 'dapp-abc' } });
    await pairPromise;

    const setCalls = vi.mocked(chrome.storage.local.set).mock.calls.flat();
    expect(JSON.stringify(setCalls)).toContain('dapp-abc');
    // session pushed to background
    expect(sendToBackgroundFromOptions).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'CIP45_UPDATE_SESSION', data: expect.objectContaining({ status: 'connected' }) }),
    );
  });

  it('pair() rejects on invalid input without touching the peer', async () => {
    const { cip45Service } = await import('./cip45.service');
    await expect(cip45Service.pair('not:valid:at:all')).rejects.toThrow('invalid');
    expect(connectMock).not.toHaveBeenCalled();
  });

  it('isAllowedPeer() refuses unknown peers (discovery-reconnect gate)', async () => {
    const { cip45Service } = await import('./cip45.service');
    expect(await cip45Service.isAllowedPeer('dapp-stranger')).toBe(false);
  });

  // Fix round 1, finding 1: ensureStarted() used to check `if (this.wallet)
  // return` and then cross several await points before assigning
  // this.wallet, so two concurrent init-triggering calls (e.g. a user
  // pair() racing App.vue's deferred resumeIfPaired()) could both pass the
  // guard and construct two GeroPeerConnect instances.
  it('two concurrent init calls construct exactly one GeroPeerConnect instance', async () => {
    const { cip45Service } = await import('./cip45.service');
    const existingPairing: Cip45Pairing = {
      dappPeerId: 'dapp-existing',
      dappName: 'Existing',
      dappUrl: 'https://existing.example',
      walletId: 'w1',
      pairedAt: Date.now(),
    };
    // Go through the untyped `chromeMock` reference rather than
    // `chrome.storage.local.get` — @types/chrome overloads that `get` with a
    // `void`-returning callback signature, which `vi.mocked(...)
    // .mockResolvedValue()` picks up and rejects as a type error.
    chromeMock.storage.local.get.mockResolvedValue({ cip45Pairings: [existingPairing] });

    // Both calls see pairingsCache empty before either has raced through
    // ensureStarted(), so both attempt to start the discovery peer.
    await Promise.all([cip45Service.resumeIfPaired(), cip45Service.resumeIfPaired()]);

    expect(constructorMock).toHaveBeenCalledTimes(1);
  });

  // Fix round 1, finding 2: pairingsCache holds every wallet's pairings, but
  // the discovery-reconnect gate used to read it unscoped — a dApp paired
  // under a different wallet would still pass. walletStore is mocked above
  // as { loggedWallet: { id: 'w1' } }, so a pairing recorded under a
  // different walletId must not grant access.
  it('isAllowedPeer() refuses a pairing recorded under a different walletId', async () => {
    const { cip45Service } = await import('./cip45.service');
    const foreignPairing: Cip45Pairing = {
      dappPeerId: 'dapp-foreign',
      dappName: 'Foreign',
      dappUrl: 'https://foreign.example',
      walletId: 'other-wallet',
      pairedAt: Date.now(),
    };
    chromeMock.storage.local.get.mockResolvedValue({ cip45Pairings: [foreignPairing] });

    expect(await cip45Service.isAllowedPeer('dapp-foreign')).toBe(false);
  });
});
