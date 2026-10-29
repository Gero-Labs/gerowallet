// CIP113_PREPARE_TRANSFER's work, without the message plumbing: the background chooses the
// inputs, asks Nexus, and hands back only a transaction it verified. Nexus is replaced by a
// stub that answers with T3, the real transfer it built on preprod.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { Blockchain, Network } from '@/models/types';
import { Cip113PrepareError, type Cip113PrepareEnv, ownKeys, prepareCip113Transfer } from './cip113PrepareTransfer';
import { isCip113SendHardware } from '@/utils/cip113Deployments';
import type { Cip113TransferBuildRequest } from '@/api/nexus-tx-api';
import {
  FEE_INPUT,
  MICKY_INPUT,
  MICKY_UNIT,
  T3_RECIPIENT_ADDRESS,
  T3_TX_ID,
  T3_UNSIGNED_TX,
  TEST_WALLET_BASE_ADDRESS,
  TEST_WALLET_PAYMENT_KEY_HASH,
  TEST_WALLET_PLB_ADDRESS,
  TEST_WALLET_STAKE_KEY_HASH,
} from './__fixtures__/cip113Preprod';

// The hardware gate ships empty; a test opens it by handing the real check another list.
vi.mock('@/utils/cip113Deployments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/cip113Deployments')>();
  return { ...actual, isCip113SendHardware: vi.fn(actual.isCip113SendHardware) };
});

function utxo(txId: string, index: number, address: string, coins: bigint, assets?: Record<string, bigint>): Cardano.Utxo {
  return [
    { txId: Cardano.TransactionId(txId), index, address: address as Cardano.PaymentAddress },
    {
      address: address as Cardano.PaymentAddress,
      value: { coins, ...(assets ? { assets: new Map(Object.entries(assets)) as Cardano.TokenMap } : {}) },
    },
  ] as Cardano.Utxo;
}

const MICKY_UTXO = utxo(MICKY_INPUT.txId, 0, TEST_WALLET_PLB_ADDRESS, MICKY_INPUT.coins, { [MICKY_UNIT]: MICKY_INPUT.quantity });
const FEE_UTXO = utxo(FEE_INPUT.txId, 0, TEST_WALLET_BASE_ADDRESS, FEE_INPUT.coins);
const RESERVED = utxo('99'.repeat(32), 0, TEST_WALLET_BASE_ADDRESS, 5_000_000n);

const KEYS = {
  payment: [{ address: TEST_WALLET_BASE_ADDRESS, cred: TEST_WALLET_PAYMENT_KEY_HASH, path: "m/1852'/1815'/0'/0/0" }],
  change: [],
  stake: [{ cred: TEST_WALLET_STAKE_KEY_HASH, path: "m/1852'/1815'/0'/2/0" }],
};

const REQUEST = { unit: MICKY_UNIT, quantity: '1000000', recipientAddress: T3_RECIPIENT_ADDRESS };

function env(overrides: Partial<Cip113PrepareEnv> = {}): Cip113PrepareEnv {
  return {
    walletId: 1,
    chain: Blockchain.CARDANO,
    network: Network.PREPROD,
    walletType: 'Normal',
    programmableUtxos: [MICKY_UTXO],
    ownUtxos: [FEE_UTXO, RESERVED],
    keys: KEYS,
    reservedCollateral: RESERVED,
    changeAddress: TEST_WALLET_BASE_ADDRESS,
    build: vi.fn().mockResolvedValue({ tx_cbor: T3_UNSIGNED_TX, tx_hash: T3_TX_ID }),
    ...overrides,
  };
}

async function refusal(promise: Promise<unknown>): Promise<Cip113PrepareError> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(Cip113PrepareError);
    return e as Cip113PrepareError;
  }
  throw new Error('expected the prepare to be refused');
}

describe('prepareCip113Transfer', () => {
  it('chooses the inputs, asks Nexus and returns the verified transaction untouched', async () => {
    const e = env();
    const prepared = await prepareCip113Transfer(REQUEST, e);

    expect(prepared.txCbor).toBe(T3_UNSIGNED_TX);
    expect(prepared.txId).toBe(T3_TX_ID);
    expect(prepared.programmableRefs).toEqual([`${MICKY_INPUT.txId}#0`]);
    expect(prepared.summary.recipientOwner.type).toBe('stake_key');
    expect(prepared.sponsoredCollateralRef).toBeUndefined();

    const [sent, network] = (e.build as ReturnType<typeof vi.fn>).mock.calls[0] as [Cip113TransferBuildRequest, string];
    expect(network).toBe(Network.PREPROD);
    expect(sent.programmableInputs).toEqual([{ txHash: MICKY_INPUT.txId, outputIndex: 0 }]);
    // The reserved dApp collateral is not offered for the fee.
    expect(sent.feeInputs.map((i) => i.txHash)).toEqual([FEE_INPUT.txId]);
    expect(sent).toMatchObject({ unit: MICKY_UNIT, quantity: '1000000', recipientAddress: T3_RECIPIENT_ADDRESS, changeAddress: TEST_WALLET_BASE_ADDRESS });
  });

  it('refuses whatever does not verify, and never returns it', async () => {
    const tx = Serialization.Transaction.fromCbor(HexBlob(T3_UNSIGNED_TX)).toCore();
    tx.body.fee = 5_000_000n;
    const tampered = Serialization.Transaction.fromCore(tx);
    const error = await refusal(prepareCip113Transfer(REQUEST, env({
      build: vi.fn().mockResolvedValue({ tx_cbor: tampered.toCbor(), tx_hash: tampered.getId() }),
    })));
    expect(error.code).toBe('VERIFY_FAILED');
    expect(error.message).toContain('(FEE)');
  });

  it("passes a Nexus 422 errorCode through, and calls anything else BUILD_FAILED", async () => {
    const unsupported = Object.assign(new Error('module not supported'), {
      response: { status: 422, data: { errorCode: 'MODULE_UNSUPPORTED' } },
    });
    expect((await refusal(prepareCip113Transfer(REQUEST, env({ build: vi.fn().mockRejectedValue(unsupported) })))).code)
      .toBe('MODULE_UNSUPPORTED');
    expect((await refusal(prepareCip113Transfer(REQUEST, env({ build: vi.fn().mockRejectedValue(new Error('timeout')) })))).code)
      .toBe('BUILD_FAILED');
    expect((await refusal(prepareCip113Transfer(REQUEST, env({ build: vi.fn().mockResolvedValue({}) })))).code)
      .toBe('BUILD_FAILED');
  });

  it('refuses hardware, watch and non-Cardano wallets before anything is built', async () => {
    for (const overrides of [{ walletType: 'Ledger' }, { walletType: 'Trezor' }, { walletType: 'Keystone' }, { walletType: 'Watch' }, { chain: Blockchain.BITCOIN }]) {
      const e = env(overrides);
      expect((await refusal(prepareCip113Transfer(REQUEST, e))).code).toBe('WALLET_UNSUPPORTED');
      expect(e.build).not.toHaveBeenCalled();
    }
  });

  describe('with hardware Send allowed', () => {
    const real = vi.mocked(isCip113SendHardware).getMockImplementation()!;
    beforeEach(() => {
      vi.mocked(isCip113SendHardware).mockImplementation((type) => real(type, ['Ledger', 'Trezor', 'Keystone']));
    });
    afterEach(() => {
      vi.mocked(isCip113SendHardware).mockImplementation(real);
    });

    it('builds the same verified transaction for a listed device', async () => {
      for (const walletType of ['Ledger', 'Trezor', 'Keystone']) {
        const prepared = await prepareCip113Transfer(REQUEST, env({ walletType }));
        expect(prepared.txCbor).toBe(T3_UNSIGNED_TX);
        expect(prepared.txId).toBe(T3_TX_ID);
      }
    });

    it('still refuses a watch wallet and another chain', async () => {
      for (const overrides of [{ walletType: 'Watch' }, { walletType: 'Ledger', chain: Blockchain.BITCOIN }]) {
        const e = env(overrides);
        expect((await refusal(prepareCip113Transfer(REQUEST, e))).code).toBe('WALLET_UNSUPPORTED');
        expect(e.build).not.toHaveBeenCalled();
      }
    });
  });

  it('refuses mainnet (decision 11)', async () => {
    expect((await refusal(prepareCip113Transfer(REQUEST, env({ network: Network.MAINNET })))).code).toBe('NETWORK_UNSUPPORTED');
  });

  it('refuses a malformed request', async () => {
    for (const request of [{ ...REQUEST, quantity: '0' }, { ...REQUEST, quantity: '1.5' }, { ...REQUEST, unit: 'lovelace' }, { ...REQUEST, recipientAddress: '' }, null]) {
      expect((await refusal(prepareCip113Transfer(request, env()))).code).toBe('INVALID_REQUEST');
    }
  });

  it('says how much one transfer can send when the wallet holds too little', async () => {
    const error = await refusal(prepareCip113Transfer({ ...REQUEST, quantity: '21000001' }, env()));
    expect(error.code).toBe('INSUFFICIENT');
    expect(error.maxSingleTransfer).toBe('21000000');
  });

  it('refuses a bad recipient, or the wallet itself, before asking Nexus', async () => {
    for (const recipientAddress of ['addr_test1notreal', TEST_WALLET_BASE_ADDRESS]) {
      const e = env();
      expect((await refusal(prepareCip113Transfer({ ...REQUEST, recipientAddress }, e))).code).toBe('RECIPIENT_INVALID');
      expect(e.build).not.toHaveBeenCalled();
    }
  });

  it("refuses when the owner key is not among the wallet's keys", async () => {
    expect((await refusal(prepareCip113Transfer(REQUEST, env({ keys: { ...KEYS, stake: [] } })))).code).toBe('OWNER_KEY_UNKNOWN');
  });

  it('keeps a well-formed sponsored collateral ref and drops anything else', async () => {
    const pooled = (ref: string) => env({ build: vi.fn().mockResolvedValue({ tx_cbor: T3_UNSIGNED_TX, tx_hash: T3_TX_ID, sponsoredCollateralRef: ref }) });
    // T3 uses the wallet's own collateral, so a claimed pool ref is not reported as used.
    expect((await prepareCip113Transfer(REQUEST, pooled(`${'aa'.repeat(32)}#2`))).sponsoredCollateralRef).toBeUndefined();
    expect((await prepareCip113Transfer(REQUEST, pooled('junk'))).sponsoredCollateralRef).toBeUndefined();
  });
});

describe('ownKeys', () => {
  it('collects key addresses and key hashes, ignoring malformed entries', () => {
    const own = ownKeys({ ...KEYS, change: [{ address: 'addr_test1change', cred: 'not-a-hash', path: '' }] });
    expect([...own.addresses]).toEqual([TEST_WALLET_BASE_ADDRESS, 'addr_test1change']);
    expect([...own.keyHashes]).toEqual([TEST_WALLET_PAYMENT_KEY_HASH, TEST_WALLET_STAKE_KEY_HASH]);
    expect(ownKeys(null).addresses.size).toBe(0);
  });
});
