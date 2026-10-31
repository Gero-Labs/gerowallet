// LEGACY_LISTING_PREPARE_CANCEL's work, without the message plumbing: the background checks
// the refs belong to the wallet, has Nexus build the cancel, and hands back only a
// transaction legacyCancelVerify accepted. Nexus is replaced by stubs; the verifier is real.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Ed25519KeyHashHex, Hash28ByteBase16, Hash32ByteBase16 } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { Blockchain, Network } from '@/models/types';
import type { LegacyListingItem } from '@/api/legacy-listings-api';
import {
  LEGACY_CANCEL_MAX,
  LEGACY_CANCEL_MAX_BY_CONTRACT,
  LEGACY_SCRIPTS,
  isLegacyRescueHardware,
  legacyCancelMax,
} from '@/utils/legacyMarketScripts';
import { ownKeys } from './cip113PrepareTransfer';
import { verifyLegacyCancel } from './legacyCancelVerify';
import { LegacyCancelPrepareError, type LegacyCancelPrepareEnv, prepareLegacyCancel } from './legacyCancelPrepare';

// The hardware gate ships empty; a test opens it by handing the real check another list.
vi.mock('@/utils/legacyMarketScripts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/legacyMarketScripts')>();
  return { ...actual, isLegacyRescueHardware: vi.fn(actual.isLegacyRescueHardware) };
});

// The real verifier, observed: the context the worker builds for it is part of what is pinned.
vi.mock('./legacyCancelVerify', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./legacyCancelVerify')>();
  return { ...actual, verifyLegacyCancel: vi.fn(actual.verifyLegacyCancel) };
});

const MAINNET = Cardano.NetworkId.Mainnet;
const V3 = LEGACY_SCRIPTS.legacy_v3;

const OWNER_A = '1864a6eb4242da06750913784d9afb549dc3022d01bbd316530f390c';
const OWNER_B = 'b551db0a6c4f3e1d2a90b7c85e4f13d6a7b8c9d0e1f2a3b4c5d6e7f8';
const STAKE = '5ce6d8a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6071829';

const keyCred = (hash: string) => ({ hash: Hash28ByteBase16(hash), type: Cardano.CredentialType.KeyHash });
const baseAddress = (payment: string, stake: string) =>
  Cardano.BaseAddress.fromCredentials(MAINNET, keyCred(payment), keyCred(stake)).toAddress().toBech32();

const RECEIVE = baseAddress(OWNER_A, STAKE);
/** Where a UTxO of the wallet's own stake key sits at the legacy contract: never the wallet's to pay. */
const LEGACY_SCRIPT_ADDRESS = Cardano.BaseAddress.fromCredentials(
  MAINNET,
  { hash: Hash28ByteBase16(V3.scriptHash), type: Cardano.CredentialType.ScriptHash },
  keyCred(STAKE),
).toAddress().toBech32();
const FOREIGN = baseAddress('77'.repeat(28), '88'.repeat(28));

const NFT = '22d843e9e8b39d105c645944cc848abee2673d64e60f1f022791ec85457175696e6550696f6e656572536b696e3034363031';

const LISTING: LegacyListingItem = {
  txHash: 'fb150415126b92a47b46b3a8214d138bdbaab124615afaf8f4d612dd3c16c165',
  outputIndex: 0,
  contract: 'legacy_v3',
  kind: 'listing',
  ownerPkh: OWNER_A,
  lovelace: '1361960',
  assets: [{ unit: NFT, quantity: '1' }],
};
/** Another of the wallet's stuck listings, known but not asked to cancel. */
const OTHER_LISTING: LegacyListingItem = {
  txHash: 'd4'.repeat(32),
  outputIndex: 0,
  contract: 'legacy_v3',
  kind: 'listing',
  ownerPkh: OWNER_A,
  lovelace: '2000000',
  assets: [{ unit: `${'99'.repeat(28)}4f74686572`, quantity: '1' }],
};
const REF = `${LISTING.txHash}#${LISTING.outputIndex}`;
const OTHER_REF = `${OTHER_LISTING.txHash}#${OTHER_LISTING.outputIndex}`;

function utxo(txId: string, index: number, address: string, coins: bigint): Cardano.Utxo {
  return [
    { txId: Cardano.TransactionId(txId), index, address: address as Cardano.PaymentAddress },
    { address: address as Cardano.PaymentAddress, value: { coins } },
  ] as Cardano.Utxo;
}

const FEE_COINS = 10_000_000n;
const FEE_UTXO = utxo('7d'.repeat(32), 0, RECEIVE, FEE_COINS);
const RESERVED = utxo('99'.repeat(32), 0, RECEIVE, 5_000_000n);
/** The wallet's own stake key at the legacy script: synced as the wallet's, never spendable as a fee input. */
const AT_SCRIPT = utxo('ee'.repeat(32), 3, LEGACY_SCRIPT_ADDRESS, 50_000_000n);
const SPONSORED_TX = 'aa'.repeat(32);
const SPONSORED = `${SPONSORED_TX}#2`;

const KEYS = {
  payment: [{ address: RECEIVE, cred: OWNER_A, path: "m/1852'/1815'/0'/0/0" }],
  change: [],
  stake: [{ cred: STAKE, path: "m/1852'/1815'/0'/2/0" }],
};

const txIn = (txId: string, index: number): Cardano.TxIn => ({ txId: Cardano.TransactionId(txId), index });
const FEE_IN = txIn('7d'.repeat(32), 0);
const SPONSORED_IN = txIn(SPONSORED_TX, 2);
const assets = (unit: string, quantity: bigint) => new Map([[Cardano.AssetId(unit), quantity]]) as Cardano.TokenMap;

/**
 * The cancel of LISTING as Nexus builds it: the listing and one fee input (the ledger sorts
 * the fee input first), the contract's reference script, one cancel redeemer, the owner as
 * the only required signer, the NFT to the receive address, and the fee input as collateral.
 */
function cancelTx(edit: (tx: Cardano.Tx) => void = () => undefined): { cbor: string; id: string } {
  const tx: Cardano.Tx = {
    id: Cardano.TransactionId('00'.repeat(32)),
    body: {
      inputs: [txIn(LISTING.txHash, LISTING.outputIndex), FEE_IN],
      outputs: [
        { address: Cardano.PaymentAddress(RECEIVE), value: { coins: 1_361_960n, assets: assets(NFT, 1n) } },
        { address: Cardano.PaymentAddress(RECEIVE), value: { coins: 9_700_000n } },
      ],
      fee: 300_000n,
      collaterals: [FEE_IN],
      collateralReturn: { address: Cardano.PaymentAddress(RECEIVE), value: { coins: 9_400_000n } },
      totalCollateral: 600_000n,
      referenceInputs: [txIn(V3.referenceScript.split('#')[0], Number(V3.referenceScript.split('#')[1]))],
      requiredExtraSignatures: [Ed25519KeyHashHex(OWNER_A)],
      scriptIntegrityHash: Hash32ByteBase16('ab'.repeat(32)),
    },
    witness: {
      signatures: new Map(),
      redeemers: [{
        purpose: Cardano.RedeemerPurpose.spend,
        index: 1,
        data: Serialization.PlutusData.fromCbor(HexBlob(V3.cancelRedeemerCbor)).toCore(),
        executionUnits: { memory: 600_000, steps: 250_000_000 },
      }],
    },
    isValid: true,
  };
  edit(tx);
  const serialized = Serialization.Transaction.fromCore(tx);
  return { cbor: serialized.toCbor(), id: serialized.getId() };
}

const VALID = cancelTx();

function env(overrides: Partial<LegacyCancelPrepareEnv> = {}): LegacyCancelPrepareEnv {
  return {
    walletId: 1,
    chain: Blockchain.CARDANO,
    network: Network.MAINNET,
    walletType: 'Normal',
    ownUtxos: [FEE_UTXO, RESERVED],
    keys: KEYS,
    reservedCollateral: RESERVED,
    changeAddress: RECEIVE,
    lookup: vi.fn().mockResolvedValue([LISTING, OTHER_LISTING]),
    build: vi.fn().mockResolvedValue({ tx_cbor: VALID.cbor, tx_hash: VALID.id }),
    ...overrides,
  };
}

const REQUEST = { refs: [REF] };

async function refusal(promise: Promise<unknown>): Promise<LegacyCancelPrepareError> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(LegacyCancelPrepareError);
    return e as LegacyCancelPrepareError;
  }
  throw new Error('expected the prepare to be refused');
}

/** The error Nexus's 422 leaves on a rejected build, as nexus-tx-api's interceptor keeps it. */
function nexus422(errorCode: string, message = 'Nexus says no'): Error {
  return Object.assign(new Error(message), { response: { status: 422, data: { errorCode, message } } });
}

const neverCalled = (e: LegacyCancelPrepareEnv) => {
  expect(e.lookup).not.toHaveBeenCalled();
  expect(e.build).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.mocked(verifyLegacyCancel).mockClear();
  vi.mocked(isLegacyRescueHardware).mockClear();
});

describe('prepareLegacyCancel', () => {
  it('looks the refs up, has Nexus build and returns the verified transaction untouched', async () => {
    const e = env();
    const prepared = await prepareLegacyCancel(REQUEST, e);
    expect(prepared.txCbor).toBe(VALID.cbor);
    expect(prepared.txId).toBe(VALID.id);
    expect(prepared.summary).toMatchObject({ txId: VALID.id, feeLovelace: '300000', refs: [REF], items: [LISTING] });
    expect(prepared.sponsoredCollateralRef).toBeUndefined();
    expect(e.lookup).toHaveBeenCalledTimes(1);
    expect(e.build).toHaveBeenCalledTimes(1);
  });

  it('asks Nexus with return and change = receive address', async () => {
    const e = env();
    await prepareLegacyCancel(REQUEST, e);
    const [request, network] = (e.build as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(network).toBe(Network.MAINNET);
    expect(request).toEqual({
      listings: [{ txHash: LISTING.txHash, outputIndex: LISTING.outputIndex }],
      feeInputs: expect.any(Array),
      returnAddress: RECEIVE,
      changeAddress: RECEIVE,
      allowSponsoredCollateral: true,
    });
  });

  it("looks up the owners among the wallet's own key hashes", async () => {
    const e = env();
    await prepareLegacyCancel(REQUEST, e);
    const [owners, network] = (e.lookup as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(network).toBe(Network.MAINNET);
    expect([...owners].sort()).toEqual([...ownKeys(KEYS).keyHashes].sort());
    expect(owners).toContain(OWNER_A);
  });

  it('sends only key-address UTxOs as fee inputs: not the reserved collateral, not a script address', async () => {
    const e = env({ ownUtxos: [FEE_UTXO, RESERVED, AT_SCRIPT] });
    await prepareLegacyCancel(REQUEST, e);
    const { feeInputs } = (e.build as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(feeInputs.map((input: { txHash: string }) => input.txHash)).toEqual([FEE_UTXO[0].txId]);
  });

  it('sends at most 50 fee inputs', async () => {
    const many = Array.from({ length: 60 }, (_, i) => utxo(i.toString(16).padStart(2, '0').repeat(32), 0, RECEIVE, 3_000_000n + BigInt(i)));
    const e = env({ ownUtxos: [FEE_UTXO, ...many], reservedCollateral: null });
    await prepareLegacyCancel(REQUEST, e);
    expect((e.build as ReturnType<typeof vi.fn>).mock.calls[0][0].feeInputs).toHaveLength(50);
  });

  it('gives the verifier key addresses only, even when the wallet owns UTxOs at the legacy script address', async () => {
    const e = env({ ownUtxos: [FEE_UTXO, RESERVED, AT_SCRIPT] });
    await prepareLegacyCancel(REQUEST, e);
    const ctx = vi.mocked(verifyLegacyCancel).mock.calls[0][3];
    expect(ctx.networkId).toBe(MAINNET);
    expect(ctx.returnAddress).toBe(RECEIVE);
    expect([...ctx.ownAddresses]).toEqual([...ownKeys(KEYS).addresses]);
    expect(ctx.ownAddresses.has(LEGACY_SCRIPT_ADDRESS)).toBe(false);
    expect(ctx.ownKeyHashes).toEqual(ownKeys(KEYS).keyHashes);
    // Nor is a script-address UTxO among the wallet's spendable ones.
    expect(ctx.ownUtxos.some((u) => u[1].address === LEGACY_SCRIPT_ADDRESS)).toBe(false);
  });

  it('refuses a cancel that pays the legacy script address, which would lock the value forever', async () => {
    const toScript = cancelTx((tx) => {
      tx.body.outputs[1] = { address: Cardano.PaymentAddress(LEGACY_SCRIPT_ADDRESS), value: { coins: 9_700_000n } };
    });
    const e = env({
      ownUtxos: [FEE_UTXO, AT_SCRIPT],
      build: vi.fn().mockResolvedValue({ tx_cbor: toScript.cbor, tx_hash: toScript.id }),
    });
    const error = await refusal(prepareLegacyCancel(REQUEST, e));
    expect(error.code).toBe('VERIFY_FAILED');
    expect(error.message).toContain('OUTPUTS');
  });

  it("gives the verifier every owned item that was looked up, not only the asked-for ones", async () => {
    const stranger: LegacyListingItem = { ...OTHER_LISTING, txHash: 'ab'.repeat(32), ownerPkh: '77'.repeat(28) };
    await prepareLegacyCancel(REQUEST, env({ lookup: vi.fn().mockResolvedValue([LISTING, OTHER_LISTING, stranger]) }));
    const { items } = vi.mocked(verifyLegacyCancel).mock.calls[0][3];
    expect([...items.keys()].sort()).toEqual([REF, OTHER_REF].sort());
  });

  it('passes the refs to the verifier in the order asked', async () => {
    const twoStuck = cancelTx((tx) => {
      tx.body.inputs.push(txIn(OTHER_LISTING.txHash, OTHER_LISTING.outputIndex));
    });
    // The transaction does not cancel OTHER_LISTING's redeemer, so the real verifier refuses it:
    // all that matters here is which refs it was asked to check, and in what order.
    const e = env({ build: vi.fn().mockResolvedValue({ tx_cbor: twoStuck.cbor, tx_hash: twoStuck.id }) });
    await refusal(prepareLegacyCancel({ refs: [OTHER_REF, REF] }, e));
    expect(vi.mocked(verifyLegacyCancel).mock.calls[0][2]).toEqual([OTHER_REF, REF]);
  });

  describe('the request', () => {
    const MIXED_CASE = REF.replace('fb15', 'FB15');
    it.each([
      ['no body', undefined],
      ['not an object', 'refs'],
      ['no refs', {}],
      ['refs not an array', { refs: REF }],
      ['empty refs', { refs: [] }],
      ['a duplicate', { refs: [REF, REF] }],
      ['a non-string ref', { refs: [{ txHash: LISTING.txHash, outputIndex: 0 }] }],
      ['a ref with no index', { refs: [LISTING.txHash] }],
      ['a short hash', { refs: [`${'ab'.repeat(31)}#0`] }],
      ['an upper-case hash', { refs: [MIXED_CASE] }],
      ['a non-hex hash', { refs: [`${'zz'.repeat(32)}#0`] }],
      ['a negative index', { refs: [`${LISTING.txHash}#-1`] }],
      ['an index over five digits', { refs: [`${LISTING.txHash}#123456`] }],
      ['a trailing newline', { refs: [`${REF}\n`] }],
    ])('refuses %s', async (_name, request) => {
      const e = env();
      expect((await refusal(prepareLegacyCancel(request, e))).code).toBe('INVALID_REQUEST');
      neverCalled(e);
    });

    it(`refuses more than ${LEGACY_CANCEL_MAX} refs and takes exactly ${LEGACY_CANCEL_MAX}`, async () => {
      const refs = (n: number) => Array.from({ length: n }, (_, i) => `${i.toString(16).padStart(2, '0').repeat(32)}#0`);
      const e = env();
      expect((await refusal(prepareLegacyCancel({ refs: refs(LEGACY_CANCEL_MAX + 1) }, e))).code).toBe('INVALID_REQUEST');
      neverCalled(e);
      // Ten distinct refs get past validation; the wallet's lookup then finds none of them.
      expect((await refusal(prepareLegacyCancel({ refs: refs(LEGACY_CANCEL_MAX) }, env()))).code).toBe('LISTING_NOT_FOUND');
    });
  });

  describe('one contract per transaction, and each contract\'s own cap', () => {
    /** `n` distinct stuck items at `contract`, owned by the wallet, and their refs. */
    function stuck(contract: LegacyListingItem['contract'], n: number, seed = 0): { items: LegacyListingItem[]; refs: string[] } {
      const items = Array.from({ length: n }, (_, i): LegacyListingItem => ({
        ...LISTING,
        txHash: (seed + i + 1).toString(16).padStart(2, '0').repeat(32),
        outputIndex: 0,
        contract,
        assets: [{ unit: `${'99'.repeat(28)}${(seed + i + 1).toString(16).padStart(2, '0')}`, quantity: '1' }],
      }));
      return { items, refs: items.map((item) => `${item.txHash}#${item.outputIndex}`) };
    }
    /** Past the refusals Nexus is asked: a build that fails with a sentinel tells the two apart. */
    const reachesBuild = (items: LegacyListingItem[]) =>
      env({ lookup: vi.fn().mockResolvedValue(items), build: vi.fn().mockRejectedValue(nexus422('EVALUATION_FAILED')) });

    it('pins the caps measured on mainnet: 10 for legacy_v3, 6 for legacy_v2, under the overall ceiling', () => {
      expect(LEGACY_CANCEL_MAX_BY_CONTRACT).toEqual({ legacy_v3: 10, legacy_v2: 6 });
      expect(legacyCancelMax('legacy_v3')).toBe(10);
      expect(legacyCancelMax('legacy_v2')).toBe(6);
      expect(LEGACY_CANCEL_MAX).toBe(10);
      expect(Math.max(...Object.values(LEGACY_CANCEL_MAX_BY_CONTRACT))).toBeLessThanOrEqual(LEGACY_CANCEL_MAX);
    });

    it('fails closed on a contract it has no cap for', async () => {
      expect(legacyCancelMax('legacy_v9' as never)).toBe(0);
      expect(legacyCancelMax('constructor' as never)).toBe(0);
      const { items, refs } = stuck('legacy_v3', 1);
      const e = env({ lookup: vi.fn().mockResolvedValue([{ ...items[0], contract: 'legacy_v9' }]) });
      expect((await refusal(prepareLegacyCancel({ refs }, e))).code).toBe('TOO_MANY_LISTINGS');
      expect(e.build).not.toHaveBeenCalled();
    });

    it('refuses refs spanning legacy_v3 and legacy_v2 with MIXED_CONTRACTS, build never called', async () => {
      const v3 = stuck('legacy_v3', 1);
      const v2 = stuck('legacy_v2', 1, 10);
      const e = env({ lookup: vi.fn().mockResolvedValue([...v3.items, ...v2.items]) });
      const error = await refusal(prepareLegacyCancel({ refs: [...v3.refs, ...v2.refs] }, e));
      expect(error.code).toBe('MIXED_CONTRACTS');
      expect(e.lookup).toHaveBeenCalledTimes(1);
      expect(e.build).not.toHaveBeenCalled();
      expect(verifyLegacyCancel).not.toHaveBeenCalled();
    });

    it('refuses a mixed request whichever order the refs come in', async () => {
      const v3 = stuck('legacy_v3', 2);
      const v2 = stuck('legacy_v2', 2, 10);
      const e = env({ lookup: vi.fn().mockResolvedValue([...v3.items, ...v2.items]) });
      expect((await refusal(prepareLegacyCancel({ refs: [v2.refs[0], v3.refs[0], v2.refs[1]] }, e))).code).toBe('MIXED_CONTRACTS');
      expect(e.build).not.toHaveBeenCalled();
    });

    it('refuses 7 legacy_v2 refs with TOO_MANY_LISTINGS, build never called', async () => {
      const v2 = stuck('legacy_v2', 7);
      const e = env({ lookup: vi.fn().mockResolvedValue(v2.items) });
      const error = await refusal(prepareLegacyCancel({ refs: v2.refs }, e));
      expect(error.code).toBe('TOO_MANY_LISTINGS');
      expect(e.lookup).toHaveBeenCalledTimes(1);
      expect(e.build).not.toHaveBeenCalled();
      expect(verifyLegacyCancel).not.toHaveBeenCalled();
    });

    it('accepts 6 legacy_v2 refs and 10 legacy_v3 refs: Nexus is asked', async () => {
      for (const [contract, count] of [['legacy_v2', 6], ['legacy_v3', 10]] as const) {
        const { items, refs } = stuck(contract, count);
        const e = reachesBuild(items);
        // Nexus's sentinel failure comes back as is: neither refusal fired.
        expect((await refusal(prepareLegacyCancel({ refs }, e))).code).toBe('EVALUATION_FAILED');
        expect(e.build).toHaveBeenCalledTimes(1);
        const [request] = (e.build as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(request.listings).toHaveLength(count);
      }
    });

    it('counts the refs asked for, not every item the wallet owns', async () => {
      // Twelve legacy_v2 items are stuck, six are asked for.
      const { items, refs } = stuck('legacy_v2', 12);
      const e = reachesBuild(items);
      expect((await refusal(prepareLegacyCancel({ refs: refs.slice(0, 6) }, e))).code).toBe('EVALUATION_FAILED');
      expect(e.build).toHaveBeenCalledTimes(1);
    });

    it('is not mixed by another contract\'s items the wallet owns but did not ask for', async () => {
      const v2 = stuck('legacy_v2', 2);
      const v3 = stuck('legacy_v3', 3, 10);
      const e = reachesBuild([...v2.items, ...v3.items]);
      expect((await refusal(prepareLegacyCancel({ refs: v2.refs }, e))).code).toBe('EVALUATION_FAILED');
      expect(e.build).toHaveBeenCalledTimes(1);
    });

    it('says a mixed request is mixed before it says it is too big', async () => {
      const v2 = stuck('legacy_v2', 7);
      const v3 = stuck('legacy_v3', 1, 10);
      const e = env({ lookup: vi.fn().mockResolvedValue([...v2.items, ...v3.items]) });
      expect((await refusal(prepareLegacyCancel({ refs: [...v2.refs, ...v3.refs] }, e))).code).toBe('MIXED_CONTRACTS');
      expect(e.build).not.toHaveBeenCalled();
    });

    it('still says LISTING_NOT_FOUND first when a ref is gone', async () => {
      const v2 = stuck('legacy_v2', 7);
      const e = env({ lookup: vi.fn().mockResolvedValue(v2.items.slice(0, 6)) });
      expect((await refusal(prepareLegacyCancel({ refs: v2.refs }, e))).code).toBe('LISTING_NOT_FOUND');
      expect(e.build).not.toHaveBeenCalled();
    });

    it('still says NOT_OWNED first when a ref is someone else\'s', async () => {
      const v2 = stuck('legacy_v2', 7);
      const e = env({ lookup: vi.fn().mockResolvedValue([...v2.items.slice(0, 6), { ...v2.items[6], ownerPkh: '77'.repeat(28) }]) });
      expect((await refusal(prepareLegacyCancel({ refs: v2.refs }, e))).code).toBe('NOT_OWNED');
      expect(e.build).not.toHaveBeenCalled();
    });
  });

  describe('the wallet', () => {
    it.each([Blockchain.BITCOIN, Blockchain.MIDNIGHT, Blockchain.APEX_PRIME, Blockchain.APEX_VECTOR])('refuses a %s wallet', async (chain) => {
      const e = env({ chain });
      expect((await refusal(prepareLegacyCancel(REQUEST, e))).code).toBe('WALLET_UNSUPPORTED');
      neverCalled(e);
    });

    it.each(['Ledger', 'Trezor', 'Keystone', 'Watch', 'unknown', ''])('refuses a %s wallet while its type is not listed', async (walletType) => {
      const e = env({ walletType });
      expect((await refusal(prepareLegacyCancel(REQUEST, e))).code).toBe('WALLET_UNSUPPORTED');
      neverCalled(e);
    });

    it.each(['Normal', 'Google'])('accepts a %s wallet, which signs in the worker', async (walletType) => {
      expect((await prepareLegacyCancel(REQUEST, env({ walletType }))).txId).toBe(VALID.id);
    });

    describe('with a hardware wallet type listed', () => {
      const real = vi.mocked(isLegacyRescueHardware).getMockImplementation()!;
      beforeEach(() => {
        vi.mocked(isLegacyRescueHardware).mockImplementation((type) => real(type, ['Ledger']));
      });
      afterEach(() => {
        vi.mocked(isLegacyRescueHardware).mockImplementation(real);
      });

      it('accepts the listed device and still refuses the others', async () => {
        expect((await prepareLegacyCancel(REQUEST, env({ walletType: 'Ledger' }))).txId).toBe(VALID.id);
        for (const walletType of ['Trezor', 'Keystone', 'Watch']) {
          expect((await refusal(prepareLegacyCancel(REQUEST, env({ walletType })))).code).toBe('WALLET_UNSUPPORTED');
        }
      });

      it('still refuses a listed device on another chain', async () => {
        const e = env({ walletType: 'Ledger', chain: Blockchain.BITCOIN });
        expect((await refusal(prepareLegacyCancel(REQUEST, e))).code).toBe('WALLET_UNSUPPORTED');
        neverCalled(e);
      });
    });

    it("refuses a receive address that is not among the wallet's keys", async () => {
      const e = env({ changeAddress: FOREIGN });
      expect((await refusal(prepareLegacyCancel(REQUEST, e))).code).toBe('WALLET_UNSUPPORTED');
      neverCalled(e);
    });

    it('refuses a wallet with no keys', async () => {
      for (const keys of [null, undefined, { payment: [], change: [], stake: [] }]) {
        const e = env({ keys });
        expect((await refusal(prepareLegacyCancel(REQUEST, e))).code).toBe('WALLET_UNSUPPORTED');
        neverCalled(e);
      }
    });
  });

  describe('the network', () => {
    it.each([Network.PREPROD, Network.PREVIEW, Network.TESTNET, Network.STAGENET, 'unknown'])('refuses %s: Nexus is never asked', async (network) => {
      const e = env({ network });
      expect((await refusal(prepareLegacyCancel(REQUEST, e))).code).toBe('NETWORK_UNSUPPORTED');
      neverCalled(e);
    });
  });

  describe('ownership', () => {
    it('answers a ref the lookup no longer returns LISTING_NOT_FOUND: it was spent since the list was read', async () => {
      // The lookup asks only about the wallet's own keys and returns only unspent UTxOs, so a
      // ref missing from it is gone (sold, or cancelled from another device), not someone else's.
      const e = env({ lookup: vi.fn().mockResolvedValue([OTHER_LISTING]) });
      const error = await refusal(prepareLegacyCancel(REQUEST, e));
      expect(error.code).toBe('LISTING_NOT_FOUND');
      expect(e.lookup).toHaveBeenCalledTimes(1);
      expect(e.build).not.toHaveBeenCalled();
      expect(verifyLegacyCancel).not.toHaveBeenCalled();
    });

    it('answers LISTING_NOT_FOUND when the lookup returns nothing at all', async () => {
      const e = env({ lookup: vi.fn().mockResolvedValue([]) });
      expect((await refusal(prepareLegacyCancel(REQUEST, e))).code).toBe('LISTING_NOT_FOUND');
      expect(e.build).not.toHaveBeenCalled();
    });

    it('refuses a ref whose owner is not a key of the wallet, however Nexus came to return it', async () => {
      const someoneElses: LegacyListingItem = { ...LISTING, ownerPkh: '77'.repeat(28) };
      const e = env({ lookup: vi.fn().mockResolvedValue([someoneElses]) });
      expect((await refusal(prepareLegacyCancel(REQUEST, e))).code).toBe('NOT_OWNED');
      expect(e.build).not.toHaveBeenCalled();
    });

    it('refuses the whole request when only one of its refs is not the wallet\'s', async () => {
      const e = env({ lookup: vi.fn().mockResolvedValue([LISTING, { ...OTHER_LISTING, ownerPkh: '77'.repeat(28) }]) });
      expect((await refusal(prepareLegacyCancel({ refs: [REF, OTHER_REF] }, e))).code).toBe('NOT_OWNED');
      expect(e.build).not.toHaveBeenCalled();
    });

    it('refuses the whole request when only one of its refs is gone', async () => {
      const e = env({ lookup: vi.fn().mockResolvedValue([LISTING]) });
      expect((await refusal(prepareLegacyCancel({ refs: [REF, OTHER_REF] }, e))).code).toBe('LISTING_NOT_FOUND');
      expect(e.build).not.toHaveBeenCalled();
    });

    it('says NOT_OWNED rather than LISTING_NOT_FOUND when one ref is gone and another is someone else\'s', async () => {
      const someoneElses: LegacyListingItem = { ...OTHER_LISTING, ownerPkh: '77'.repeat(28) };
      for (const refs of [[REF, OTHER_REF], [OTHER_REF, REF]]) {
        const e = env({ lookup: vi.fn().mockResolvedValue([someoneElses]) });
        expect((await refusal(prepareLegacyCancel({ refs }, e))).code).toBe('NOT_OWNED');
        expect(e.build).not.toHaveBeenCalled();
      }
    });

    it('treats an item owned by another of the wallet\'s keys as owned', async () => {
      const second: LegacyListingItem = { ...LISTING, ownerPkh: OWNER_B };
      const keys = { ...KEYS, payment: [...KEYS.payment, { address: baseAddress(OWNER_B, STAKE), cred: OWNER_B, path: "m/1852'/1815'/0'/0/1" }] };
      const e = env({ keys, lookup: vi.fn().mockResolvedValue([second]) });
      // Nexus's transaction names OWNER_A, so the verifier refuses it, but the ownership check passed.
      expect((await refusal(prepareLegacyCancel(REQUEST, e))).code).toBe('VERIFY_FAILED');
      expect(e.build).toHaveBeenCalledTimes(1);
    });

    it('answers a failed lookup as a build failure, or the Nexus code it carries', async () => {
      const down = env({ lookup: vi.fn().mockRejectedValue(new Error('Network Error')) });
      expect((await refusal(prepareLegacyCancel(REQUEST, down))).code).toBe('BUILD_FAILED');
      expect(down.build).not.toHaveBeenCalled();
      const coded = env({ lookup: vi.fn().mockRejectedValue(nexus422('NETWORK_UNSUPPORTED')) });
      expect((await refusal(prepareLegacyCancel(REQUEST, coded))).code).toBe('NETWORK_UNSUPPORTED');
    });
  });

  describe('Nexus', () => {
    it.each(['LISTING_NOT_FOUND', 'NOT_LEGACY_LISTING', 'DATUM_UNREADABLE', 'EVALUATION_FAILED', 'TOO_MANY_LISTINGS', 'NETWORK_UNSUPPORTED'])(
      'passes a 422 %s through',
      async (errorCode) => {
        const e = env({ build: vi.fn().mockRejectedValue(nexus422(errorCode, 'The listing is gone')) });
        const error = await refusal(prepareLegacyCancel(REQUEST, e));
        expect(error.code).toBe(errorCode);
        expect(error.message).toBe('The listing is gone');
      },
    );

    it('answers any other build failure BUILD_FAILED', async () => {
      for (const failure of [new Error('timeout'), 'refused', Object.assign(new Error('x'), { response: { data: { errorCode: 'lower case' } } })]) {
        const e = env({ build: vi.fn().mockRejectedValue(failure) });
        expect((await refusal(prepareLegacyCancel(REQUEST, e))).code).toBe('BUILD_FAILED');
      }
    });

    it('answers a response without a transaction BUILD_FAILED', async () => {
      for (const response of [{}, null, undefined, { tx_cbor: VALID.cbor }, { tx_hash: VALID.id }, { tx_cbor: 7, tx_hash: VALID.id }]) {
        const e = env({ build: vi.fn().mockResolvedValue(response) });
        expect((await refusal(prepareLegacyCancel(REQUEST, e))).code).toBe('BUILD_FAILED');
      }
    });
  });

  describe('verification', () => {
    it('maps a verify failure to VERIFY_FAILED, keeping the rule code in the message', async () => {
      const e = env({ build: vi.fn().mockResolvedValue({ tx_cbor: VALID.cbor, tx_hash: 'ab'.repeat(32) }) });
      const error = await refusal(prepareLegacyCancel(REQUEST, e));
      expect(error.code).toBe('VERIFY_FAILED');
      expect(error.message).toContain('TX_ID');
    });

    it('refuses a transaction that does not cancel what was asked for', async () => {
      const wrongRedeemer = cancelTx((tx) => {
        tx.witness.redeemers[0].data = Serialization.PlutusData.fromCbor(HexBlob(LEGACY_SCRIPTS.legacy_v2.cancelRedeemerCbor)).toCore();
      });
      const e = env({ build: vi.fn().mockResolvedValue({ tx_cbor: wrongRedeemer.cbor, tx_hash: wrongRedeemer.id }) });
      const error = await refusal(prepareLegacyCancel(REQUEST, e));
      expect(error.code).toBe('VERIFY_FAILED');
      expect(error.message).toContain('REDEEMERS');
    });

    it('answers an unexpected verifier failure VERIFY_FAILED too', async () => {
      vi.mocked(verifyLegacyCancel).mockImplementationOnce(() => {
        throw new TypeError('boom');
      });
      expect((await refusal(prepareLegacyCancel(REQUEST, env()))).code).toBe('VERIFY_FAILED');
    });
  });

  describe('sponsored collateral', () => {
    const sponsoredTx = cancelTx((tx) => {
      tx.body.collaterals = [SPONSORED_IN];
      delete tx.body.collateralReturn;
      delete tx.body.totalCollateral;
    });
    const sponsoredBuild = (ref: unknown) => vi.fn().mockResolvedValue({ tx_cbor: sponsoredTx.cbor, tx_hash: sponsoredTx.id, sponsoredCollateralRef: ref });

    it('returns the lent pool UTxO when Nexus lent it and the transaction uses it as collateral only', async () => {
      const prepared = await prepareLegacyCancel(REQUEST, env({ build: sponsoredBuild(SPONSORED) }));
      expect(prepared.sponsoredCollateralRef).toBe(SPONSORED);
      expect(prepared.summary.sponsoredCollateralRef).toBe(SPONSORED);
      expect(vi.mocked(verifyLegacyCancel).mock.calls[0][3].sponsoredCollateralRef).toBe(SPONSORED);
    });

    it.each(['junk', `${'AA'.repeat(32)}#2`, `${SPONSORED_TX}#`, 7, null])('ignores a malformed lent ref (%s): the pool UTxO is then no collateral the wallet accepts', async (ref) => {
      const error = await refusal(prepareLegacyCancel(REQUEST, env({ build: sponsoredBuild(ref) })));
      expect(error.code).toBe('VERIFY_FAILED');
      expect(error.message).toContain('COLLATERAL');
      expect(vi.mocked(verifyLegacyCancel).mock.calls[0][3].sponsoredCollateralRef).toBeUndefined();
    });

    it('returns no lent ref when the collateral is the wallet\'s own', async () => {
      const prepared = await prepareLegacyCancel(REQUEST, env({
        build: vi.fn().mockResolvedValue({ tx_cbor: VALID.cbor, tx_hash: VALID.id, sponsoredCollateralRef: SPONSORED }),
      }));
      // Nexus said it lent one, but the transaction does not use it: nothing is marked lent.
      expect(prepared.sponsoredCollateralRef).toBeUndefined();
    });
  });
});
