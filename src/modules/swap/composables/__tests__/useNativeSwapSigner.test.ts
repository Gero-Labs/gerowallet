import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock factories are hoisted above all other module code, so any outer variable a
// factory *immediately* dereferences (not just closes over) must itself be created via
// vi.hoisted() — otherwise it's still in its TDZ when the factory runs.
const { sendToBackgroundFromOptions, walletState, dispatchTrezor } = vi.hoisted(() => ({
  sendToBackgroundFromOptions: vi.fn(),
  walletState: {
    keys: { payment: [{ address: 'addr_p' }], change: [{ address: 'addr_c' }], stake: [] },
    utxos: [] as unknown[],
    loggedWallet: { type: 'Normal', baseAddress: 'addr_base' } as Record<string, unknown>,
  },
  dispatchTrezor: vi.fn(),
}));

vi.mock('@/chrome/messaging', () => ({
  Messaging: { sendToBackgroundFromOptions: (...a: unknown[]) => sendToBackgroundFromOptions(...a) },
}));
vi.mock('@/models/MessageTypes', () => ({ MessageTypes: { SIGN_TX: 'SIGN_TX', VERIFY_SPENDING_PASSWORD: 'VERIFY_SPENDING_PASSWORD', TREZOR: 'TREZOR' } }));
vi.mock('@/stores/walletStore', () => ({ walletStore: walletState }));
vi.mock('@/models/types', () => ({ WalletType: { Normal: 'Normal', Ledger: 'Ledger', Trezor: 'Trezor', Keystone: 'Keystone' } }));
// isTrezorWebUsbEnabled defaults OFF — the Trezor test below asserts THIS (flag-off)
// path explicitly. dispatchTrezor is mocked out too: it transitively imports
// trezorWeb.ts, which reads `chrome.runtime.id` at module scope (no `chrome` global
// in this happy-dom test env — see src/shared/utils/trezorWeb.spec.ts), and the
// flag-off branch below never calls it anyway.
vi.mock('@/stores/featureFlagsStore', () => ({
  featureFlagsStore: { state: { flags: { isTrezorWebUsbEnabled: false } } },
}));
vi.mock('@/shared/utils/trezorDispatch', () => ({ dispatchTrezor: (...a: unknown[]) => dispatchTrezor(...a) }));

// HW-branch deps are only touched when dispatch actually reaches them (Ledger/Trezor/Keystone
// tests below just assert dispatch happens; these mocks let the module import cleanly).
vi.mock('@/shared/utils/ledger', () => ({ default: { txToLedger: vi.fn().mockResolvedValue(new Map()) } }));
vi.mock('@/shared/utils/keystone', () => ({
  createKeystoneSignRequest: vi.fn(() => ({ ur: { type: 'ur-type', cbor: Buffer.from('aa', 'hex') } })),
  parseSignature: vi.fn(() => ({ witnessSet: 'KEYSTONE_WIT' })),
}));
vi.mock('@/utils/networks', () => ({ default: { resolveNetwork: vi.fn(() => ({})) } }));
vi.mock('@cardano-sdk/core', async () => {
  const actual = await vi.importActual<typeof import('@cardano-sdk/core')>('@cardano-sdk/core');
  return {
    ...actual,
    Serialization: {
      ...actual.Serialization,
      Transaction: { fromCbor: vi.fn(() => ({ toCore: () => ({}) })) },
      TransactionWitnessSet: { fromCore: vi.fn(() => ({ toCbor: () => 'LEDGER_TREZOR_WIT' })) },
    },
  };
});

import { useNativeSwapSigner } from '../useNativeSwapSigner';

describe('useNativeSwapSigner', () => {
  beforeEach(() => {
    sendToBackgroundFromOptions.mockReset();
    dispatchTrezor.mockReset();
    walletState.loggedWallet = { type: 'Normal', baseAddress: 'addr_base' };
  });

  it('getAddresses maps walletStore.keys + baseAddress', async () => {
    const { signer } = useNativeSwapSigner({ getPassword: async () => 'pw', getPrfBytes: async () => new Uint8Array() });
    expect(await signer.getAddresses()).toEqual({ used: ['addr_p', 'addr_c'], change: 'addr_base' });
  });

  it('password path: verifies password then SIGN_TX partialSign, returns witnesses', async () => {
    sendToBackgroundFromOptions
      .mockResolvedValueOnce({ data: { success: true } })              // VERIFY_SPENDING_PASSWORD
      .mockResolvedValueOnce({ data: { witnesses: 'WIT' } });          // SIGN_TX
    const { signer } = useNativeSwapSigner({ getPassword: async () => 'pw', getPrfBytes: async () => new Uint8Array() });
    const wit = await signer.signTx('CBOR');
    expect(wit).toBe('WIT');
    const signCall = sendToBackgroundFromOptions.mock.calls.at(-1)![0];
    expect(signCall.method).toBe('SIGN_TX');
    expect(signCall.data.txCbor).toBe('CBOR');       // opaque cbor unchanged
    expect(signCall.data.partialSign).toBe(true);
    expect(signCall.data.mergeWitnesses).toBe(false);
  });

  it('PRF path: SIGN_TX with privateKeyBytes, no password', async () => {
    walletState.loggedWallet = { type: 'Normal', encryptionMethod: 'prf', baseAddress: 'addr_base' };
    sendToBackgroundFromOptions.mockResolvedValueOnce({ data: { witnesses: 'WIT2' } });
    const { signer } = useNativeSwapSigner({ getPassword: async () => '', getPrfBytes: async () => new Uint8Array([1, 2, 3]) });
    expect(await signer.signTx('CBOR')).toBe('WIT2');
    const call = sendToBackgroundFromOptions.mock.calls.at(-1)![0];
    expect(call.data.privateKeyBytes).toEqual([1, 2, 3]);
    expect(call.data.password).toBeUndefined();
  });

  it('throws when SIGN_TX returns no witnesses', async () => {
    sendToBackgroundFromOptions
      .mockResolvedValueOnce({ data: { success: true } })
      .mockResolvedValueOnce({ data: { error: 'bad password' } });
    const { signer } = useNativeSwapSigner({ getPassword: async () => 'pw', getPrfBytes: async () => new Uint8Array() });
    await expect(signer.signTx('CBOR')).rejects.toThrow(/bad password|Signing failed/);
  });

  it('throws when password verification fails', async () => {
    sendToBackgroundFromOptions.mockResolvedValueOnce({ data: { success: false } });
    const { signer } = useNativeSwapSigner({ getPassword: async () => 'wrong', getPrfBytes: async () => new Uint8Array() });
    await expect(signer.signTx('CBOR')).rejects.toThrow();
    expect(sendToBackgroundFromOptions).toHaveBeenCalledTimes(1); // never reaches SIGN_TX
  });

  it('dispatches Ledger wallets to the client-side Ledger branch (not SIGN_TX)', async () => {
    walletState.loggedWallet = { type: 'Ledger', baseAddress: 'addr_base', chain: 'Cardano', network: 'Mainnet' };
    const { signer } = useNativeSwapSigner({ getPassword: async () => '', getPrfBytes: async () => new Uint8Array() });
    const wit = await signer.signTx('CBOR');
    expect(wit).toBe('LEDGER_TREZOR_WIT');
    expect(sendToBackgroundFromOptions).not.toHaveBeenCalled();
  });

  it('dispatches Trezor wallets to MessageTypes.TREZOR via the flag-OFF path (not SIGN_TX, not dispatchTrezor)', async () => {
    // isTrezorWebUsbEnabled defaults to false (mocked above) — this asserts the
    // flag-OFF branch specifically: Messaging.sendToBackgroundFromOptions is used,
    // and the WebUSB dispatchTrezor helper is never invoked.
    walletState.loggedWallet = { type: 'Trezor', baseAddress: 'addr_base' };
    sendToBackgroundFromOptions.mockResolvedValueOnce({ data: { success: true, signatures: [] } });
    const { signer } = useNativeSwapSigner({ getPassword: async () => '', getPrfBytes: async () => new Uint8Array() });
    const wit = await signer.signTx('CBOR');
    expect(wit).toBe('LEDGER_TREZOR_WIT');
    const call = sendToBackgroundFromOptions.mock.calls.at(-1)![0];
    expect(call.method).toBe('TREZOR');
    expect(call.data.txCbor).toBe('CBOR');
    expect(dispatchTrezor).not.toHaveBeenCalled();
  });

  it('dispatches Keystone wallets to the QR flow; onKeystoneScan resolves signTx', async () => {
    walletState.loggedWallet = { type: 'Keystone', baseAddress: 'addr_base' };
    const { signer, keystone } = useNativeSwapSigner({ getPassword: async () => '', getPrfBytes: async () => new Uint8Array() });
    const pending = signer.signTx('CBOR');
    // Let the microtask queue drain so keystoneShow flips before we scan.
    await Promise.resolve();
    expect(keystone.keystoneShow.value).toBe(true);
    keystone.onKeystoneScan({} as never);
    expect(await pending).toBe('KEYSTONE_WIT');
    expect(sendToBackgroundFromOptions).not.toHaveBeenCalled();
  });

  it('failKeystone rejects signTx with the provided error message (not "cancelled")', async () => {
    walletState.loggedWallet = { type: 'Keystone', baseAddress: 'addr_base' };
    const { signer, keystone } = useNativeSwapSigner({ getPassword: async () => '', getPrfBytes: async () => new Uint8Array() });
    const pending = signer.signTx('CBOR');
    await Promise.resolve();
    expect(keystone.keystoneShow.value).toBe(true);
    keystone.failKeystone('bad QR code');
    await expect(pending).rejects.toThrow('bad QR code');
    expect(keystone.keystoneShow.value).toBe(false);
  });
});
