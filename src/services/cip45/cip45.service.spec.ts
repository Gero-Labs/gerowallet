import { describe, it, expect, vi, beforeEach } from 'vitest';

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
    constructor(_walletInfo: unknown, _args: unknown) {}
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
});
