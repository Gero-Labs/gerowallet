// The wallet's check of the legacy cancel transaction Nexus built. One valid mainnet cancel
// (a legacy_v3 listing and a legacy_v2 offer, real script hashes and reference scripts) must
// pass, and one altered copy per rule must not.
import { describe, expect, it } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Ed25519KeyHashHex, Hash28ByteBase16, Hash32ByteBase16 } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import {
  LegacyCancelVerifyError,
  type LegacyCancelVerifyCode,
  type LegacyCancelVerifyContext,
  verifyLegacyCancel,
} from './legacyCancelVerify';
import type { LegacyListingItem } from '@/api/legacy-listings-api';
import {
  LEGACY_CANCEL_MAX,
  LEGACY_CANCEL_MAX_COLLATERAL,
  LEGACY_CANCEL_MAX_FEE,
  LEGACY_SCRIPTS,
} from '@/utils/legacyMarketScripts';

const MAINNET = Cardano.NetworkId.Mainnet;
const TESTNET = Cardano.NetworkId.Testnet;
const V3 = LEGACY_SCRIPTS.legacy_v3;
const V2 = LEGACY_SCRIPTS.legacy_v2;

// The wallet: two payment keys (each the owner of one stuck item) under one stake key.
const OWNER_A = '1864a6eb4242da06750913784d9afb549dc3022d01bbd316530f390c';
const OWNER_B = 'b551db0a6c4f3e1d2a90b7c85e4f13d6a7b8c9d0e1f2a3b4c5d6e7f8';
const STAKE = '5ce6d8a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6071829';

function baseAddress(networkId: Cardano.NetworkId, payment: string, stake: string): string {
  return Cardano.BaseAddress.fromCredentials(
    networkId,
    { hash: Hash28ByteBase16(payment), type: Cardano.CredentialType.KeyHash },
    { hash: Hash28ByteBase16(stake), type: Cardano.CredentialType.KeyHash },
  ).toAddress().toBech32();
}

const RECEIVE = baseAddress(MAINNET, OWNER_A, STAKE);
const SECOND = baseAddress(MAINNET, OWNER_B, STAKE);
const FOREIGN = baseAddress(MAINNET, '77'.repeat(28), '88'.repeat(28));
const REWARD = Cardano.RewardAddress.fromCredentials(MAINNET, {
  hash: Hash28ByteBase16(STAKE), type: Cardano.CredentialType.KeyHash,
}).toAddress().toBech32() as Cardano.RewardAccount;

const NFT = '22d843e9e8b39d105c645944cc848abee2673d64e60f1f022791ec85457175696e6550696f6e656572536b696e3034363031';
const OTHER_NFT = `${'99'.repeat(28)}4f74686572`;

const itemRef = (item: LegacyListingItem) => `${item.txHash}#${item.outputIndex}`;

// Sorted ledger order of the valid cancel's inputs: V2_OFFER (3c…) 0, FEE (7d…) 1, V3_LISTING (fb…) 2.
const V3_LISTING: LegacyListingItem = {
  txHash: 'fb150415126b92a47b46b3a8214d138bdbaab124615afaf8f4d612dd3c16c165',
  outputIndex: 0,
  contract: 'legacy_v3',
  kind: 'listing',
  ownerPkh: OWNER_A,
  lovelace: '1361960',
  assets: [{ unit: NFT, quantity: '1' }],
};
const V2_OFFER: LegacyListingItem = {
  txHash: '3c'.repeat(32),
  outputIndex: 1,
  contract: 'legacy_v2',
  kind: 'offer',
  ownerPkh: OWNER_B,
  lovelace: '25000000',
  assets: [],
};
/** Another of the wallet's stuck listings, known but not asked to cancel. */
const UNREQUESTED: LegacyListingItem = {
  txHash: 'd4'.repeat(32),
  outputIndex: 0,
  contract: 'legacy_v3',
  kind: 'listing',
  ownerPkh: OWNER_A,
  lovelace: '2000000',
  assets: [{ unit: OTHER_NFT, quantity: '1' }],
};
const V3_SORTED = 2;
const V2_SORTED = 0;
const REFS = [itemRef(V3_LISTING), itemRef(V2_OFFER)];

function utxo(txId: string, index: number, address: string, coins: bigint, assets?: Record<string, bigint>): Cardano.Utxo {
  return [
    { txId: Cardano.TransactionId(txId), index, address: address as Cardano.PaymentAddress },
    {
      address: address as Cardano.PaymentAddress,
      value: { coins, ...(assets ? { assets: new Map(Object.entries(assets)) as Cardano.TokenMap } : {}) },
    },
  ] as Cardano.Utxo;
}

const FEE_COINS = 10_000_000n;
const FEE_UTXO = utxo('7d'.repeat(32), 0, RECEIVE, FEE_COINS);
const SPONSORED_TX = 'aa'.repeat(32);
const SPONSORED = `${SPONSORED_TX}#2`;

const txIn = (txId: string, index: number): Cardano.TxIn => ({ txId: Cardano.TransactionId(txId), index });
const itemIn = (item: LegacyListingItem) => txIn(item.txHash, item.outputIndex);
const refIn = (ref: string) => txIn(ref.split('#')[0], Number(ref.split('#')[1]));
const FEE_IN = txIn('7d'.repeat(32), 0);
const SPONSORED_IN = txIn(SPONSORED_TX, 2);

const plutusData = (cbor: string) => Serialization.PlutusData.fromCbor(HexBlob(cbor)).toCore();
const redeemer = (purpose: Cardano.RedeemerPurpose, index: number, cbor: string): Cardano.Redeemer => ({
  purpose,
  index,
  data: plutusData(cbor),
  executionUnits: { memory: 600_000, steps: 250_000_000 },
});
const spend = (index: number, cbor: string) => redeemer(Cardano.RedeemerPurpose.spend, index, cbor);

const assets = (unit: string, quantity: bigint) => new Map([[Cardano.AssetId(unit), quantity]]) as Cardano.TokenMap;

/**
 * The valid cancel, as Nexus builds it: both legacy UTxOs and one fee input (in body order
 * V3, fee, V2, so the ledger's sorted order differs), the two reference scripts, one cancel
 * redeemer per legacy input, both owners as required signers, all legacy value to the
 * return address, change back to the wallet, and the fee input as collateral.
 */
function validTx(): Cardano.Tx {
  return {
    id: Cardano.TransactionId('00'.repeat(32)),
    body: {
      inputs: [itemIn(V3_LISTING), FEE_IN, itemIn(V2_OFFER)],
      outputs: [
        { address: Cardano.PaymentAddress(RECEIVE), value: { coins: 26_361_960n, assets: assets(NFT, 1n) } },
        { address: Cardano.PaymentAddress(RECEIVE), value: { coins: 9_600_000n } },
      ],
      fee: 400_000n,
      collaterals: [FEE_IN],
      collateralReturn: { address: Cardano.PaymentAddress(RECEIVE), value: { coins: 9_400_000n } },
      totalCollateral: 600_000n,
      referenceInputs: [refIn(V3.referenceScript), refIn(V2.referenceScript)],
      requiredExtraSignatures: [Ed25519KeyHashHex(OWNER_A), Ed25519KeyHashHex(OWNER_B)],
      scriptIntegrityHash: Hash32ByteBase16('ab'.repeat(32)),
    },
    witness: {
      signatures: new Map(),
      redeemers: [spend(V3_SORTED, V3.cancelRedeemerCbor), spend(V2_SORTED, V2.cancelRedeemerCbor)],
    },
    isValid: true,
  };
}

/** The valid cancel with `edit` applied, serialized, and its id. */
function cancelTx(edit: (tx: Cardano.Tx) => void = () => undefined): { cbor: string; id: string } {
  const tx = validTx();
  edit(tx);
  const serialized = Serialization.Transaction.fromCore(tx);
  return { cbor: serialized.toCbor(), id: serialized.getId() };
}

function context(overrides: Partial<LegacyCancelVerifyContext> = {}): LegacyCancelVerifyContext {
  return {
    networkId: MAINNET,
    items: new Map([V3_LISTING, V2_OFFER, UNREQUESTED].map((item) => [itemRef(item), item])),
    ownUtxos: [FEE_UTXO],
    ownAddresses: new Set([RECEIVE, SECOND]),
    ownKeyHashes: new Set([OWNER_A, OWNER_B, STAKE]),
    returnAddress: RECEIVE,
    ...overrides,
  };
}

function verify(tx: { cbor: string; id: string }, refs: readonly string[] = REFS, ctx = context()) {
  return verifyLegacyCancel(tx.cbor, tx.id, refs, ctx);
}

function refusedBy(code: LegacyCancelVerifyCode, run: () => unknown) {
  try {
    run();
  } catch (e) {
    expect(e).toBeInstanceOf(LegacyCancelVerifyError);
    expect((e as LegacyCancelVerifyError).code).toBe(code);
    return;
  }
  throw new Error(`expected a ${code} refusal, but the cancel was accepted`);
}

describe('verifyLegacyCancel: the valid cancel', () => {
  it('accepts a valid V3 + V2 cancel and summarises it', () => {
    const tx = cancelTx();
    expect(verify(tx)).toEqual({ txId: tx.id, feeLovelace: '400000', refs: REFS, items: [V3_LISTING, V2_OFFER] });
  });

  it('lists the items in the order they were asked for', () => {
    const refs = [itemRef(V2_OFFER), itemRef(V3_LISTING)];
    const summary = verify(cancelTx(), refs);
    expect(summary.refs).toEqual(refs);
    expect(summary.items).toEqual([V2_OFFER, V3_LISTING]);
  });

  it('rejects a tx whose id differs from tx_hash', () => {
    const tx = cancelTx();
    refusedBy('TX_ID', () => verifyLegacyCancel(tx.cbor, 'ab'.repeat(32), REFS, context()));
    refusedBy('TX_ID', () => verifyLegacyCancel('84a0', tx.id, REFS, context()));
  });
});

describe('verifyLegacyCancel: network', () => {
  it('rejects a wrong network id in an output address', () => {
    refusedBy('NETWORK', () => verify(cancelTx((tx) => {
      tx.body.outputs[1].address = Cardano.PaymentAddress(baseAddress(TESTNET, OWNER_A, STAKE));
    })));
  });

  it('rejects a body network id or a context other than mainnet', () => {
    expect(verify(cancelTx((tx) => { tx.body.networkId = MAINNET; })).txId).toBeTruthy();
    refusedBy('NETWORK', () => verify(cancelTx((tx) => { tx.body.networkId = TESTNET; })));
    refusedBy('NETWORK', () => verify(cancelTx(), REFS, context({ networkId: TESTNET })));
  });
});

describe('verifyLegacyCancel: inputs', () => {
  it('rejects a legacy input that was not requested', () => {
    refusedBy('INPUTS', () => verify(cancelTx((tx) => { tx.body.inputs.push(itemIn(UNREQUESTED)); })));
  });

  it('rejects a non-legacy input not owned by the wallet', () => {
    refusedBy('INPUTS', () => verify(cancelTx((tx) => { tx.body.inputs.push(txIn('cd'.repeat(32), 0)); })));
    refusedBy('INPUTS', () => verify(cancelTx(), REFS, context({ ownUtxos: [] })));
  });

  it('rejects a missing requested legacy input', () => {
    refusedBy('INPUTS', () => verify(cancelTx((tx) => {
      tx.body.inputs = tx.body.inputs.filter((input) => input.txId !== V2_OFFER.txHash);
    })));
    refusedBy('INPUTS', () => verify(cancelTx(), [...REFS, itemRef(UNREQUESTED)]));
  });

  it('rejects an empty, repeated, unknown or oversized request', () => {
    const tx = cancelTx();
    refusedBy('INPUTS', () => verify(tx, []));
    refusedBy('INPUTS', () => verify(tx, [itemRef(V3_LISTING), itemRef(V3_LISTING)]));
    refusedBy('INPUTS', () => verify(tx, [itemRef(V3_LISTING), `${'cd'.repeat(32)}#0`]));
    refusedBy('INPUTS', () => verify(tx, Array.from({ length: LEGACY_CANCEL_MAX + 1 }, (_, i) => `${'cd'.repeat(32)}#${i}`)));
  });
});

describe('verifyLegacyCancel: reference inputs', () => {
  it('rejects an extra or wrong reference input', () => {
    refusedBy('REFERENCE_INPUTS', () => verify(cancelTx((tx) => { tx.body.referenceInputs!.push(txIn('cd'.repeat(32), 0)); })));
    refusedBy('REFERENCE_INPUTS', () => verify(cancelTx((tx) => { tx.body.referenceInputs = [refIn(V3.referenceScript), txIn('cd'.repeat(32), 0)]; })));
    refusedBy('REFERENCE_INPUTS', () => verify(cancelTx((tx) => { tx.body.referenceInputs = [refIn(V3.referenceScript)]; })));
    refusedBy('REFERENCE_INPUTS', () => verify(cancelTx((tx) => { delete tx.body.referenceInputs; })));
  });
});

describe('verifyLegacyCancel: redeemers', () => {
  const withRedeemers = (redeemers: Cardano.Redeemer[]) => cancelTx((tx) => { tx.witness.redeemers = redeemers; });

  it('rejects a legacy input without its cancel redeemer data', () => {
    // d87980 (legacy_v2's cancel) on the legacy_v3 input.
    refusedBy('REDEEMERS', () => verify(withRedeemers([spend(V3_SORTED, 'd87980'), spend(V2_SORTED, V2.cancelRedeemerCbor)])));
    // Constr 1 [] with an indefinite-length field list: the same value, other bytes. Compared as signed.
    refusedBy('REDEEMERS', () => verify(withRedeemers([spend(V3_SORTED, 'd87a9fff'), spend(V2_SORTED, V2.cancelRedeemerCbor)])));
    refusedBy('REDEEMERS', () => verify(withRedeemers([spend(V2_SORTED, V2.cancelRedeemerCbor)])));
    refusedBy('REDEEMERS', () => verify(cancelTx((tx) => { delete tx.witness.redeemers; })));
  });

  it('rejects a redeemer on a fee input or for another purpose', () => {
    refusedBy('REDEEMERS', () => verify(withRedeemers([
      spend(V3_SORTED, V3.cancelRedeemerCbor), spend(V2_SORTED, V2.cancelRedeemerCbor), spend(1, 'd87980'),
    ])));
    refusedBy('REDEEMERS', () => verify(withRedeemers([spend(V3_SORTED, V3.cancelRedeemerCbor), spend(1, V2.cancelRedeemerCbor)])));
    refusedBy('REDEEMERS', () => verify(withRedeemers([
      spend(V3_SORTED, V3.cancelRedeemerCbor), redeemer(Cardano.RedeemerPurpose.mint, V2_SORTED, V2.cancelRedeemerCbor),
    ])));
  });

  it("indexes redeemers in the ledger's sorted input order, not body order", () => {
    // Body order puts V3 first and V2 last; pointing the redeemers there is wrong.
    refusedBy('REDEEMERS', () => verify(withRedeemers([spend(0, V3.cancelRedeemerCbor), spend(2, V2.cancelRedeemerCbor)])));
  });
});

describe('verifyLegacyCancel: required signers', () => {
  it('rejects a required signer not among own key hashes', () => {
    refusedBy('SIGNERS', () => verify(cancelTx(), REFS, context({ ownKeyHashes: new Set([OWNER_A, STAKE]) })));
    refusedBy('SIGNERS', () => verify(cancelTx((tx) => {
      tx.body.requiredExtraSignatures!.push(Ed25519KeyHashHex('77'.repeat(28)));
    })));
  });

  it('rejects an owner missing from required signers', () => {
    refusedBy('SIGNERS', () => verify(cancelTx((tx) => { tx.body.requiredExtraSignatures = [Ed25519KeyHashHex(OWNER_A)]; })));
    refusedBy('SIGNERS', () => verify(cancelTx((tx) => { delete tx.body.requiredExtraSignatures; })));
  });
});

describe('verifyLegacyCancel: outputs', () => {
  it('rejects any output to a foreign address', () => {
    refusedBy('OUTPUTS', () => verify(cancelTx((tx) => {
      tx.body.outputs.push({ address: Cardano.PaymentAddress(FOREIGN), value: { coins: 1_000_000n } });
    })));
  });

  it('rejects when a legacy asset does not reach returnAddress', () => {
    refusedBy('OUTPUTS', () => verify(cancelTx((tx) => {
      tx.body.outputs = [
        { address: Cardano.PaymentAddress(RECEIVE), value: { coins: 26_361_960n } },
        { address: Cardano.PaymentAddress(SECOND), value: { coins: 9_600_000n, assets: assets(NFT, 1n) } },
      ];
    })));
    refusedBy('OUTPUTS', () => verify(cancelTx(), REFS, context({ returnAddress: SECOND })));
    refusedBy('OUTPUTS', () => verify(cancelTx(), REFS, context({ returnAddress: FOREIGN })));
  });

  it('rejects an output carrying a datum, a datum hash or a reference script', () => {
    refusedBy('OUTPUTS', () => verify(cancelTx((tx) => { tx.body.outputs[1].datum = plutusData('d87980'); })));
    refusedBy('OUTPUTS', () => verify(cancelTx((tx) => { tx.body.outputs[1].datumHash = Hash32ByteBase16('00'.repeat(32)); })));
    refusedBy('OUTPUTS', () => verify(cancelTx((tx) => {
      tx.body.outputs[1].scriptReference = {
        __type: Cardano.ScriptType.Plutus, version: Cardano.PlutusLanguageVersion.V2, bytes: HexBlob('4e4d01000033222220051200120011'),
      };
    })));
  });
});

describe('verifyLegacyCancel: nothing but the cancel', () => {
  it.each<[string, (tx: Cardano.Tx) => void]>([
    ['mint', (tx) => { tx.body.mint = assets(OTHER_NFT, 1n); }],
    ['certificates', (tx) => {
      tx.body.certificates = [{
        __typename: Cardano.CertificateType.StakeRegistration,
        stakeCredential: { hash: Hash28ByteBase16(STAKE), type: Cardano.CredentialType.KeyHash },
      }];
    }],
    ['withdrawals', (tx) => { tx.body.withdrawals = [{ stakeAddress: REWARD, quantity: 0n }]; }],
    ['votes', (tx) => {
      tx.body.votingProcedures = [{
        voter: { __typename: Cardano.VoterType.dRepKeyHash, credential: { type: Cardano.CredentialType.KeyHash, hash: Hash28ByteBase16(OWNER_A) } },
        votes: [{ actionId: { id: Cardano.TransactionId('ee'.repeat(32)), actionIndex: 0 }, votingProcedure: { vote: Cardano.Vote.yes, anchor: null } }],
      }];
    }],
    ['proposals', (tx) => {
      tx.body.proposalProcedures = [{
        deposit: 100_000_000_000n,
        rewardAccount: REWARD,
        governanceAction: { __typename: Cardano.GovernanceActionType.info_action },
        anchor: { url: 'https://example.com/a.json', dataHash: Hash32ByteBase16('00'.repeat(32)) },
      }];
    }],
    ['donation', (tx) => { tx.body.donation = 1n; }],
    ['current treasury value', (tx) => { tx.body.treasuryValue = 1n; }],
    ['auxiliary data', (tx) => { tx.body.auxiliaryDataHash = Hash32ByteBase16('00'.repeat(32)); }],
    ['an invalid flag, which forfeits collateral', (tx) => { tx.isValid = false; }],
    ['direct deposits', (tx) => { tx.body.directDeposits = [{ stakeAddress: REWARD, quantity: 1_000_000n }]; }],
  ])('rejects %s', (_name, edit) => {
    refusedBy('FORBIDDEN_FIELD', () => verify(cancelTx(edit)));
  });
});

describe('verifyLegacyCancel: collateral', () => {
  const pooled = () => cancelTx((tx) => {
    tx.body.collaterals = [SPONSORED_IN];
    delete tx.body.collateralReturn;
    delete tx.body.totalCollateral;
  });

  it('accepts sponsored ref only as collateral', () => {
    const summary = verify(pooled(), REFS, context({ sponsoredCollateralRef: SPONSORED }));
    expect(summary.sponsoredCollateralRef).toBe(SPONSORED);
    // Not echoed when the cancel uses the wallet's own collateral.
    expect(verify(cancelTx(), REFS, context({ sponsoredCollateralRef: SPONSORED }))).not.toHaveProperty('sponsoredCollateralRef');
    // Spent as a regular input it is refused, even were it listed among the wallet's UTxOs.
    refusedBy('INPUTS', () => verify(cancelTx((tx) => { tx.body.inputs.push(SPONSORED_IN); }), REFS, context({
      sponsoredCollateralRef: SPONSORED,
      ownUtxos: [FEE_UTXO, utxo(SPONSORED_TX, 2, RECEIVE, 5_000_000n)],
    })));
    // Not lent: the pool UTxO is a foreign collateral.
    refusedBy('COLLATERAL', () => verify(pooled()));
  });

  it('rejects collateral from a foreign UTxO or total over 5 ADA', () => {
    refusedBy('COLLATERAL', () => verify(cancelTx((tx) => { tx.body.collaterals = [txIn('cd'.repeat(32), 0)]; })));
    refusedBy('COLLATERAL', () => verify(cancelTx((tx) => {
      tx.body.collateralReturn!.value.coins = FEE_COINS - LEGACY_CANCEL_MAX_COLLATERAL - 1n;
      tx.body.totalCollateral = LEGACY_CANCEL_MAX_COLLATERAL + 1n;
    })));
    // No collateral return: the whole 10 ADA input is at risk.
    refusedBy('COLLATERAL', () => verify(cancelTx((tx) => { delete tx.body.collateralReturn; delete tx.body.totalCollateral; })));
    expect(verify(cancelTx((tx) => {
      tx.body.collateralReturn!.value.coins = FEE_COINS - LEGACY_CANCEL_MAX_COLLATERAL;
      tx.body.totalCollateral = LEGACY_CANCEL_MAX_COLLATERAL;
    })).txId).toBeTruthy();
  });

  it('rejects a collateral return that is not plain ADA to the wallet, or a total that disagrees with it', () => {
    refusedBy('COLLATERAL', () => verify(cancelTx((tx) => { tx.body.collateralReturn!.address = Cardano.PaymentAddress(FOREIGN); })));
    refusedBy('COLLATERAL', () => verify(cancelTx((tx) => { tx.body.collateralReturn!.value.assets = assets(NFT, 1n); })));
    refusedBy('COLLATERAL', () => verify(cancelTx((tx) => { tx.body.collateralReturn!.datum = plutusData('d87980'); })));
    refusedBy('COLLATERAL', () => verify(cancelTx((tx) => { tx.body.totalCollateral = 1n; })));
  });

  it('rejects own collateral that is not an ADA-only fee input, and anything but one collateral', () => {
    const spare = utxo('bb'.repeat(32), 0, RECEIVE, 5_000_000n);
    refusedBy('COLLATERAL', () => verify(cancelTx((tx) => {
      tx.body.collaterals = [txIn('bb'.repeat(32), 0)];
    }), REFS, context({ ownUtxos: [FEE_UTXO, spare] })));
    const withTokens = utxo('7d'.repeat(32), 0, RECEIVE, FEE_COINS, { [OTHER_NFT]: 1n });
    refusedBy('COLLATERAL', () => verify(cancelTx(), REFS, context({ ownUtxos: [withTokens] })));
    refusedBy('COLLATERAL', () => verify(cancelTx((tx) => {
      tx.body.collaterals!.push(txIn('bb'.repeat(32), 0));
    }), REFS, context({ ownUtxos: [FEE_UTXO, spare] })));
    refusedBy('COLLATERAL', () => verify(cancelTx((tx) => {
      delete tx.body.collaterals;
      delete tx.body.collateralReturn;
      delete tx.body.totalCollateral;
    })));
  });
});

describe('verifyLegacyCancel: fee', () => {
  it('rejects a fee over 2 ADA', () => {
    refusedBy('FEE', () => verify(cancelTx((tx) => { tx.body.fee = LEGACY_CANCEL_MAX_FEE + 1n; })));
    expect(verify(cancelTx((tx) => { tx.body.fee = LEGACY_CANCEL_MAX_FEE; })).feeLovelace).toBe('2000000');
  });
});
