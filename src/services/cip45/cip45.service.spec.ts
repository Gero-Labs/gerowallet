import { describe, it, expect, vi, beforeEach } from 'vitest';
import Vue from 'vue';
import type { Cip45Pairing } from './types';

interface MockConnectMessage {
  connected: boolean;
  error: boolean;
  errorMessage?: string;
  dApp: { name: string; url: string; address: string };
}

const connectMock = vi.fn();
const destroyMock = vi.fn();
const disconnectMock = vi.fn();
const constructorMock = vi.fn(); // counts how many peers the library built
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

// Reactive mock so the wallet-switch watcher notices loggedWallet.id changes.
vi.mock('@/stores/walletStore', () => ({
  walletStore: Vue.observable({ loggedWallet: { id: 'w1' } }),
  default: {},
}));

const chromeMock = {
  storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined) } },
  runtime: { getManifest: () => ({ version: '9.9.9' }) },
};
globalThis.chrome = chromeMock as unknown as typeof chrome;

describe('Cip45Service', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    // The observable walletStore singleton survives resetModules; restore its id.
    const { walletStore } = await import('@/stores/walletStore');
    walletStore.loggedWallet = { id: 'w1' };
  });

  it('pair() connects to the parsed peer id and records the pairing on success', async () => {
    const { cip45Service } = await import('./cip45.service');
    const pairPromise = cip45Service.pair('dapp-abc:peerjs:' + Date.now());
    await vi.waitFor(() => expect(connectMock).toHaveBeenCalledWith('dapp-abc'));
    callbacks['onConnect']({ connected: true, error: false, dApp: { name: 'Demo', url: 'https://demo.example', address: 'dapp-abc' } });
    await pairPromise;

    const setCalls = vi.mocked(chrome.storage.local.set).mock.calls.flat();
    expect(JSON.stringify(setCalls)).toContain('dapp-abc');
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

  it('two concurrent init calls construct exactly one GeroPeerConnect instance', async () => {
    const { cip45Service } = await import('./cip45.service');
    const existingPairing: Cip45Pairing = {
      dappPeerId: 'dapp-existing',
      dappName: 'Existing',
      dappUrl: 'https://existing.example',
      walletId: 'w1',
      pairedAt: Date.now(),
    };
    // Untyped chromeMock ref: @types/chrome's get overload trips vi.mocked().mockResolvedValue.
    chromeMock.storage.local.get.mockResolvedValue({ cip45Pairings: [existingPairing] });

    await Promise.all([cip45Service.resumeIfPaired(), cip45Service.resumeIfPaired()]);

    expect(constructorMock).toHaveBeenCalledTimes(1);
  });

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
