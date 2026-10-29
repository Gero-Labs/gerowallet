// The page-side device signer shared by the swap widget and Gero's own CIP-113 Send: which
// wallets it signs for, the exact bytes each device is handed, and that a worker refusal
// comes back as the refusal message (Send reads it as "build again").
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { send, walletState, flags, dispatchTrezor, txToLedger, createKeystoneSignRequest } = vi.hoisted(() => ({
  send: vi.fn(),
  walletState: {
    keys: { payment: [], change: [], stake: [] },
    utxos: [] as unknown[],
    loggedWallet: { type: 'Ledger', chain: 'Cardano', network: 'Preprod' } as Record<string, unknown>,
  },
  flags: { isTrezorWebUsbEnabled: false },
  dispatchTrezor: vi.fn(),
  txToLedger: vi.fn(),
  createKeystoneSignRequest: vi.fn(),
}));

vi.mock('@/chrome/messaging', () => ({
  Messaging: { sendToBackgroundFromOptions: (...args: unknown[]) => send(...args) },
}));
vi.mock('@/stores/walletStore', () => ({ walletStore: walletState }));
vi.mock('@/stores/featureFlagsStore', () => ({ featureFlagsStore: { state: { flags } } }));
vi.mock('@/shared/utils/trezorDispatch', () => ({ dispatchTrezor: (...args: unknown[]) => dispatchTrezor(...args) }));
vi.mock('@/shared/utils/ledger', () => ({ default: { txToLedger: (...args: unknown[]) => txToLedger(...args) } }));
vi.mock('@/shared/utils/keystone', () => ({
  createKeystoneSignRequest: (...args: unknown[]) => createKeystoneSignRequest(...args),
  parseSignature: () => ({ witnessSet: 'KEYSTONE_WITNESSES' }),
}));
vi.mock('@/utils/networks', () => ({ default: { resolveNetwork: () => ({ networkId: 0 }) } }));
vi.mock('@cardano-sdk/core', async () => {
  const actual = await vi.importActual<typeof import('@cardano-sdk/core')>('@cardano-sdk/core');
  return {
    ...actual,
    Serialization: {
      ...actual.Serialization,
      Transaction: { fromCbor: vi.fn((cbor: string) => ({ cbor, toCore: () => ({ parsedFrom: cbor }) })) },
      TransactionWitnessSet: { fromCore: vi.fn(() => ({ toCbor: () => 'DEVICE_WITNESSES' })) },
    },
  };
});

import { signsOnDevice, useHardwareTxSigner } from './useHardwareTxSigner';
import { MessageTypes } from '@/models/MessageTypes';
import { CIP113_SIGN_REFUSAL_MESSAGE } from '@/chrome/config';

const TX_CBOR = '84a400';

describe('signsOnDevice', () => {
  it('is true for Ledger, Trezor and Keystone only', () => {
    for (const type of ['Ledger', 'Trezor', 'Keystone']) expect(signsOnDevice(type)).toBe(true);
    for (const type of ['Normal', 'Google', 'Watch', 'ledger', '', null, undefined]) expect(signsOnDevice(type)).toBe(false);
  });
});

describe('useHardwareTxSigner', () => {
  beforeEach(() => {
    send.mockReset();
    dispatchTrezor.mockReset();
    txToLedger.mockReset();
    createKeystoneSignRequest.mockReset();
    flags.isTrezorWebUsbEnabled = false;
  });

  it('refuses a wallet that does not sign on a device, touching none', async () => {
    walletState.loggedWallet = { type: 'Normal', chain: 'Cardano', network: 'Preprod' };
    await expect(useHardwareTxSigner().sign(TX_CBOR)).rejects.toThrow('does not sign on a hardware device');
    expect(txToLedger).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(dispatchTrezor).not.toHaveBeenCalled();
    expect(createKeystoneSignRequest).not.toHaveBeenCalled();
  });

  it('hands the Ledger these exact bytes, over USB unless the user chose Bluetooth', async () => {
    walletState.loggedWallet = { type: 'Ledger', chain: 'Cardano', network: 'Preprod' };
    txToLedger.mockResolvedValue(new Map());
    let bluetooth = false;
    const signer = useHardwareTxSigner({ getIsBT: () => bluetooth });

    expect(await signer.sign(TX_CBOR)).toBe('DEVICE_WITNESSES');
    expect(txToLedger.mock.calls[0][3]).toBe(true); // isUsb
    expect(txToLedger.mock.calls[0][5]).toBe(TX_CBOR);

    bluetooth = true;
    await signer.sign(TX_CBOR);
    expect(txToLedger.mock.calls[1][3]).toBe(false);
  });

  it('passes a Ledger refusal through unchanged', async () => {
    walletState.loggedWallet = { type: 'Ledger', chain: 'Cardano', network: 'Preprod' };
    txToLedger.mockRejectedValue(new Error(CIP113_SIGN_REFUSAL_MESSAGE));
    await expect(useHardwareTxSigner().sign(TX_CBOR)).rejects.toThrow(CIP113_SIGN_REFUSAL_MESSAGE);
  });

  it("asks the worker's Trezor handler, or WebUSB when that flag is on, and reports a refusal by its message", async () => {
    walletState.loggedWallet = { type: 'Trezor', chain: 'Cardano', network: 'Preprod' };
    send.mockResolvedValue({ data: { success: false, error: CIP113_SIGN_REFUSAL_MESSAGE } });
    await expect(useHardwareTxSigner().sign(TX_CBOR)).rejects.toThrow(CIP113_SIGN_REFUSAL_MESSAGE);
    expect(send).toHaveBeenCalledWith({ method: MessageTypes.TREZOR, data: { method: 'signTx', txCbor: TX_CBOR } });

    flags.isTrezorWebUsbEnabled = true;
    dispatchTrezor.mockResolvedValue({ data: { success: true, signatures: [['aa', 'bb']] } });
    expect(await useHardwareTxSigner().sign(TX_CBOR)).toBe('DEVICE_WITNESSES');
    expect(dispatchTrezor).toHaveBeenCalledWith({ method: 'signTx', txCbor: TX_CBOR });
  });

  it('waits for the Keystone QR answer, and rejects when the dialog is closed', async () => {
    walletState.loggedWallet = { type: 'Keystone', chain: 'Cardano', network: 'Preprod' };
    createKeystoneSignRequest.mockResolvedValue({ ur: { type: 'cardano-sign-request', cbor: Buffer.from('aa', 'hex') } });
    const signer = useHardwareTxSigner();

    const signed = signer.sign(TX_CBOR);
    await vi.waitFor(() => expect(signer.keystone.keystoneShow.value).toBe(true));
    expect((createKeystoneSignRequest.mock.calls[0][0] as { cbor: string }).cbor).toBe(TX_CBOR);
    signer.keystone.onKeystoneScan({} as never);
    expect(await signed).toBe('KEYSTONE_WITNESSES');
    expect(signer.keystone.keystoneShow.value).toBe(false);

    const cancelled = signer.sign(TX_CBOR);
    await vi.waitFor(() => expect(signer.keystone.keystoneShow.value).toBe(true));
    signer.keystone.cancelKeystone();
    await expect(cancelled).rejects.toThrow('cancelled');
  });
});
