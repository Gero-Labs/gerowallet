import { describe, it, expect, vi, beforeEach } from 'vitest';
import Vue from 'vue';
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
// Fix round 2, finding 1 coverage: lets the wallet-switch test assert the
// watcher tore the session down via the library's own disconnect() rather
// than only inferring it from the pushed session update.
const disconnectMock = vi.fn();
// Fix round 1, finding 1 coverage: counts how many GeroPeerConnect instances
// the (mocked) library constructor actually built, so the concurrent-init
// test below can assert the mutex collapsed two racing callers into one.
const constructorMock = vi.fn();
const callbacks: Record<string, (msg: MockConnectMessage) => void> = {};

vi.mock('@fabianbormann/cardano-peer-connect', () => ({
  CardanoPeerConnect: class {
    connect = connectMock;
    destroy = destroyMock;
    disconnect = disconnectMock;
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

// Fix round 2, finding 1: the real walletStore is a `Vue.observable` (see
// stores/walletStore.ts) — Cip45Service's wallet-switch watcher relies on
// Vue's reactivity to notice `loggedWallet.id` changes, so the mock has to
// be reactive too, or mutating `loggedWallet` in the test below would never
// trigger the watcher.
vi.mock('@/stores/walletStore', () => ({
  walletStore: Vue.observable({ loggedWallet: { id: 'w1' } }),
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
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    // `vi.resetModules()` clears the module registry so cip45.service.ts
    // gets a fresh instance per test, but the mocked walletStore's
    // `Vue.observable` singleton is not guaranteed to be re-created by that
    // reset — the wallet-switch test below mutates `loggedWallet` in place,
    // so restore the baseline id explicitly rather than relying on module
    // re-evaluation to undo it.
    const { walletStore } = await import('@/stores/walletStore');
    walletStore.loggedWallet = { id: 'w1' };
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

  // Fix round 2, finding 1: a live CIP-45 session used to survive a wallet
  // switch, so a dApp paired to wallet A could keep reading wallet B's data
  // once the user switched. Connect a session under 'w1' (the mocked
  // walletStore's initial loggedWallet id), then flip that id and confirm
  // the wallet-switch watcher tears the session down: the library mock's
  // own disconnect() fires, and the pushed session update flips to 'idle'.
  it('a wallet switch while a session is connected disconnects the session', async () => {
    const { cip45Service } = await import('./cip45.service');
    const { walletStore } = await import('@/stores/walletStore');

    const pairPromise = cip45Service.pair('dapp-abc:peerjs:' + Date.now());
    await vi.waitFor(() => expect(connectMock).toHaveBeenCalledWith('dapp-abc'));
    callbacks['onConnect']({ connected: true, error: false, dApp: { name: 'Demo', url: 'https://demo.example', address: 'dapp-abc' } });
    await pairPromise;

    sendToBackgroundFromOptions.mockClear();
    walletStore.loggedWallet = { id: 'w2' };

    await vi.waitFor(() => expect(disconnectMock).toHaveBeenCalled());
    expect(sendToBackgroundFromOptions).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'CIP45_UPDATE_SESSION', data: expect.objectContaining({ status: 'idle' }) }),
    );
  });

  // Fix round 2, finding 3: recordPairing() used to de-dupe by bare
  // dappPeerId against the flat on-disk list (every wallet's pairings share
  // it), so a dApp already paired under a different wallet never got its
  // own record persisted for the currently-logged-in wallet — and that
  // wallet's reconnect gate (scoped by walletId) would then refuse a dApp
  // it had just connected to. Seed a pairing for 'other-wallet' + 'dapp-x',
  // then pair 'dapp-x' under 'w1' and confirm the persisted list holds both.
  it('recordPairing() persists a second record when the same dApp is paired under a different wallet', async () => {
    const { cip45Service } = await import('./cip45.service');
    const existingPairing: Cip45Pairing = {
      dappPeerId: 'dapp-x',
      dappName: 'Existing',
      dappUrl: 'https://existing.example',
      walletId: 'other-wallet',
      pairedAt: Date.now(),
    };
    chromeMock.storage.local.get.mockResolvedValue({ cip45Pairings: [existingPairing] });

    const pairPromise = cip45Service.pair('dapp-x:peerjs:' + Date.now());
    await vi.waitFor(() => expect(connectMock).toHaveBeenCalledWith('dapp-x'));
    callbacks['onConnect']({ connected: true, error: false, dApp: { name: 'Demo', url: 'https://demo.example', address: 'dapp-x' } });
    await pairPromise;

    // Cast through `unknown` (rather than straight to a tuple type) since
    // @types/chrome overloads `storage.local.set` with a callback-accepting
    // signature that doesn't structurally match a plain items-object tuple.
    const setCalls = vi.mocked(chrome.storage.local.set).mock.calls.flat() as unknown[];
    const pairingsCall = setCalls.find(
      (arg): arg is Record<string, unknown> => typeof arg === 'object' && arg !== null && 'cip45Pairings' in arg,
    );
    const persisted = pairingsCall?.['cip45Pairings'] as Cip45Pairing[];
    expect(persisted).toHaveLength(2);
    expect(persisted).toEqual(expect.arrayContaining([
      expect.objectContaining({ dappPeerId: 'dapp-x', walletId: 'other-wallet' }),
      expect.objectContaining({ dappPeerId: 'dapp-x', walletId: 'w1' }),
    ]));
  });
});
