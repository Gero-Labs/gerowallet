import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
    connect(identifier: string) { connectMock(identifier); return identifier; }
    injectApi = vi.fn();
    destroy = destroyMock;
    disconnect = disconnectMock;
    getIdenticon = () => 'data:image/png;base64,xyz';
    setOnConnect = (cb: (msg: MockConnectMessage) => void) => { callbacks['onConnect'] = cb; };
    setOnDisconnect = (cb: (msg: MockConnectMessage) => void) => { callbacks['onDisconnect'] = cb; };
    setOnServerShutdown = (cb: (msg: MockConnectMessage) => void) => { callbacks['onServerShutdown'] = cb; };
    setOnApiInject = () => {};
    constructor(_walletInfo: unknown, _args: unknown) { constructorMock(this); }
  },
}));

const sendToBackgroundFromOptions = vi.fn().mockResolvedValue({ data: { success: true } });
vi.mock('@/chrome/messaging', () => ({
  Messaging: { sendToBackgroundFromOptions: (...a: unknown[]) => sendToBackgroundFromOptions(...a) },
}));

// Reactive mock so the wallet-switch watcher notices loggedWallet.id changes.
vi.mock('@/stores/walletStore', () => ({
  walletStore: Vue.observable({ loggedWallet: { id: 'w1', chain: 'Cardano', network: 'Mainnet' }, isLocked: false }),
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
    chromeMock.storage.local.get.mockResolvedValue({});
    chromeMock.storage.local.set.mockResolvedValue(undefined);
    sendToBackgroundFromOptions.mockImplementation(async (request) => ({ data: {
      success: true, result: 'balance',
      ...(request.method === 'CIP45_BEGIN_SESSION' ? { authorization: {
        ...request.data.context, dappPeerId: request.data.dappPeerId, sessionId: crypto.randomUUID(),
      } } : {}),
    } }));
    vi.resetModules();
    // The observable walletStore singleton survives resetModules; restore its id.
    const { walletStore } = await import('@/stores/walletStore');
    walletStore.isLocked = false;
    walletStore.loggedWallet = { id: 'w1', chain: 'Cardano', network: 'Mainnet' };
  });

  afterEach(async () => {
    const { cip45Service } = await import('./cip45.service');
    await cip45Service.disconnect();
    vi.useRealTimers();
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
    const oldPeer = constructorMock.mock.calls[0][0];
    expect(await oldPeer.getBalance()).toBe('balance');

    sendToBackgroundFromOptions.mockClear();
    walletStore.loggedWallet = { id: 'w2', chain: 'Cardano', network: 'Mainnet' };

    expect(cip45Service.isSessionPeerAllowed()).toBe(false);
    await expect(oldPeer.getBalance()).rejects.toThrow('expired');
    expect(sendToBackgroundFromOptions.mock.calls.some(([r]) => r.method === 'CIP45_INVOKE')).toBe(false);
    await vi.waitFor(() => expect(destroyMock).toHaveBeenCalled());
    expect(sendToBackgroundFromOptions).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'CIP45_END_SESSION' }),
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
  it('does not persist a late pairing after switching wallets, even after switching back', async () => {
    const { cip45Service } = await import('./cip45.service');
    const { walletStore } = await import('@/stores/walletStore');
    const result = cip45Service.pair('dapp-abc').catch(error => error);
    await vi.waitFor(() => expect(connectMock).toHaveBeenCalled());
    const lateCallback = callbacks['onConnect'];
    const original = walletStore.loggedWallet;
    walletStore.loggedWallet = { ...original, id: 'w2' };
    walletStore.loggedWallet = original;
    lateCallback({ connected: true, error: false, dApp: { name: 'Demo', url: '', address: 'dapp-abc' } });
    expect(await result).toBeInstanceOf(Error);
    expect(JSON.stringify(chromeMock.storage.local.set.mock.calls)).not.toContain('cip45Pairings');
    expect(cip45Service.isSessionPeerAllowed()).toBe(false);
  });

  it('cancels initialization while storage is pending', async () => {
    const { cip45Service } = await import('./cip45.service');
    const { walletStore } = await import('@/stores/walletStore');
    let finishRead!: (value: object) => void;
    chromeMock.storage.local.get.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
    const result = cip45Service.pair('dapp-abc').catch(error => error);
    await vi.waitFor(() => expect(finishRead).toBeDefined());
    walletStore.loggedWallet = { ...walletStore.loggedWallet, id: 'w2' };
    expect(await result).toBeInstanceOf(Error);
    finishRead({});
    await Promise.resolve();
    expect(constructorMock).not.toHaveBeenCalled();
  });

  it('rejects overlapping attempts and disconnect cancels the pending attempt immediately', async () => {
    const { cip45Service } = await import('./cip45.service');
    const result = cip45Service.pair('dapp-abc').catch(error => error);
    await vi.waitFor(() => expect(connectMock).toHaveBeenCalled());
    await expect(cip45Service.pair('dapp-other')).rejects.toThrow('already in progress');
    await cip45Service.disconnect();
    expect(await result).toBeInstanceOf(Error);
    expect(destroyMock).toHaveBeenCalledTimes(1);
    expect(disconnectMock).not.toHaveBeenCalled(); // No remote acknowledgement required.
  });

  it('ignores old callbacks after timeout fallback and connects the replacement transport', async () => {
    vi.useFakeTimers();
    const { cip45Service } = await import('./cip45.service');
    const result = cip45Service.pair('dapp-abc');
    await vi.waitFor(() => expect(connectMock).toHaveBeenCalledTimes(1));
    const lateCallback = callbacks['onConnect'];
    await vi.advanceTimersByTimeAsync(15000);
    await vi.waitFor(() => expect(connectMock).toHaveBeenCalledTimes(2));
    lateCallback({ connected: true, error: false, dApp: { name: 'Stale', url: '', address: 'dapp-abc' } });
    callbacks['onConnect']({ connected: true, error: false, dApp: { name: 'Fresh', url: '', address: 'dapp-abc' } });
    await result;
    expect(constructorMock).toHaveBeenCalledTimes(2);
    expect(destroyMock).toHaveBeenCalledTimes(1);
    const writes = JSON.stringify(chromeMock.storage.local.set.mock.calls);
    expect(writes).toContain('Fresh');
    expect(writes).not.toContain('Stale');
    await expect(constructorMock.mock.calls[0][0].getBalance()).rejects.toThrow('expired');
  });

  it('does not deliver an RPC response after the session is revoked', async () => {
    const { cip45Service } = await import('./cip45.service');
    const pairing = cip45Service.pair('dapp-abc');
    await vi.waitFor(() => expect(connectMock).toHaveBeenCalled());
    callbacks['onConnect']({ connected: true, error: false, dApp: { name: 'Demo', url: '', address: 'dapp-abc' } });
    await pairing;
    let finishRpc!: (value: object) => void;
    sendToBackgroundFromOptions.mockImplementationOnce(() => new Promise(resolve => { finishRpc = resolve; }));
    const result = constructorMock.mock.calls[0][0].signTx('tx', false);
    await cip45Service.disconnect();
    finishRpc({ data: { success: true, result: 'witness' } });
    await expect(result).rejects.toThrow('expired');
  });

  it('forgets only the current wallet pairing for a shared peer', async () => {
    const { cip45Service } = await import('./cip45.service');
    chromeMock.storage.local.get.mockResolvedValue({ cip45Pairings: [
      { dappPeerId: 'shared', walletId: 'w1' }, { dappPeerId: 'shared', walletId: 'w2' },
    ] });
    await cip45Service.removePairing('shared');
    expect(chromeMock.storage.local.set).toHaveBeenCalledWith({ cip45Pairings: [{ dappPeerId: 'shared', walletId: 'w2' }] });
  });

  it('a wallet switch during background activation cannot persist the pairing', async () => {
    const { cip45Service } = await import('./cip45.service');
    const { walletStore } = await import('@/stores/walletStore');
    const result = cip45Service.pair('dapp-abc').catch(error => error);
    await vi.waitFor(() => expect(connectMock).toHaveBeenCalled());
    let finishActivation!: (value: object) => void;
    sendToBackgroundFromOptions.mockImplementationOnce(() => new Promise(resolve => { finishActivation = resolve; }));
    callbacks['onConnect']({ connected: true, error: false, dApp: { name: 'Demo', url: '', address: 'dapp-abc' } });
    walletStore.loggedWallet = { ...walletStore.loggedWallet, id: 'w2' };
    expect(await result).toBeInstanceOf(Error);
    finishActivation({ data: { success: true } });
    await Promise.resolve();
    expect(JSON.stringify(chromeMock.storage.local.set.mock.calls)).not.toContain('cip45Pairings');
    expect(cip45Service.isSessionPeerAllowed()).toBe(false);
  });

  it('locks revoke a connected transport synchronously', async () => {
    const { cip45Service } = await import('./cip45.service');
    const { walletStore } = await import('@/stores/walletStore');
    const pairing = cip45Service.pair('dapp-abc');
    await vi.waitFor(() => expect(connectMock).toHaveBeenCalled());
    callbacks['onConnect']({ connected: true, error: false, dApp: { name: 'Demo', url: '', address: 'dapp-abc' } });
    await pairing;
    walletStore.isLocked = true;
    expect(destroyMock).toHaveBeenCalledTimes(1);
    walletStore.isLocked = false;
    await expect(constructorMock.mock.calls[0][0].getBalance()).rejects.toThrow('expired');
  });

  it('UI hydration blocks calls while empty and keeps a same-wallet connection', async () => {
    const { cip45Service } = await import('./cip45.service');
    const { walletStore } = await import('@/stores/walletStore');
    const pairing = cip45Service.pair('dapp-abc');
    await vi.waitFor(() => expect(connectMock).toHaveBeenCalled());
    callbacks['onConnect']({ connected: true, error: false, dApp: { name: 'Demo', url: '', address: 'dapp-abc' } });
    await pairing;
    const wallet = walletStore.loggedWallet;
    walletStore.loggedWallet = null;
    await expect(constructorMock.mock.calls[0][0].getBalance()).rejects.toThrow('expired');
    walletStore.loggedWallet = wallet;
    expect(destroyMock).not.toHaveBeenCalled();
    expect(await constructorMock.mock.calls[0][0].getBalance()).toBe('balance');
  });

  it('discovery reconnect starts a fresh authorized attempt only for an owned pairing', async () => {
    const { cip45Service } = await import('./cip45.service');
    chromeMock.storage.local.get.mockResolvedValue({ cip45Pairings: [{ walletId: 'w1', dappPeerId: 'known' }] });
    await cip45Service.resumeIfPaired();
    const discovery = constructorMock.mock.calls[0][0];
    discovery.connect('unknown');
    expect(connectMock).not.toHaveBeenCalled();
    discovery.connect('known');
    await vi.waitFor(() => expect(connectMock).toHaveBeenCalledWith('known'));
    expect(constructorMock).toHaveBeenCalledTimes(2);
    callbacks['onConnect']({ connected: true, error: false, dApp: { name: 'Known', url: '', address: 'known' } });
    await vi.waitFor(() => expect(cip45Service.isSessionPeerAllowed()).toBe(true));
    await expect(discovery.getBalance()).rejects.toThrow('expired');
  });

});
