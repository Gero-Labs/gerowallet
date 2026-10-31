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
vi.mock('@/models/types', () => ({
  WalletType: { Normal: 'Normal', Ledger: 'Ledger', Trezor: 'Trezor', Keystone: 'Keystone' },
  Network: { MAINNET: 'Mainnet', PREPROD: 'Preprod', PREVIEW: 'Preview' },
}));
// Input values are proven from their creating transactions (provenInputs.spec.ts covers
// that with real CBOR). Here the proof answers what `proof.answer` says, by default that
// every input is exactly what the UTxO list claims.
const proof = vi.hoisted(() => ({ answer: null as null | ((refs: string[]) => { proven: Map<string, unknown>; unproven: string[] }) }));
vi.mock('@/shared/utils/provenInputs', async () => {
  const actual = await vi.importActual<typeof import('@/shared/utils/provenInputs')>('@/shared/utils/provenInputs');
  return {
    ...actual,
    proveOutputs: vi.fn(async (refs: Iterable<string>) => {
      const list = [...refs];
      if (proof.answer) return proof.answer(list);
      const claimed = new Map((walletState.utxos as [{ txId: string; index: number }, unknown][])
        .map(([txIn, txOut]) => [actual.outputRef(txIn), txOut]));
      const proven = new Map<string, unknown>();
      const unproven: string[] = [];
      for (const ref of list) {
        if (claimed.has(ref)) proven.set(ref, claimed.get(ref));
        else unproven.push(ref);
      }
      return { proven, unproven };
    }),
  };
});
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
      // An empty transaction by default: it takes nothing, so the spend check passes and
      // the dispatch tests below exercise only dispatch. The budget tests set their own.
      Transaction: { fromCbor: vi.fn(() => ({ toCore: () => ({ body: { inputs: [], outputs: [], fee: 0n }, witness: {} }) })) },
      TransactionWitnessSet: { fromCore: vi.fn(() => ({ toCbor: () => 'LEDGER_TREZOR_WIT' })) },
    },
  };
});

import { Serialization } from '@cardano-sdk/core';
import { useNativeSwapSigner } from '../useNativeSwapSigner';
import { swapSpendBound } from '../orderSpendBound';

const OWN = 'addr_test1qpdmx56dml9qtej5vxhejju492w9pfv7j9270wjh0pfe9hdzqxa4r35qhuqx29n693k4gqukhk3lfw37xkp4egvh6raq4d4rzj';
const DEX = 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x';
const TOKEN = `${'a'.repeat(56)}474552`;
const TX = 'f'.repeat(64);

// A 100 ADA wallet UTxO, sold for TOKEN: `toDex` lovelace goes to the order script, the rest returns.
function orderTx(toDex: bigint, extraAssetToDex?: [string, bigint]) {
  const assets = new Map(extraAssetToDex ? [extraAssetToDex] : []);
  return {
    body: {
      inputs: [{ txId: TX, index: 0 }],
      outputs: [
        { address: DEX, value: { coins: toDex, assets } },
        { address: OWN, value: { coins: 100_000_000n - toDex - 200_000n } },
      ],
      fee: 200_000n,
    },
    witness: {},
  };
}

describe('useNativeSwapSigner', () => {
  beforeEach(() => {
    sendToBackgroundFromOptions.mockReset();
    dispatchTrezor.mockReset();
    walletState.loggedWallet = { type: 'Normal', baseAddress: 'addr_base' };
    walletState.utxos = [];
  });

  describe('refuses an order that takes more than the quote allows', () => {
    beforeEach(() => {
      // The wallet's own address comes from its derived keys, never from the UTxO list.
      walletState.loggedWallet = { type: 'Normal', baseAddress: OWN };
      proof.answer = null;
    });
    // 50 ADA typed: the leg is 5.5 ADA of DEX overhead and the 1.2 ADA minimum service fee.
    const bound = swapSpendBound({ tokenIn: 'lovelace', amountIn: 50_000_000n });
    const signWith = async (core: unknown) => {
      vi.mocked(Serialization.Transaction.fromCbor).mockReturnValueOnce({ toCore: () => core } as never);
      walletState.utxos = [[{ txId: TX, index: 0 }, { address: OWN, value: { coins: 100_000_000n } }]];
      sendToBackgroundFromOptions
        .mockResolvedValueOnce({ data: { success: true } })
        .mockResolvedValueOnce({ data: { witnesses: 'WIT' } });
      const { signer } = useNativeSwapSigner({ getPassword: async () => 'pw', getPrfBytes: async () => new Uint8Array(), getSpendBound: () => bound });
      return signer.signTx('CBOR');
    };

    it('signs 50 ADA sold plus the order leg', async () => {
      await expect(signWith(orderTx(56_700_000n))).resolves.toBe('WIT');
    });

    it('refuses a lovelace more than the amount sold plus the leg', async () => {
      await expect(signWith(orderTx(56_700_001n))).rejects.toMatchObject({ name: 'TxIntentMismatchError', violations: ['spendExceeded'] });
    });

    it('takes a budget the host works out asynchronously', async () => {
      vi.mocked(Serialization.Transaction.fromCbor).mockReturnValueOnce({ toCore: () => orderTx(90_000_000n) } as never);
      walletState.utxos = [[{ txId: TX, index: 0 }, { address: OWN, value: { coins: 100_000_000n } }]];
      const { signer } = useNativeSwapSigner({
        getPassword: async () => 'pw', getPrfBytes: async () => new Uint8Array(), getSpendBound: async () => bound,
      });
      await expect(signer.signTx('CBOR')).rejects.toMatchObject({ name: 'TxIntentMismatchError', violations: ['spendExceeded'] });
      expect(sendToBackgroundFromOptions).not.toHaveBeenCalled();
    });

    it('refuses more ADA than the amount sold plus the leg, before asking for anything', async () => {
      await expect(signWith(orderTx(90_000_000n))).rejects.toMatchObject({ name: 'TxIntentMismatchError', violations: ['spendExceeded'] });
      expect(sendToBackgroundFromOptions).not.toHaveBeenCalled();
    });

    it('refuses a token the order was not selling', async () => {
      walletState.utxos = [];
      const core = orderTx(52_000_000n, [TOKEN, 5n]);
      core.body.inputs.push({ txId: TX, index: 1 });
      vi.mocked(Serialization.Transaction.fromCbor).mockReturnValueOnce({ toCore: () => core } as never);
      walletState.utxos = [
        [{ txId: TX, index: 0 }, { address: OWN, value: { coins: 100_000_000n } }],
        [{ txId: TX, index: 1 }, { address: OWN, value: { coins: 0n, assets: new Map([[TOKEN, 5n]]) } }],
      ];
      const { signer } = useNativeSwapSigner({ getPassword: async () => 'pw', getPrfBytes: async () => new Uint8Array(), getSpendBound: () => bound });
      await expect(signer.signTx('CBOR')).rejects.toMatchObject({ violations: ['spendExceeded'] });
    });

    it('without a quote, refuses an order that sends ADA away', async () => {
      vi.mocked(Serialization.Transaction.fromCbor).mockReturnValueOnce({ toCore: () => orderTx(10_000_000n) } as never);
      walletState.utxos = [[{ txId: TX, index: 0 }, { address: OWN, value: { coins: 100_000_000n } }]];
      const { signer } = useNativeSwapSigner({ getPassword: async () => 'pw', getPrfBytes: async () => new Uint8Array() });
      await expect(signer.signTx('CBOR')).rejects.toMatchObject({ name: 'TxIntentMismatchError' });
    });

    it('refuses an order whose input the UTxO list understates', async () => {
      // gero-sync claims 100 ADA; the transaction that created the input says 1,000 ADA.
      proof.answer = (refs) => ({
        proven: new Map(refs.map((ref) => [ref, { address: OWN, value: { coins: 1_000_000_000n } }])),
        unproven: [],
      });
      await expect(signWith(orderTx(56_700_000n))).rejects.toMatchObject({ name: 'TxIntentMismatchError', violations: ['misreportedInput'] });
      expect(sendToBackgroundFromOptions).not.toHaveBeenCalled();
    });

    it('refuses an order with an input it cannot prove', async () => {
      proof.answer = (refs) => ({ proven: new Map(), unproven: refs });
      await expect(signWith(orderTx(56_700_000n))).rejects.toMatchObject({ name: 'TxIntentMismatchError', violations: ['unprovenInput'] });
      expect(sendToBackgroundFromOptions).not.toHaveBeenCalled();
    });

    it('does not count an address the UTxO list names as the wallet\'s change', async () => {
      // A UTxO list that names the DEX address as the wallet's: the "change" back to it is still an outflow.
      const core = orderTx(62_000_000n);
      core.body.outputs[1].address = DEX;
      vi.mocked(Serialization.Transaction.fromCbor).mockReturnValueOnce({ toCore: () => core } as never);
      walletState.utxos = [
        [{ txId: TX, index: 0 }, { address: OWN, value: { coins: 100_000_000n } }],
        [{ txId: TX, index: 5 }, { address: DEX, value: { coins: 1_000_000n } }],
      ];
      const { signer } = useNativeSwapSigner({ getPassword: async () => 'pw', getPrfBytes: async () => new Uint8Array(), getSpendBound: () => bound });
      await expect(signer.signTx('CBOR')).rejects.toMatchObject({ violations: ['spendExceeded'] });
    });

    it('refuses a transaction it cannot decode', async () => {
      vi.mocked(Serialization.Transaction.fromCbor).mockImplementationOnce(() => { throw new Error('bad cbor'); });
      const { signer } = useNativeSwapSigner({ getPassword: async () => 'pw', getPrfBytes: async () => new Uint8Array() });
      await expect(signer.signTx('CBOR')).rejects.toMatchObject({ name: 'TxIntentMismatchError' });
      expect(sendToBackgroundFromOptions).not.toHaveBeenCalled();
    });
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
    // The order is checked (inputs proven) before the QR dialog opens.
    await vi.waitFor(() => expect(keystone.keystoneShow.value).toBe(true));
    keystone.onKeystoneScan({} as never);
    expect(await pending).toBe('KEYSTONE_WIT');
    expect(sendToBackgroundFromOptions).not.toHaveBeenCalled();
  });

  it('failKeystone rejects signTx with the provided error message (not "cancelled")', async () => {
    walletState.loggedWallet = { type: 'Keystone', baseAddress: 'addr_base' };
    const { signer, keystone } = useNativeSwapSigner({ getPassword: async () => '', getPrfBytes: async () => new Uint8Array() });
    const pending = signer.signTx('CBOR');
    await vi.waitFor(() => expect(keystone.keystoneShow.value).toBe(true));
    keystone.failKeystone('bad QR code');
    await expect(pending).rejects.toThrow('bad QR code');
    expect(keystone.keystoneShow.value).toBe(false);
  });
});
