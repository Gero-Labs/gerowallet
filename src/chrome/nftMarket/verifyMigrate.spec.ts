// The wallet's check of a migrate that Nexus built: the owner-signed cancel of a listing on the
// closed marketplace's contract whose NFT goes straight into a new Gero listing instead of back
// to the wallet. Two halves have to hold at once, each held to the rules of its own family: the
// legacy spend (the rescue's) and the new listing (the market's). One passing transaction per
// legacy contract here, and an altered copy per rule that must be refused with that rule's code.
//
// The legacy side is the real mainnet contracts' hashes, reference scripts and cancel redeemers
// (`LEGACY_SCRIPTS`). The Gero side uses a TEST deployment list: the production mainnet list is
// EMPTY in phase 1, so a real mainnet migrate is refused (tested explicitly below). The first
// test deployment carries the real preprod v1 values; datums are written by hand with
// indefinite-length constructors, as Nexus writes them, and the first test pins that encoder to
// Nexus's two-royalty fixture.
import { describe, expect, it } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Ed25519KeyHashHex, Hash28ByteBase16, Hash32ByteBase16 } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import type { LegacyListingItem } from '@/api/legacy-listings-api';
import { inlineDatumFromCbor } from '@/shared/utils/utxoCbor';
import {
  LEGACY_CANCEL_MAX_COLLATERAL,
  LEGACY_CANCEL_MAX_FEE,
  LEGACY_SCRIPTS,
} from '@/utils/legacyMarketScripts';
import {
  MAX_LISTING_DEPOSIT,
  NFT_MARKET_DEPLOYMENTS_PREPROD,
  NFT_MARKET_MAX_COLLATERAL_LOVELACE,
  NFT_MARKET_MAX_FEE_LOVELACE,
  NFT_MARKET_MAX_VALIDITY_SLOTS,
  type NftMarketDeployment,
} from '@/utils/nftMarketDeployments';
import { decodeListingDatum, type ListingDatum, type Payee } from './listingDatum';
import type { OwnListing } from './ownListings';
import { MarketVerifyError, type ListIntent, type MarketVerifyRule } from './verifyListing';
import { verifyMigrate, type MigrateIntent, type MigrateVerifyContext } from './verifyMigrate';

const MAINNET = Cardano.NetworkId.Mainnet;
const TESTNET = Cardano.NetworkId.Testnet;
const ADA = 1_000_000n;
const V3 = LEGACY_SCRIPTS.legacy_v3;
const V2 = LEGACY_SCRIPTS.legacy_v2;

// ---------------------------------------------------------------------------------------------
// Datum encoder (test side)
// ---------------------------------------------------------------------------------------------

const hex2 = (n: number) => n.toString(16).padStart(2, '0');
const bstr = (h: string) => `58${hex2(h.length / 2)}${h}`;
const NONE = 'd87a80';

function uint(n: bigint): string {
  if (n < 24n) return n.toString(16).padStart(2, '0');
  if (n < 0x100n) return `18${n.toString(16).padStart(2, '0')}`;
  if (n < 0x10000n) return `19${n.toString(16).padStart(4, '0')}`;
  if (n < 0x100000000n) return `1a${n.toString(16).padStart(8, '0')}`;
  return `1b${n.toString(16).padStart(16, '0')}`;
}

/** `Constr index [fields]` as an indefinite-length list (index 0 and 1 only). */
const constr = (index: 0 | 1, fields: string[]) => `${index === 0 ? 'd879' : 'd87a'}9f${fields.join('')}ff`;

function credentialData(c: Cardano.Credential): string {
  return constr(c.type === Cardano.CredentialType.KeyHash ? 0 : 1, [bstr(c.hash)]);
}

function addressData(bech32: string): string {
  const address = Cardano.Address.fromBech32(bech32);
  const base = address.asBase();
  if (base) {
    return constr(0, [credentialData(base.getPaymentCredential()), constr(0, [constr(0, [credentialData(base.getStakeCredential())])])]);
  }
  return constr(0, [credentialData(address.asEnterprise()!.getPaymentCredential()), NONE]);
}

const payeeData = (p: Payee) => constr(0, [addressData(p.address), uint(p.lovelace)]);

function listingDatumHex(d: ListingDatum): string {
  return constr(0, [
    bstr(d.owner),
    addressData(d.sellerAddress),
    uint(d.price),
    `9f${d.royalties.map(payeeData).join('')}ff`,
    d.buyer === null ? NONE : constr(0, [bstr(d.buyer)]),
  ]);
}

// ---------------------------------------------------------------------------------------------
// The wallet
// ---------------------------------------------------------------------------------------------

// Two payment keys (each the owner of one stuck listing) under one stake key.
const OWNER_A = '1864a6eb4242da06750913784d9afb549dc3022d01bbd316530f390c';
const OWNER_B = 'b551db0a6c4f3e1d2a90b7c85e4f13d6a7b8c9d0e1f2a3b4c5d6e7f8';
const STAKE = '5ce6d8a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6071829';
const OTHER_STAKE = '99'.repeat(28);
const STRANGER = '77'.repeat(28);

function baseAddress(networkId: Cardano.NetworkId, payment: string, stake: string, paymentIsScript = false): string {
  return Cardano.BaseAddress.fromCredentials(
    networkId,
    { hash: Hash28ByteBase16(payment), type: paymentIsScript ? Cardano.CredentialType.ScriptHash : Cardano.CredentialType.KeyHash },
    { hash: Hash28ByteBase16(stake), type: Cardano.CredentialType.KeyHash },
  ).toAddress().toBech32();
}

const RECEIVE = baseAddress(MAINNET, OWNER_A, STAKE);
const SECOND = baseAddress(MAINNET, OWNER_B, STAKE);
const FOREIGN = baseAddress(MAINNET, STRANGER, OTHER_STAKE);
const TESTNET_RECEIVE = baseAddress(TESTNET, OWNER_A, STAKE);
const ROYALTY_ADDRESS = baseAddress(MAINNET, '41'.repeat(28), '42'.repeat(28));
/** The legacy contract's address carrying the wallet's own stake key: never the wallet's to be paid at. */
const LEGACY_SCRIPT_ADDRESS = baseAddress(MAINNET, V3.scriptHash, STAKE, true);

// TEST-ONLY mainnet deployments (the production list is empty in phase 1). v2 is the newest.
const GERO_V1: NftMarketDeployment = { ...NFT_MARKET_DEPLOYMENTS_PREPROD[0] };
const GERO_V2: NftMarketDeployment = {
  ...GERO_V1,
  version: 2,
  scriptHash: 'c2'.repeat(28),
  referenceScript: `${'d2'.repeat(32)}#0`,
};
const listingAddressAt = (deployment: NftMarketDeployment, stake = STAKE) => baseAddress(MAINNET, deployment.scriptHash, stake, true);
const GERO_LISTING_V2 = listingAddressAt(GERO_V2);
const GERO_LISTING_V1 = listingAddressAt(GERO_V1);

// ---------------------------------------------------------------------------------------------
// The legacy listings
// ---------------------------------------------------------------------------------------------

const V3_NFT = '22d843e9e8b39d105c645944cc848abee2673d64e60f1f022791ec85457175696e6550696f6e656572536b696e3034363031';
const V2_NFT = `${'ee'.repeat(28)}${Buffer.from('Legacy V2 NFT').toString('hex')}`;
const OTHER_NFT = `${'99'.repeat(28)}4f74686572`;
/** A CIP-68 (100) reference token: held at a legacy contract by mistake, never a listable NFT. */
const REFERENCE_TOKEN = `${'ab'.repeat(28)}000643b0${Buffer.from('Ref').toString('hex')}`;

const itemRef = (item: LegacyListingItem) => `${item.txHash}#${item.outputIndex}`;

// Sorted ledger order of the V3 migrate's inputs: FEE (7d…) 0, V3_LISTING (fb…) 1.
const V3_LISTING: LegacyListingItem = {
  txHash: 'fb150415126b92a47b46b3a8214d138bdbaab124615afaf8f4d612dd3c16c165',
  outputIndex: 0,
  contract: 'legacy_v3',
  kind: 'listing',
  ownerPkh: OWNER_A,
  lovelace: '1361960',
  assets: [{ unit: V3_NFT, quantity: '1' }],
};
// Sorted ledger order of the V2 migrate's inputs: V2_LISTING (3c…) 0, FEE (7d…) 1.
const V2_LISTING: LegacyListingItem = {
  txHash: '3c'.repeat(32),
  outputIndex: 1,
  contract: 'legacy_v2',
  kind: 'listing',
  ownerPkh: OWNER_B,
  lovelace: '1500000',
  assets: [{ unit: V2_NFT, quantity: '1' }],
};
/** An offer: ADA only, no NFT, so nothing to list. */
const V2_OFFER: LegacyListingItem = {
  txHash: 'e5'.repeat(32),
  outputIndex: 0,
  contract: 'legacy_v2',
  kind: 'offer',
  ownerPkh: OWNER_B,
  lovelace: '25000000',
  assets: [],
};
/** Another of the wallet's stuck listings, known but not asked to move. */
const UNREQUESTED: LegacyListingItem = {
  txHash: 'd4'.repeat(32),
  outputIndex: 0,
  contract: 'legacy_v3',
  kind: 'listing',
  ownerPkh: OWNER_A,
  lovelace: '2000000',
  assets: [{ unit: OTHER_NFT, quantity: '1' }],
};

const V3_SORTED = 1;
const V2_SORTED = 0;

// ---------------------------------------------------------------------------------------------
// UTxOs and inputs
// ---------------------------------------------------------------------------------------------

const txIn = (txId: string, index: number): Cardano.TxIn => ({ txId: Cardano.TransactionId(txId), index });
const refIn = (ref: string) => txIn(ref.split('#')[0], Number(ref.split('#')[1]));
const itemIn = (item: LegacyListingItem) => txIn(item.txHash, item.outputIndex);

function utxo(txId: string, index: number, address: string, coins: bigint, assets?: Record<string, bigint>): Cardano.Utxo {
  return [
    { txId: Cardano.TransactionId(txId), index, address: address as Cardano.PaymentAddress },
    {
      address: address as Cardano.PaymentAddress,
      value: { coins, ...(assets ? { assets: new Map(Object.entries(assets)) as Cardano.TokenMap } : {}) },
    },
  ] as Cardano.Utxo;
}

const FEE_TX = '7d'.repeat(32);
const FEE_COINS = 10_000_000n;
const FEE_IN = txIn(FEE_TX, 0);
const FEE_UTXO = utxo(FEE_TX, 0, RECEIVE, FEE_COINS);
const SPONSORED_TX = 'aa'.repeat(32);
const SPONSORED_REF = `${SPONSORED_TX}#2`;
const SPONSORED_IN = txIn(SPONSORED_TX, 2);
/** An own NFT, used where an offer is (wrongly) turned into a listing of an NFT that was never in it. */
const OWN_NFT_TX = 'a1'.repeat(32);
const OWN_NFT = `${'bb'.repeat(28)}${Buffer.from('Own NFT').toString('hex')}`;
const OWN_NFT_UTXO = utxo(OWN_NFT_TX, 0, RECEIVE, 2_000_000n, { [OWN_NFT]: 1n });
/** An own Gero listing, which no migrate may spend. */
const OWN_LISTING_TX = 'b1'.repeat(32);
const OWN_LISTING_REF = `${OWN_LISTING_TX}#0`;

const assets = (unit: string, quantity = 1n) => new Map([[Cardano.AssetId(unit), quantity]]) as Cardano.TokenMap;
const plutusData = (cbor: string) => Serialization.PlutusData.fromCbor(HexBlob(cbor)).toCore();
const inline = (cbor: string) => inlineDatumFromCbor(HexBlob(cbor));
const redeemer = (purpose: Cardano.RedeemerPurpose, index: number, cbor: string): Cardano.Redeemer => ({
  purpose,
  index,
  data: plutusData(cbor),
  executionUnits: { memory: 600_000, steps: 250_000_000 },
});
const spend = (index: number, cbor: string) => redeemer(Cardano.RedeemerPurpose.spend, index, cbor);

// ---------------------------------------------------------------------------------------------
// Intents and datums
// ---------------------------------------------------------------------------------------------

const ROYALTIES: Payee[] = [{ address: ROYALTY_ADDRESS, lovelace: 5n * ADA }];
const V3_PRICE = 100n * ADA;
const V2_PRICE = 50n * ADA;
const V3_DEPOSIT = 2n * ADA;
const V2_DEPOSIT = 1_800_000n;

const V3_DATUM: ListingDatum = { owner: OWNER_A, sellerAddress: RECEIVE, price: V3_PRICE, royalties: ROYALTIES, buyer: null };
const V2_DATUM: ListingDatum = { owner: OWNER_B, sellerAddress: SECOND, price: V2_PRICE, royalties: [], buyer: null };

const V3_LIST: ListIntent = {
  unit: V3_NFT,
  price: V3_PRICE,
  royalties: ROYALTIES,
  ownerPkh: OWNER_A,
  sellerAddress: RECEIVE,
  stakeCredential: STAKE,
};
const V2_LIST: ListIntent = {
  unit: V2_NFT,
  price: V2_PRICE,
  royalties: [],
  ownerPkh: OWNER_B,
  sellerAddress: SECOND,
  stakeCredential: STAKE,
};
const V3_MIGRATE: MigrateIntent = { legacyRef: itemRef(V3_LISTING), list: V3_LIST };
const V2_MIGRATE: MigrateIntent = { legacyRef: itemRef(V2_LISTING), list: V2_LIST };

function context(overrides: Partial<MigrateVerifyContext> = {}): MigrateVerifyContext {
  return {
    networkId: MAINNET,
    deployments: [GERO_V2, GERO_V1],
    ownUtxos: [FEE_UTXO],
    ownAddresses: new Set([RECEIVE, SECOND]),
    ownKeyHashes: new Set([OWNER_A, OWNER_B, STAKE]),
    ownListings: new Map(),
    stakeKeyHash: STAKE,
    items: new Map([V3_LISTING, V2_LISTING, V2_OFFER, UNREQUESTED].map((item) => [itemRef(item), item])),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------------------------

const WINDOW = { invalidBefore: Cardano.Slot(1000), invalidHereafter: Cardano.Slot(1000 + 1920) };

const geroOutput = (address: string, datum: string | undefined, unit: string, coins: bigint): Cardano.TxOut => ({
  address: Cardano.PaymentAddress(address),
  value: { coins, assets: assets(unit) },
  ...(datum ? { datum: inline(datum) } : {}),
});

/**
 * The valid V3 migrate, as Nexus builds it: the legacy_v3 listing and a fee input, the legacy
 * reference script, the cancel redeemer, the owner as the only required signer; the NFT goes
 * to a new Gero listing at the newest deployment (output 0), the rest back to the wallet; the
 * fee input is the collateral; a bounded validity window.
 */
function validV3(): Cardano.Tx {
  return {
    id: Cardano.TransactionId('00'.repeat(32)),
    body: {
      inputs: [itemIn(V3_LISTING), FEE_IN],
      outputs: [
        geroOutput(GERO_LISTING_V2, listingDatumHex(V3_DATUM), V3_NFT, V3_DEPOSIT),
        { address: Cardano.PaymentAddress(RECEIVE), value: { coins: 8_961_960n } },
      ],
      fee: 400_000n,
      validityInterval: WINDOW,
      collaterals: [FEE_IN],
      collateralReturn: { address: Cardano.PaymentAddress(RECEIVE), value: { coins: 9_400_000n } },
      totalCollateral: 600_000n,
      referenceInputs: [refIn(V3.referenceScript)],
      requiredExtraSignatures: [Ed25519KeyHashHex(OWNER_A)],
      scriptIntegrityHash: Hash32ByteBase16('ab'.repeat(32)),
    },
    witness: { signatures: new Map(), redeemers: [spend(V3_SORTED, V3.cancelRedeemerCbor)] },
    isValid: true,
  };
}

/** The valid V2 migrate: the same shape on the other contract, owner B, a plain NFT, no royalties. */
function validV2(): Cardano.Tx {
  return {
    id: Cardano.TransactionId('00'.repeat(32)),
    body: {
      inputs: [itemIn(V2_LISTING), FEE_IN],
      outputs: [
        geroOutput(GERO_LISTING_V2, listingDatumHex(V2_DATUM), V2_NFT, V2_DEPOSIT),
        { address: Cardano.PaymentAddress(SECOND), value: { coins: 9_661_960n } },
      ],
      fee: 380_000n,
      validityInterval: WINDOW,
      collaterals: [FEE_IN],
      collateralReturn: { address: Cardano.PaymentAddress(RECEIVE), value: { coins: 9_400_000n } },
      totalCollateral: 600_000n,
      referenceInputs: [refIn(V2.referenceScript)],
      requiredExtraSignatures: [Ed25519KeyHashHex(OWNER_B)],
      scriptIntegrityHash: Hash32ByteBase16('ab'.repeat(32)),
    },
    witness: { signatures: new Map(), redeemers: [spend(V2_SORTED, V2.cancelRedeemerCbor)] },
    isValid: true,
  };
}

type Built = { cbor: string; id: string };

function build(tx: Cardano.Tx, edit: (tx: Cardano.Tx) => void): Built {
  edit(tx);
  const serialized = Serialization.Transaction.fromCore(tx);
  return { cbor: serialized.toCbor(), id: serialized.getId() };
}

const v3Tx = (edit: (tx: Cardano.Tx) => void = () => undefined) => build(validV3(), edit);
const v2Tx = (edit: (tx: Cardano.Tx) => void = () => undefined) => build(validV2(), edit);

const verify = (tx: Built, intent: MigrateIntent = V3_MIGRATE, ctx: MigrateVerifyContext = context()) =>
  verifyMigrate(tx.cbor, tx.id, intent, ctx);

function refusedBy(rule: MarketVerifyRule, run: () => unknown) {
  try {
    run();
  } catch (e) {
    expect(e).toBeInstanceOf(MarketVerifyError);
    expect((e as MarketVerifyError).rule).toBe(rule);
    return;
  }
  throw new Error(`expected a ${rule} refusal, but the migrate was accepted`);
}

/** The V3 migrate with the listing output's datum replaced. */
const v3WithDatum = (cbor: string) => v3Tx((tx) => { tx.body.outputs[0].datum = inline(cbor); });
const withDatum = (patch: Partial<ListingDatum>): ListingDatum => ({ ...V3_DATUM, ...patch });

// ---------------------------------------------------------------------------------------------

describe('the test datum encoder', () => {
  it("writes Nexus's two-royalty fixture byte for byte", () => {
    const fixture =
      'd8799f581c0102030405060708090a0b0c0d0e0f101112131415161718191a1b1cd8799fd8799f581c0102030405060708090a0b0c0d0e0f101112131415161718191a1b1cffd8799fd8799fd8799f581c2122232425262728292a2b2c2d2e2f303132333435363738393a3b3cffffffff1a05f5e1009fd8799fd8799fd8799f581c4142434445464748494a4b4c4d4e4f505152535455565758595a5b5cffd87a80ff1a004c4b40ffd8799fd8799fd87a9f581c6162636465666768696a6b6c6d6e6f707172737475767778797a7b7cffd8799fd8799fd8799f581c2122232425262728292a2b2c2d2e2f303132333435363738393a3b3cffffffff1a001e8480ffffd87a80ff';
    expect(listingDatumHex(decodeListingDatum(fixture, 0))).toBe(fixture);
  });
});

describe('verifyMigrate: the valid migrate', () => {
  it('accepts a legacy_v3 listing moved to Gero and summarises it', () => {
    const tx = v3Tx();
    expect(verify(tx)).toEqual({
      txId: tx.id,
      legacyRef: itemRef(V3_LISTING),
      legacyContract: 'legacy_v3',
      unit: V3_NFT,
      listingAddress: GERO_LISTING_V2,
      listingOutputIndex: 0,
      deploymentVersion: 2,
      priceLovelace: '100000000',
      marketFeeLovelace: '1500000',
      royalties: [{ address: ROYALTY_ADDRESS, lovelace: '5000000' }],
      royaltiesLovelace: '5000000',
      sellerReceivesLovelace: '93500000',
      depositLovelace: '2000000',
      networkFeeLovelace: '400000',
    });
  });

  it('accepts a legacy_v2 listing moved to Gero and summarises it', () => {
    const tx = v2Tx();
    expect(verify(tx, V2_MIGRATE)).toEqual({
      txId: tx.id,
      legacyRef: itemRef(V2_LISTING),
      legacyContract: 'legacy_v2',
      unit: V2_NFT,
      listingAddress: GERO_LISTING_V2,
      listingOutputIndex: 0,
      deploymentVersion: 2,
      priceLovelace: '50000000',
      marketFeeLovelace: '1500000',
      royalties: [],
      royaltiesLovelace: '0',
      sellerReceivesLovelace: '48500000',
      depositLovelace: '1800000',
      networkFeeLovelace: '380000',
    });
  });

  it('finds the listing output wherever it sits among the outputs', () => {
    const summary = verify(v3Tx((tx) => { tx.body.outputs.reverse(); }));
    expect(summary.listingOutputIndex).toBe(1);
  });

  it('refuses a tx whose id differs from the one reported, and bytes that are no transaction', () => {
    const tx = v3Tx();
    refusedBy('TX_ID', () => verifyMigrate(tx.cbor, 'ab'.repeat(32), V3_MIGRATE, context()));
    refusedBy('TX_ID', () => verifyMigrate('84a0', tx.id, V3_MIGRATE, context()));
  });
});

describe('verifyMigrate: network', () => {
  it('refuses a mainnet migrate while the market has no mainnet deployment (phase 1)', () => {
    // The production mainnet list is EMPTY until the audit closes: nothing may be signed, even
    // though the legacy half of this transaction is a perfectly good rescue.
    refusedBy('NETWORK', () => verify(v3Tx(), V3_MIGRATE, context({ deployments: [] })));
    refusedBy('NETWORK', () => verify(v2Tx(), V2_MIGRATE, context({ deployments: [] })));
  });

  it('refuses a context other than mainnet: the legacy contracts exist nowhere else', () => {
    refusedBy('NETWORK', () => verify(v3Tx(), V3_MIGRATE, context({ networkId: TESTNET })));
    // Even a transaction that is testnet from end to end (every address, the deployments' script,
    // the datum), so that no address check could refuse it: the legacy half has no testnet.
    const testnetListing = baseAddress(TESTNET, GERO_V2.scriptHash, STAKE, true);
    const testnetDatum: ListingDatum = { ...V3_DATUM, sellerAddress: TESTNET_RECEIVE, royalties: [] };
    const tx = v3Tx((t) => {
      t.body.outputs[0] = geroOutput(testnetListing, listingDatumHex(testnetDatum), V3_NFT, V3_DEPOSIT);
      t.body.outputs[1].address = Cardano.PaymentAddress(TESTNET_RECEIVE);
      t.body.collateralReturn!.address = Cardano.PaymentAddress(TESTNET_RECEIVE);
    });
    const intent: MigrateIntent = { ...V3_MIGRATE, list: { ...V3_LIST, royalties: [], sellerAddress: TESTNET_RECEIVE } };
    refusedBy('NETWORK', () => verify(tx, intent, context({
      networkId: TESTNET,
      ownAddresses: new Set([TESTNET_RECEIVE]),
      ownUtxos: [utxo(FEE_TX, 0, TESTNET_RECEIVE, FEE_COINS)],
    })));
  });

  it('refuses a body network id that differs, and accepts the right one', () => {
    expect(verify(v3Tx((tx) => { tx.body.networkId = MAINNET; })).txId).toBeTruthy();
    refusedBy('NETWORK', () => verify(v3Tx((tx) => { tx.body.networkId = TESTNET; })));
  });

  it('refuses an output address of another network', () => {
    refusedBy('NETWORK', () => verify(v3Tx((tx) => { tx.body.outputs[1].address = Cardano.PaymentAddress(TESTNET_RECEIVE); })));
  });
});

describe('verifyMigrate: what is moved', () => {
  it('refuses an offer: it holds no NFT to list', () => {
    // The offer cancelled and an NFT of the wallet's own listed in the same transaction: an
    // offer-cancel with a listing attached is not a migrate.
    const tx = build(
      {
        id: Cardano.TransactionId('00'.repeat(32)),
        body: {
          inputs: [itemIn(V2_OFFER), txIn(OWN_NFT_TX, 0), FEE_IN],
          outputs: [
            geroOutput(GERO_LISTING_V2, listingDatumHex({ ...V2_DATUM }), OWN_NFT, V2_DEPOSIT),
            { address: Cardano.PaymentAddress(SECOND), value: { coins: 33_000_000n } },
          ],
          fee: 380_000n,
          validityInterval: WINDOW,
          collaterals: [FEE_IN],
          collateralReturn: { address: Cardano.PaymentAddress(RECEIVE), value: { coins: 9_400_000n } },
          totalCollateral: 600_000n,
          referenceInputs: [refIn(V2.referenceScript)],
          requiredExtraSignatures: [Ed25519KeyHashHex(OWNER_B)],
          scriptIntegrityHash: Hash32ByteBase16('ab'.repeat(32)),
        },
        // Sorted: OFFER (e5) 2, FEE (7d) 0, OWN_NFT (a1) 1 -> the offer is at index 2.
        witness: { signatures: new Map(), redeemers: [spend(2, V2.cancelRedeemerCbor)] },
        isValid: true,
      },
      () => undefined,
    );
    const intent: MigrateIntent = { legacyRef: itemRef(V2_OFFER), list: { ...V2_LIST, unit: OWN_NFT } };
    refusedBy('INPUTS', () => verify(tx, intent, context({ ownUtxos: [FEE_UTXO, OWN_NFT_UTXO] })));
    // And the offer's own row is no listing, whatever transaction comes with it.
    refusedBy('INPUTS', () => verify(v2Tx(), { ...V2_MIGRATE, legacyRef: itemRef(V2_OFFER) }));
  });

  it('refuses two legacy listings in one migrate', () => {
    // The transaction spends a second legacy listing the intent did not ask for.
    refusedBy('INPUTS', () => verify(v3Tx((tx) => { tx.body.inputs.push(itemIn(UNREQUESTED)); })));
    // The intent names two refs, as a list or as one string.
    const two = [itemRef(V3_LISTING), itemRef(UNREQUESTED)];
    refusedBy('INPUTS', () => verify(v3Tx(), { ...V3_MIGRATE, legacyRef: two as unknown as string }));
    refusedBy('INPUTS', () => verify(v3Tx(), { ...V3_MIGRATE, legacyRef: two.join(',') }));
  });

  it('refuses a migrate whose transaction does not spend the legacy listing asked for', () => {
    refusedBy('INPUTS', () => verify(v3Tx((tx) => { tx.body.inputs = [FEE_IN]; })));
    // Another legacy listing asked for (with its own NFT, so the NFT check passes): the transaction never spends it.
    refusedBy('INPUTS', () => verify(v3Tx(), { legacyRef: itemRef(UNREQUESTED), list: { ...V3_LIST, unit: OTHER_NFT } }));
    // The NFT of another listing than the one named is refused before the transaction is read.
    refusedBy('NFT', () => verify(v3Tx(), { ...V3_MIGRATE, legacyRef: itemRef(UNREQUESTED) }));
  });

  it('refuses a missing, unknown or malformed legacy ref', () => {
    refusedBy('INPUTS', () => verify(v3Tx(), { ...V3_MIGRATE, legacyRef: `${'cd'.repeat(32)}#0` }));
    refusedBy('INPUTS', () => verify(v3Tx(), { ...V3_MIGRATE, legacyRef: undefined as unknown as string }));
    refusedBy('INPUTS', () => verify(v3Tx(), { ...V3_MIGRATE, legacyRef: '' }));
    refusedBy('INPUTS', () => verify(v3Tx(), V3_MIGRATE, context({ items: new Map() })));
  });

  it('refuses a legacy listing that holds anything but the one NFT', () => {
    const bundle: LegacyListingItem = { ...V3_LISTING, assets: [{ unit: V3_NFT, quantity: '1' }, { unit: OTHER_NFT, quantity: '1' }] };
    const two: LegacyListingItem = { ...V3_LISTING, assets: [{ unit: V3_NFT, quantity: '2' }] };
    const context1 = (item: LegacyListingItem) => context({ items: new Map([[itemRef(item), item]]) });
    refusedBy('NFT', () => verify(v3Tx(), V3_MIGRATE, context1(bundle)));
    refusedBy('NFT', () => verify(v3Tx(), V3_MIGRATE, context1(two)));
  });

  it('refuses an intent for an NFT other than the one the legacy listing holds', () => {
    refusedBy('NFT', () => verify(v3Tx(), { ...V3_MIGRATE, list: { ...V3_LIST, unit: OTHER_NFT } }));
    refusedBy('NFT', () => verify(v3Tx(), { ...V3_MIGRATE, list: undefined as unknown as ListIntent }));
  });

  it('refuses a CIP-68 token that is not the (222) user token, even when it matches the legacy listing', () => {
    const item: LegacyListingItem = { ...V3_LISTING, assets: [{ unit: REFERENCE_TOKEN, quantity: '1' }] };
    const tx = v3Tx((t) => { t.body.outputs[0] = geroOutput(GERO_LISTING_V2, listingDatumHex(V3_DATUM), REFERENCE_TOKEN, V3_DEPOSIT); });
    refusedBy('NFT', () => verify(tx, { ...V3_MIGRATE, list: { ...V3_LIST, unit: REFERENCE_TOKEN } }, context({ items: new Map([[itemRef(item), item]]) })));
  });
});

describe('verifyMigrate: the legacy spend (the rescue\'s rules)', () => {
  it('refuses an input that is not the wallet\'s', () => {
    refusedBy('INPUTS', () => verify(v3Tx((tx) => { tx.body.inputs.push(txIn('cd'.repeat(32), 0)); })));
    refusedBy('INPUTS', () => verify(v3Tx(), V3_MIGRATE, context({ ownUtxos: [] })));
  });

  it('refuses a Gero listing as an input, even one wrongly among the wallet\'s UTxOs', () => {
    const own: OwnListing = { ref: OWN_LISTING_REF, unit: OTHER_NFT, datum: V3_DATUM, depositLovelace: '2000000', deploymentVersion: 1 };
    refusedBy('INPUTS', () => verify(
      v3Tx((tx) => {
        tx.body.inputs.push(txIn(OWN_LISTING_TX, 0));
        // Sorted: FEE (7d) 0, the listing (b1) 1, the legacy listing (fb) 2.
        tx.witness.redeemers = [spend(2, V3.cancelRedeemerCbor)];
      }),
      V3_MIGRATE,
      context({
        ownListings: new Map([[OWN_LISTING_REF, own]]),
        ownUtxos: [FEE_UTXO, utxo(OWN_LISTING_TX, 0, GERO_LISTING_V1, 2n * ADA, { [OTHER_NFT]: 1n })],
      }),
    ));
  });

  it('refuses the lent pool collateral as an input', () => {
    refusedBy('INPUTS', () => verify(
      v3Tx((tx) => { tx.body.inputs.push(SPONSORED_IN); }),
      V3_MIGRATE,
      context({ sponsoredCollateralRef: SPONSORED_REF, ownUtxos: [FEE_UTXO, utxo(SPONSORED_TX, 2, RECEIVE, 5n * ADA)] }),
    ));
  });

  it('refuses a reference input other than the legacy contract\'s own script', () => {
    // Nothing of Gero's, nothing extra, nothing missing, and not the other legacy contract's script.
    refusedBy('INPUTS', () => verify(v3Tx((tx) => { tx.body.referenceInputs = [refIn(V3.referenceScript), refIn(GERO_V2.referenceScript)]; })));
    refusedBy('INPUTS', () => verify(v3Tx((tx) => { tx.body.referenceInputs = [refIn(GERO_V2.referenceScript)]; })));
    refusedBy('INPUTS', () => verify(v3Tx((tx) => { tx.body.referenceInputs!.push(txIn('cd'.repeat(32), 0)); })));
    refusedBy('INPUTS', () => verify(v3Tx((tx) => { tx.body.referenceInputs = [refIn(V2.referenceScript)]; })));
    refusedBy('INPUTS', () => verify(v3Tx((tx) => { delete tx.body.referenceInputs; })));
  });

  it('refuses a legacy input without its contract\'s cancel redeemer', () => {
    const withRedeemers = (redeemers: Cardano.Redeemer[]) => v3Tx((tx) => { tx.witness.redeemers = redeemers; });
    // legacy_v2's cancel on the legacy_v3 input, and the same value in other bytes (compared as signed).
    refusedBy('REDEEMERS', () => verify(withRedeemers([spend(V3_SORTED, V2.cancelRedeemerCbor)])));
    refusedBy('REDEEMERS', () => verify(withRedeemers([spend(V3_SORTED, 'd87a9fff')])));
    refusedBy('REDEEMERS', () => verify(withRedeemers([])));
    refusedBy('REDEEMERS', () => verify(v3Tx((tx) => { delete tx.witness.redeemers; })));
  });

  it('refuses a second redeemer, one for another purpose, and one at the wrong place', () => {
    const withRedeemers = (redeemers: Cardano.Redeemer[]) => v3Tx((tx) => { tx.witness.redeemers = redeemers; });
    // A Gero script's redeemer next to the legacy one: only the legacy script may run.
    refusedBy('REDEEMERS', () => verify(withRedeemers([spend(V3_SORTED, V3.cancelRedeemerCbor), spend(0, 'd87a80')])));
    refusedBy('REDEEMERS', () => verify(withRedeemers([redeemer(Cardano.RedeemerPurpose.mint, V3_SORTED, V3.cancelRedeemerCbor)])));
    // Body order puts the legacy input first; the ledger's sorted order puts it second.
    refusedBy('REDEEMERS', () => verify(withRedeemers([spend(0, V3.cancelRedeemerCbor)])));
  });

  it('requires exactly the legacy listing\'s owner as the signer, and a key of the wallet', () => {
    refusedBy('SIGNERS', () => verify(v3Tx((tx) => { delete tx.body.requiredExtraSignatures; })));
    refusedBy('SIGNERS', () => verify(v3Tx((tx) => { tx.body.requiredExtraSignatures = [Ed25519KeyHashHex(OWNER_B)]; })));
    refusedBy('SIGNERS', () => verify(v3Tx((tx) => {
      tx.body.requiredExtraSignatures = [Ed25519KeyHashHex(OWNER_A), Ed25519KeyHashHex(OWNER_B)];
    })));
    refusedBy('SIGNERS', () => verify(v3Tx((tx) => {
      tx.body.requiredExtraSignatures = [Ed25519KeyHashHex(OWNER_A), Ed25519KeyHashHex(STRANGER)];
    })));
    // The owner is not a key of this wallet.
    refusedBy('SIGNERS', () => verify(v3Tx(), V3_MIGRATE, context({ ownKeyHashes: new Set([OWNER_B, STAKE]) })));
  });
});

describe('verifyMigrate: the Gero listing output', () => {
  it('refuses a migrate whose NFT goes back to the wallet (no listing)', () => {
    refusedBy('LISTING', () => verify(v3Tx((tx) => {
      tx.body.outputs[0] = { address: Cardano.PaymentAddress(RECEIVE), value: { coins: V3_DEPOSIT, assets: assets(V3_NFT) } };
    })));
  });

  it('refuses a listing that does not hold the NFT, the NFT going to the wallet\'s change', () => {
    refusedBy('NFT', () => verify(v3Tx((tx) => {
      tx.body.outputs[0].value.assets = undefined;
      tx.body.outputs[1].value.assets = assets(V3_NFT);
    })));
  });

  it('refuses a migrate whose NFT is sent elsewhere', () => {
    // To a stranger, with an empty listing standing in: the foreign output is refused first.
    refusedBy('OUTPUTS', () => verify(v3Tx((tx) => {
      tx.body.outputs[0].value.assets = undefined;
      tx.body.outputs.push({ address: Cardano.PaymentAddress(FOREIGN), value: { coins: 2n * ADA, assets: assets(V3_NFT) } });
    })));
    // To the legacy contract again.
    refusedBy('OUTPUTS', () => verify(v3Tx((tx) => {
      tx.body.outputs[0] = { address: Cardano.PaymentAddress(LEGACY_SCRIPT_ADDRESS), value: { coins: V3_DEPOSIT, assets: assets(V3_NFT) } };
    }), V3_MIGRATE, context({ ownAddresses: new Set([RECEIVE, SECOND, LEGACY_SCRIPT_ADDRESS]) })));
  });

  it('refuses two listing outputs', () => {
    refusedBy('LISTING', () => verify(v3Tx((tx) => {
      tx.body.outputs.push(geroOutput(GERO_LISTING_V2, listingDatumHex(V3_DATUM), OTHER_NFT, V3_DEPOSIT));
    })));
  });

  it('refuses a listing at an older deployment (a new listing goes to the newest)', () => {
    refusedBy('LISTING', () => verify(v3Tx((tx) => { tx.body.outputs[0].address = Cardano.PaymentAddress(GERO_LISTING_V1); })));
  });

  it('refuses a listing under a stake key that is not the account\'s', () => {
    refusedBy('LISTING', () => verify(v3Tx((tx) => { tx.body.outputs[0].address = Cardano.PaymentAddress(listingAddressAt(GERO_V2, OTHER_STAKE)); })));
    refusedBy('LISTING', () => verify(v3Tx((tx) => { tx.body.outputs[0].address = Cardano.PaymentAddress(listingAddressAt(GERO_V2, OWNER_A)); })));
    refusedBy('LISTING', () => verify(v3Tx(), { ...V3_MIGRATE, list: { ...V3_LIST, stakeCredential: OTHER_STAKE } }));
  });

  it('refuses a deposit above the cap, or none', () => {
    refusedBy('LISTING', () => verify(v3Tx((tx) => { tx.body.outputs[0].value.coins = MAX_LISTING_DEPOSIT + 1n; })));
    expect(verify(v3Tx((tx) => { tx.body.outputs[0].value.coins = MAX_LISTING_DEPOSIT; })).depositLovelace).toBe('5000000');
    refusedBy('LISTING', () => verify(v3Tx((tx) => { tx.body.outputs[0].value.coins = 0n; })));
  });

  it('refuses extra tokens in the listing, or the NFT twice', () => {
    refusedBy('NFT', () => verify(v3Tx((tx) => {
      tx.body.outputs[0].value.assets = new Map([[Cardano.AssetId(V3_NFT), 1n], [Cardano.AssetId(OTHER_NFT), 1n]]) as Cardano.TokenMap;
    })));
    refusedBy('NFT', () => verify(v3Tx((tx) => { tx.body.outputs[0].value.assets = assets(V3_NFT, 2n); })));
  });

  it('refuses a listing that carries a reference script', () => {
    refusedBy('LISTING', () => verify(v3Tx((tx) => {
      tx.body.outputs[0].scriptReference = {
        __type: Cardano.ScriptType.Plutus, version: Cardano.PlutusLanguageVersion.V2, bytes: HexBlob('4e4d01000033222220051200120011'),
      };
    })));
  });
});

describe('verifyMigrate: the datum is the user\'s intent, exactly', () => {
  it.each<[string, Partial<ListingDatum>]>([
    ['the price', { price: 90n * ADA }],
    ['the owner', { owner: OWNER_B }],
    ['the seller address', { sellerAddress: SECOND }],
    ['a seller address that is not the wallet\'s', { sellerAddress: FOREIGN }],
    ['the royalties (none)', { royalties: [] }],
    ['the royalties (another payee)', { royalties: [{ address: FOREIGN, lovelace: 5n * ADA }] }],
    ['the royalties (another amount)', { royalties: [{ address: ROYALTY_ADDRESS, lovelace: 6n * ADA }] }],
    ['the royalties (one more)', { royalties: [...ROYALTIES, { address: ROYALTY_ADDRESS, lovelace: ADA }] }],
    ['a buyer (public listings only)', { buyer: STRANGER }],
  ])('refuses a datum with a different %s', (_name, patch) => {
    refusedBy('DATUM', () => verify(v3WithDatum(listingDatumHex(withDatum(patch)))));
  });

  it('refuses a listing with no inline datum, a datum hash, or a datum that is no Gero listing', () => {
    refusedBy('DATUM', () => verify(v3Tx((tx) => { delete tx.body.outputs[0].datum; })));
    refusedBy('DATUM', () => verify(v3Tx((tx) => {
      delete tx.body.outputs[0].datum;
      tx.body.outputs[0].datumHash = Hash32ByteBase16('00'.repeat(32));
    })));
    refusedBy('DATUM', () => verify(v3WithDatum('d87980')));
  });

  it('refuses a price below the minimum, and a seller share below the minimum', () => {
    const cheap = 4n * ADA;
    refusedBy('DATUM', () => verify(
      v3WithDatum(listingDatumHex(withDatum({ price: cheap, royalties: [] }))),
      { ...V3_MIGRATE, list: { ...V3_LIST, price: cheap, royalties: [] } },
    ));
    // 5 ADA - 1.5 ADA fee - 2.5 ADA royalty = 1 ADA to the seller.
    const thin: Payee[] = [{ address: ROYALTY_ADDRESS, lovelace: 5n * ADA / 2n }];
    refusedBy('DATUM', () => verify(
      v3WithDatum(listingDatumHex(withDatum({ price: 5n * ADA, royalties: thin }))),
      { ...V3_MIGRATE, list: { ...V3_LIST, price: 5n * ADA, royalties: thin } },
    ));
  });

  it('refuses an intent whose owner or seller address is not the wallet\'s', () => {
    refusedBy('DATUM', () => verify(v3Tx(), { ...V3_MIGRATE, list: { ...V3_LIST, ownerPkh: STRANGER } }));
    refusedBy('DATUM', () => verify(
      v3WithDatum(listingDatumHex(withDatum({ sellerAddress: FOREIGN }))),
      { ...V3_MIGRATE, list: { ...V3_LIST, sellerAddress: FOREIGN } },
    ));
  });
});

describe('verifyMigrate: every other output is the wallet\'s', () => {
  it('refuses any output to a foreign address', () => {
    refusedBy('OUTPUTS', () => verify(v3Tx((tx) => {
      tx.body.outputs.push({ address: Cardano.PaymentAddress(FOREIGN), value: { coins: ADA } });
    })));
  });

  it('refuses an output to a script address, even one wrongly among the wallet\'s addresses', () => {
    refusedBy('OUTPUTS', () => verify(v3Tx((tx) => {
      tx.body.outputs.push({ address: Cardano.PaymentAddress(LEGACY_SCRIPT_ADDRESS), value: { coins: ADA } });
    }), V3_MIGRATE, context({ ownAddresses: new Set([RECEIVE, SECOND, LEGACY_SCRIPT_ADDRESS]) })));
  });

  it('refuses a plain output carrying a datum, a datum hash or a reference script', () => {
    refusedBy('OUTPUTS', () => verify(v3Tx((tx) => { tx.body.outputs[1].datum = plutusData('d87980'); })));
    refusedBy('OUTPUTS', () => verify(v3Tx((tx) => { tx.body.outputs[1].datumHash = Hash32ByteBase16('00'.repeat(32)); })));
    refusedBy('OUTPUTS', () => verify(v3Tx((tx) => {
      tx.body.outputs[1].scriptReference = {
        __type: Cardano.ScriptType.Plutus, version: Cardano.PlutusLanguageVersion.V2, bytes: HexBlob('4e4d01000033222220051200120011'),
      };
    })));
  });
});

describe('verifyMigrate: nothing but the migrate', () => {
  it.each<[string, (tx: Cardano.Tx) => void]>([
    ['mint', (tx) => { tx.body.mint = assets(OTHER_NFT, 1n); }],
    ['certificates', (tx) => {
      tx.body.certificates = [{
        __typename: Cardano.CertificateType.StakeRegistration,
        stakeCredential: { hash: Hash28ByteBase16(STAKE), type: Cardano.CredentialType.KeyHash },
      }];
    }],
    ['withdrawals', (tx) => {
      tx.body.withdrawals = [{
        stakeAddress: Cardano.RewardAddress.fromCredentials(MAINNET, {
          hash: Hash28ByteBase16(STAKE), type: Cardano.CredentialType.KeyHash,
        }).toAddress().toBech32() as Cardano.RewardAccount,
        quantity: 0n,
      }];
    }],
    ['donation', (tx) => { tx.body.donation = 1n; }],
    ['auxiliary data', (tx) => { tx.body.auxiliaryDataHash = Hash32ByteBase16('00'.repeat(32)); }],
    ['an invalid flag, which forfeits collateral', (tx) => { tx.isValid = false; }],
  ])('refuses %s', (_name, edit) => {
    refusedBy('FORBIDDEN_FIELD', () => verify(v3Tx(edit)));
  });
});

describe('verifyMigrate: the validity window', () => {
  const window = (invalidBefore?: number, invalidHereafter?: number) => (tx: Cardano.Tx) => {
    tx.body.validityInterval = {
      ...(invalidBefore !== undefined ? { invalidBefore: Cardano.Slot(invalidBefore) } : {}),
      ...(invalidHereafter !== undefined ? { invalidHereafter: Cardano.Slot(invalidHereafter) } : {}),
    };
  };

  it('refuses a migrate with no window, with one bound only, or with an empty one', () => {
    refusedBy('FORBIDDEN_FIELD', () => verify(v3Tx((tx) => { delete tx.body.validityInterval; })));
    refusedBy('FORBIDDEN_FIELD', () => verify(v3Tx(window(1000, undefined))));
    refusedBy('FORBIDDEN_FIELD', () => verify(v3Tx(window(undefined, 1000 + 1800))));
    refusedBy('FORBIDDEN_FIELD', () => verify(v3Tx(window(1000, 1000))));
    refusedBy('FORBIDDEN_FIELD', () => verify(v3Tx(window(2000, 1000))));
  });

  it('refuses a window wider than an hour, and accepts exactly an hour', () => {
    refusedBy('FORBIDDEN_FIELD', () => verify(v3Tx(window(1000, 1000 + NFT_MARKET_MAX_VALIDITY_SLOTS + 1))));
    expect(verify(v3Tx(window(1000, 1000 + NFT_MARKET_MAX_VALIDITY_SLOTS))).txId).toBeTruthy();
  });
});

describe('verifyMigrate: fee and collateral', () => {
  // A migrate runs a legacy script and is a market transaction: the stricter of the two families' caps.
  const MAX_FEE = LEGACY_CANCEL_MAX_FEE < NFT_MARKET_MAX_FEE_LOVELACE ? LEGACY_CANCEL_MAX_FEE : NFT_MARKET_MAX_FEE_LOVELACE;
  const MAX_COLLATERAL = LEGACY_CANCEL_MAX_COLLATERAL < NFT_MARKET_MAX_COLLATERAL_LOVELACE
    ? LEGACY_CANCEL_MAX_COLLATERAL
    : NFT_MARKET_MAX_COLLATERAL_LOVELACE;

  it('refuses a fee over 2 ADA', () => {
    expect(MAX_FEE).toBe(2_000_000n);
    refusedBy('FEE', () => verify(v3Tx((tx) => { tx.body.fee = MAX_FEE + 1n; })));
    expect(verify(v3Tx((tx) => { tx.body.fee = MAX_FEE; })).networkFeeLovelace).toBe('2000000');
  });

  it('accepts the lent pool UTxO only as collateral, and says so', () => {
    const pooled = () => v3Tx((tx) => {
      tx.body.collaterals = [SPONSORED_IN];
      delete tx.body.collateralReturn;
      delete tx.body.totalCollateral;
    });
    expect(verify(pooled(), V3_MIGRATE, context({ sponsoredCollateralRef: SPONSORED_REF })).sponsoredCollateralRef).toBe(SPONSORED_REF);
    // Not echoed when the migrate uses the wallet's own collateral.
    expect(verify(v3Tx(), V3_MIGRATE, context({ sponsoredCollateralRef: SPONSORED_REF }))).not.toHaveProperty('sponsoredCollateralRef');
    // Not lent: the pool UTxO is a foreign collateral.
    refusedBy('COLLATERAL', () => verify(pooled()));
  });

  it('refuses collateral from a foreign UTxO, or more than 5 ADA at risk', () => {
    expect(MAX_COLLATERAL).toBe(5_000_000n);
    refusedBy('COLLATERAL', () => verify(v3Tx((tx) => { tx.body.collaterals = [txIn('cd'.repeat(32), 0)]; })));
    refusedBy('COLLATERAL', () => verify(v3Tx((tx) => {
      tx.body.collateralReturn!.value.coins = FEE_COINS - MAX_COLLATERAL - 1n;
      tx.body.totalCollateral = MAX_COLLATERAL + 1n;
    })));
    // No collateral return: the whole 10 ADA input is at risk.
    refusedBy('COLLATERAL', () => verify(v3Tx((tx) => { delete tx.body.collateralReturn; delete tx.body.totalCollateral; })));
    expect(verify(v3Tx((tx) => {
      tx.body.collateralReturn!.value.coins = FEE_COINS - MAX_COLLATERAL;
      tx.body.totalCollateral = MAX_COLLATERAL;
    })).txId).toBeTruthy();
  });

  it('refuses a collateral return that is not plain ADA to the wallet, and a migrate with no collateral', () => {
    refusedBy('COLLATERAL', () => verify(v3Tx((tx) => { tx.body.collateralReturn!.address = Cardano.PaymentAddress(FOREIGN); })));
    refusedBy('COLLATERAL', () => verify(v3Tx((tx) => { tx.body.collateralReturn!.value.assets = assets(OTHER_NFT); })));
    refusedBy('COLLATERAL', () => verify(v3Tx((tx) => {
      delete tx.body.collaterals;
      delete tx.body.collateralReturn;
      delete tx.body.totalCollateral;
    })));
  });
});
