// The wallet's check of the list, reprice and cancel transactions Nexus built for the Gero NFT
// market (spec 5.7). The contract cannot check a listing when it is created, so a bad datum loses
// the seller's NFT at the first sale: each kind has one passing transaction here, and every rule
// has an altered copy that must be refused with that rule's code.
//
// Datums are built by hand (indefinite-length constructors, as Nexus writes them); the first test
// pins that encoder to Nexus's two-royalty fixture so the rest are not tested against a codec of
// this file's own invention.
import { describe, expect, it } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Ed25519KeyHashHex, Hash28ByteBase16, Hash32ByteBase16 } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { inlineDatumFromCbor } from '@/shared/utils/utxoCbor';
import {
  MAX_LISTING_DEPOSIT,
  MAX_ROYALTIES,
  MIN_LIST_PRICE,
  MIN_SELLER_SHARE,
  NFT_MARKET_DEPLOYMENTS_PREPROD,
  NFT_MARKET_MAX_COLLATERAL_LOVELACE,
  NFT_MARKET_MAX_FEE_LOVELACE,
  NFT_MARKET_MAX_VALIDITY_SLOTS,
  type NftMarketDeployment,
} from '@/utils/nftMarketDeployments';
import { decodeListingDatum, sellerShare, type ListingDatum, type Payee } from './listingDatum';
import type { OwnListing } from './ownListings';
import {
  MarketVerifyError,
  checkEnvelope,
  checkNewListing,
  checkValidityWindow,
  cip68Label,
  newestDeployment,
  verifyCancel,
  verifyList,
  verifyReprice,
  type ListIntent,
  type MarketVerifyContext,
  type MarketVerifyRule,
  type RepriceIntent,
} from './verifyListing';

const TESTNET = Cardano.NetworkId.Testnet;
const MAINNET = Cardano.NetworkId.Mainnet;
const ADA = 1_000_000n;

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

const OWNER = '1864a6eb4242da06750913784d9afb549dc3022d01bbd316530f390c';
const OWNER_B = 'b551db0a6c4f3e1d2a90b7c85e4f13d6a7b8c9d0e1f2a3b4c5d6e7f8';
const STAKE = '5ce6d8a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6071829';
const OTHER_STAKE = '99'.repeat(28);
const STRANGER = '77'.repeat(28);
// A second stake key among the wallet's own addresses: the account's stake key is still STAKE.
const SECOND_STAKE = '55'.repeat(28);
const ALT_OWNER = '66'.repeat(28);

function baseAddress(networkId: Cardano.NetworkId, payment: string, stake: string, paymentIsScript = false): string {
  return Cardano.BaseAddress.fromCredentials(
    networkId,
    { hash: Hash28ByteBase16(payment), type: paymentIsScript ? Cardano.CredentialType.ScriptHash : Cardano.CredentialType.KeyHash },
    { hash: Hash28ByteBase16(stake), type: Cardano.CredentialType.KeyHash },
  ).toAddress().toBech32();
}

const RECEIVE = baseAddress(TESTNET, OWNER, STAKE);
const CHANGE = baseAddress(TESTNET, OWNER_B, STAKE);
const FOREIGN = baseAddress(TESTNET, STRANGER, OTHER_STAKE);
const ALT_ADDRESS = baseAddress(TESTNET, ALT_OWNER, SECOND_STAKE);
const MAINNET_RECEIVE = baseAddress(MAINNET, OWNER, STAKE);
const ROYALTY_ADDRESS = baseAddress(TESTNET, '41'.repeat(28), '42'.repeat(28));
const ROYALTY_ADDRESS_2 = baseAddress(TESTNET, '43'.repeat(28), '44'.repeat(28));

// Two deployments: v2 is the newest (new listings go there), v1 is older and still has listings.
const V1: NftMarketDeployment = NFT_MARKET_DEPLOYMENTS_PREPROD[0];
const V2: NftMarketDeployment = {
  ...V1,
  version: 2,
  scriptHash: 'c2'.repeat(28),
  referenceScript: `${'d2'.repeat(32)}#0`,
};

const listingAddressAt = (deployment: NftMarketDeployment, stake = STAKE) => baseAddress(TESTNET, deployment.scriptHash, stake, true);
const LISTING_V1 = listingAddressAt(V1);
const LISTING_V2 = listingAddressAt(V2);

const POLICY = 'aa'.repeat(28);
const NAME = Buffer.from('Gero NFT').toString('hex');
const UNIT_222 = `${POLICY}000de140${NAME}`;
const UNIT_100 = `${POLICY}000643b0${NAME}`;
const UNIT_PLAIN = `${POLICY}${Buffer.from('Plain NFT').toString('hex')}`;
const OTHER_UNIT = `${'bb'.repeat(28)}${Buffer.from('Other').toString('hex')}`;

const NFT_TX = 'a1'.repeat(32);
const FEE_TX = '7d'.repeat(32);
const LISTING_TX = 'b1'.repeat(32);
const OTHER_LISTING_TX = 'b2'.repeat(32);
const SPONSORED_TX = 'aa'.repeat(32);
const LISTING_REF = `${LISTING_TX}#0`;
const OTHER_LISTING_REF = `${OTHER_LISTING_TX}#0`;
const SPONSORED_REF = `${SPONSORED_TX}#2`;

const txIn = (txId: string, index: number): Cardano.TxIn => ({ txId: Cardano.TransactionId(txId), index });
const refIn = (ref: string) => txIn(ref.split('#')[0], Number(ref.split('#')[1]));
const NFT_IN = txIn(NFT_TX, 0);
const FEE_IN = txIn(FEE_TX, 0);
const LISTING_IN = txIn(LISTING_TX, 0);

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
const NFT_UTXO = utxo(NFT_TX, 0, RECEIVE, 2_000_000n, { [UNIT_222]: 1n });
const FEE_UTXO = utxo(FEE_TX, 0, RECEIVE, FEE_COINS);

const assets = (unit: string, quantity = 1n) => new Map([[Cardano.AssetId(unit), quantity]]) as Cardano.TokenMap;
const plutusData = (cbor: string) => Serialization.PlutusData.fromCbor(HexBlob(cbor)).toCore();
const inline = (cbor: string) => inlineDatumFromCbor(HexBlob(cbor));

// ---------------------------------------------------------------------------------------------
// Listings and intents
// ---------------------------------------------------------------------------------------------

const ROYALTIES: Payee[] = [{ address: ROYALTY_ADDRESS, lovelace: 5n * ADA }];
const PRICE = 100n * ADA;
const DEPOSIT = 2n * ADA;

const DATUM: ListingDatum = { owner: OWNER, sellerAddress: RECEIVE, price: PRICE, royalties: ROYALTIES, buyer: null };

const LIST_INTENT: ListIntent = {
  unit: UNIT_222,
  price: PRICE,
  royalties: ROYALTIES,
  ownerPkh: OWNER,
  sellerAddress: RECEIVE,
  stakeCredential: STAKE,
};

/** The wallet's own listing at v1 (an older deployment), as the store holds it. */
const OWN_LISTING: OwnListing = {
  ref: LISTING_REF,
  unit: UNIT_222,
  datum: DATUM,
  depositLovelace: DEPOSIT.toString(),
  deploymentVersion: 1,
};
const OTHER_OWN_LISTING: OwnListing = { ...OWN_LISTING, ref: OTHER_LISTING_REF, unit: UNIT_PLAIN };

function context(overrides: Partial<MarketVerifyContext> = {}): MarketVerifyContext {
  return {
    networkId: TESTNET,
    deployments: [V2, V1],
    ownUtxos: [NFT_UTXO, FEE_UTXO],
    ownAddresses: new Set([RECEIVE, CHANGE]),
    ownKeyHashes: new Set([OWNER, OWNER_B, STAKE]),
    ownListings: new Map([[LISTING_REF, OWN_LISTING], [OTHER_LISTING_REF, OTHER_OWN_LISTING]]),
    stakeKeyHash: STAKE,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------------------------

function build(tx: Cardano.Tx, edit: (tx: Cardano.Tx) => void): { cbor: string; id: string } {
  edit(tx);
  const serialized = Serialization.Transaction.fromCore(tx);
  return { cbor: serialized.toCbor(), id: serialized.getId() };
}

const listingOutput = (address: string, datum: string | undefined, unit = UNIT_222, coins = DEPOSIT): Cardano.TxOut => ({
  address: Cardano.PaymentAddress(address),
  value: { coins, assets: assets(unit) },
  ...(datum ? { datum: inline(datum) } : {}),
});

/** A valid list: the NFT input and a fee input; the listing at the newest deployment, then change. */
function validList(): Cardano.Tx {
  return {
    id: Cardano.TransactionId('00'.repeat(32)),
    body: {
      inputs: [NFT_IN, FEE_IN],
      outputs: [
        listingOutput(LISTING_V2, listingDatumHex(DATUM)),
        { address: Cardano.PaymentAddress(CHANGE), value: { coins: 9_800_000n } },
      ],
      fee: 200_000n,
      validityInterval: { invalidBefore: Cardano.Slot(1000), invalidHereafter: Cardano.Slot(1000 + 600) },
    },
    witness: { signatures: new Map() },
    isValid: true,
  };
}
const listTx = (edit: (tx: Cardano.Tx) => void = () => undefined) => build(validList(), edit);

const redeemer = (purpose: Cardano.RedeemerPurpose, index: number, cbor: string): Cardano.Redeemer => ({
  purpose,
  index,
  data: plutusData(cbor),
  executionUnits: { memory: 600_000, steps: 250_000_000 },
});
const spend = (index: number, cbor: string) => redeemer(Cardano.RedeemerPurpose.spend, index, cbor);

// Body order [LISTING, FEE]; the ledger sorts by id, so FEE (7d) is 0 and LISTING (b1) is 1.
const LISTING_SORTED = 1;

/** The valid cancel: spend the v1 listing with Cancel, the NFT and the deposit back to RECEIVE. */
const WINDOW = { invalidBefore: Cardano.Slot(1000), invalidHereafter: Cardano.Slot(1000 + 1920) };

function validCancel(): Cardano.Tx {
  return {
    id: Cardano.TransactionId('00'.repeat(32)),
    body: {
      inputs: [LISTING_IN, FEE_IN],
      outputs: [
        { address: Cardano.PaymentAddress(RECEIVE), value: { coins: DEPOSIT, assets: assets(UNIT_222) } },
        { address: Cardano.PaymentAddress(CHANGE), value: { coins: 9_600_000n } },
      ],
      fee: 400_000n,
      validityInterval: WINDOW,
      collaterals: [FEE_IN],
      collateralReturn: { address: Cardano.PaymentAddress(CHANGE), value: { coins: 8_000_000n } },
      totalCollateral: 2_000_000n,
      referenceInputs: [refIn(V1.referenceScript)],
      requiredExtraSignatures: [Ed25519KeyHashHex(OWNER)],
      scriptIntegrityHash: Hash32ByteBase16('ab'.repeat(32)),
    },
    witness: { signatures: new Map(), redeemers: [spend(LISTING_SORTED, 'd87a80')] },
    isValid: true,
  };
}
const cancelTx = (edit: (tx: Cardano.Tx) => void = () => undefined) => build(validCancel(), edit);

/** The royalties a new listing at 80 ADA carries for the collection's 5% (the old listing's were 5 ADA at 100 ADA). */
const REPRICED_ROYALTIES: Payee[] = [{ address: ROYALTY_ADDRESS, lovelace: 4n * ADA }];
const REPRICED: ListingDatum = { ...DATUM, price: 80n * ADA, royalties: REPRICED_ROYALTIES };

/** The valid reprice: the cancel's inputs, and the same listing again at the same address, new price. */
function validReprice(): Cardano.Tx {
  const tx = validCancel();
  tx.body.outputs = [
    listingOutput(LISTING_V1, listingDatumHex(REPRICED)),
    { address: Cardano.PaymentAddress(CHANGE), value: { coins: 9_600_000n } },
  ];
  return tx;
}
const repriceTx = (edit: (tx: Cardano.Tx) => void = () => undefined) => build(validReprice(), edit);

const CANCEL_INTENT = { ref: LISTING_REF, returnAddress: RECEIVE };
const REPRICE_INTENT: RepriceIntent = { ref: LISTING_REF, price: 80n * ADA, royalties: REPRICED_ROYALTIES };

type Built = { cbor: string; id: string };
const verifyL = (tx: Built, intent: ListIntent = LIST_INTENT, ctx = context()) => verifyList(tx.cbor, tx.id, intent, ctx);
const verifyC = (tx: Built, intent = CANCEL_INTENT, ctx = context()) => verifyCancel(tx.cbor, tx.id, intent, ctx);
const verifyR = (tx: Built, intent = REPRICE_INTENT, ctx = context()) => verifyReprice(tx.cbor, tx.id, intent, ctx);

function refusedBy(rule: MarketVerifyRule, run: () => unknown) {
  try {
    run();
  } catch (e) {
    expect(e).toBeInstanceOf(MarketVerifyError);
    expect((e as MarketVerifyError).rule).toBe(rule);
    return;
  }
  throw new Error(`expected a ${rule} refusal, but the transaction was accepted`);
}

const withDatum = (patch: Partial<ListingDatum>): ListingDatum => ({ ...DATUM, ...patch });
const listWithDatum = (cbor: string) => listTx((tx) => { tx.body.outputs[0].datum = inline(cbor); });
const repriceWithDatum = (cbor: string) => repriceTx((tx) => { tx.body.outputs[0].datum = inline(cbor); });

// ---------------------------------------------------------------------------------------------

describe('the test datum encoder', () => {
  it("writes Nexus's two-royalty fixture byte for byte", () => {
    const fixture =
      'd8799f581c0102030405060708090a0b0c0d0e0f101112131415161718191a1b1cd8799fd8799f581c0102030405060708090a0b0c0d0e0f101112131415161718191a1b1cffd8799fd8799fd8799f581c2122232425262728292a2b2c2d2e2f303132333435363738393a3b3cffffffff1a05f5e1009fd8799fd8799fd8799f581c4142434445464748494a4b4c4d4e4f505152535455565758595a5b5cffd87a80ff1a004c4b40ffd8799fd8799fd87a9f581c6162636465666768696a6b6c6d6e6f707172737475767778797a7b7cffd8799fd8799fd8799f581c2122232425262728292a2b2c2d2e2f303132333435363738393a3b3cffffffff1a001e8480ffffd87a80ff';
    expect(listingDatumHex(decodeListingDatum(fixture, 0))).toBe(fixture);
  });
});

describe('verifyList: the valid list', () => {
  it('accepts a list and summarises it', () => {
    const tx = listTx();
    expect(verifyL(tx)).toEqual({
      txId: tx.id,
      unit: UNIT_222,
      listingAddress: LISTING_V2,
      listingOutputIndex: 0,
      deploymentVersion: 2,
      priceLovelace: '100000000',
      marketFeeLovelace: '1500000',
      royalties: [{ address: ROYALTY_ADDRESS, lovelace: '5000000' }],
      royaltiesLovelace: '5000000',
      sellerReceivesLovelace: '93500000',
      depositLovelace: '2000000',
      networkFeeLovelace: '200000',
    });
  });

  it('accepts a plain (non CIP-68) NFT with no royalties', () => {
    const plain = { ...LIST_INTENT, unit: UNIT_PLAIN, royalties: [] };
    const tx = listTx((t) => {
      t.body.outputs[0] = listingOutput(LISTING_V2, listingDatumHex(withDatum({ royalties: [] })), UNIT_PLAIN);
    });
    expect(verifyL(tx, plain).unit).toBe(UNIT_PLAIN);
  });

  it('accepts a datum written with definite-length lists (the same Plutus data)', () => {
    // Royalties as a definite list: 81 <payee>.
    const hexWithDefiniteRoyalties = constr(0, [
      bstr(DATUM.owner), addressData(DATUM.sellerAddress), uint(DATUM.price), `81${payeeData(ROYALTIES[0])}`, NONE,
    ]);
    expect(verifyL(listWithDatum(hexWithDefiniteRoyalties)).priceLovelace).toBe('100000000');
  });

  it('refuses a tx whose id differs from the one reported, and bytes that are no transaction', () => {
    const tx = listTx();
    refusedBy('TX_ID', () => verifyList(tx.cbor, 'ab'.repeat(32), LIST_INTENT, context()));
    refusedBy('TX_ID', () => verifyList('84a0', tx.id, LIST_INTENT, context()));
  });
});

describe('verifyList: network', () => {
  it('refuses a body network id or an output address of another network', () => {
    expect(verifyL(listTx((tx) => { tx.body.networkId = TESTNET; })).txId).toBeTruthy();
    refusedBy('NETWORK', () => verifyL(listTx((tx) => { tx.body.networkId = MAINNET; })));
    refusedBy('NETWORK', () => verifyL(listTx((tx) => { tx.body.outputs[1].address = Cardano.PaymentAddress(MAINNET_RECEIVE); })));
  });

  it('refuses a network with no deployment, and a context of another network', () => {
    refusedBy('NETWORK', () => verifyL(listTx(), LIST_INTENT, context({ deployments: [] })));
    refusedBy('NETWORK', () => verifyL(listTx(), LIST_INTENT, context({ networkId: MAINNET })));
  });
});

describe('verifyList: inputs', () => {
  it('refuses an input that is not the wallet\'s, and one that is an own listing', () => {
    refusedBy('INPUTS', () => verifyL(listTx((tx) => { tx.body.inputs.push(txIn('cd'.repeat(32), 0)); })));
    refusedBy('INPUTS', () => verifyL(listTx(), LIST_INTENT, context({ ownUtxos: [FEE_UTXO] })));
    refusedBy('INPUTS', () => verifyL(listTx((tx) => { tx.body.inputs.push(LISTING_IN); }), LIST_INTENT, context({
      ownUtxos: [NFT_UTXO, FEE_UTXO, utxo(LISTING_TX, 0, LISTING_V1, DEPOSIT, { [UNIT_222]: 1n })],
    })));
  });

  it('refuses a reference input and the lent pool collateral as an input', () => {
    refusedBy('INPUTS', () => verifyL(listTx((tx) => { tx.body.referenceInputs = [refIn(V2.referenceScript)]; })));
    refusedBy('INPUTS', () => verifyL(listTx((tx) => { tx.body.inputs.push(refIn(SPONSORED_REF)); }), LIST_INTENT, context({
      sponsoredCollateralRef: SPONSORED_REF,
      ownUtxos: [NFT_UTXO, FEE_UTXO, utxo(SPONSORED_TX, 2, RECEIVE, 5n * ADA)],
    })));
  });
});

describe('verifyList: the listing output', () => {
  it('refuses a list with no listing output, or with two', () => {
    refusedBy('LISTING', () => verifyL(listTx((tx) => {
      tx.body.outputs[0] = { address: Cardano.PaymentAddress(RECEIVE), value: { coins: DEPOSIT, assets: assets(UNIT_222) } };
    })));
    refusedBy('LISTING', () => verifyL(listTx((tx) => {
      tx.body.outputs.push(listingOutput(LISTING_V2, listingDatumHex(DATUM), OTHER_UNIT));
    })));
  });

  it('refuses a listing at an older deployment (a new list goes to the newest)', () => {
    refusedBy('LISTING', () => verifyL(listTx((tx) => { tx.body.outputs[0].address = Cardano.PaymentAddress(LISTING_V1); })));
  });

  it('refuses a listing at a script that is no deployment (it is not the wallet\'s to pay)', () => {
    refusedBy('OUTPUTS', () => verifyL(listTx((tx) => {
      tx.body.outputs[0].address = Cardano.PaymentAddress(baseAddress(TESTNET, 'e5'.repeat(28), STAKE, true));
    })));
  });

  it('refuses a stake part that is not the wallet\'s stake key', () => {
    // Another key's stake part, a payment key of the wallet in the stake slot, no stake part, a script.
    refusedBy('LISTING', () => verifyL(listTx((tx) => { tx.body.outputs[0].address = Cardano.PaymentAddress(listingAddressAt(V2, OTHER_STAKE)); })));
    refusedBy('LISTING', () => verifyL(listTx((tx) => { tx.body.outputs[0].address = Cardano.PaymentAddress(listingAddressAt(V2, OWNER)); })));
    refusedBy('LISTING', () => verifyL(listTx((tx) => {
      tx.body.outputs[0].address = Cardano.PaymentAddress(
        Cardano.EnterpriseAddress.fromCredentials(TESTNET, { hash: Hash28ByteBase16(V2.scriptHash), type: Cardano.CredentialType.ScriptHash })
          .toAddress().toBech32(),
      );
    })));
    refusedBy('LISTING', () => verifyL(listTx((tx) => {
      tx.body.outputs[0].address = Cardano.PaymentAddress(
        Cardano.BaseAddress.fromCredentials(
          TESTNET,
          { hash: Hash28ByteBase16(V2.scriptHash), type: Cardano.CredentialType.ScriptHash },
          { hash: Hash28ByteBase16(STAKE), type: Cardano.CredentialType.ScriptHash },
        ).toAddress().toBech32(),
      );
    })));
  });

  it('refuses an intent whose stake credential is not the wallet\'s', () => {
    const tx = listTx((t) => { t.body.outputs[0].address = Cardano.PaymentAddress(listingAddressAt(V2, OTHER_STAKE)); });
    refusedBy('LISTING', () => verifyL(tx, { ...LIST_INTENT, stakeCredential: OTHER_STAKE }));
  });

  it("refuses a stake key that is another key of the wallet's own addresses: it must be the account's", () => {
    const altContext = () => context({
      ownAddresses: new Set([RECEIVE, CHANGE, ALT_ADDRESS]),
      ownKeyHashes: new Set([OWNER, OWNER_B, STAKE, ALT_OWNER, SECOND_STAKE]),
    });
    const tx = listTx((t) => { t.body.outputs[0].address = Cardano.PaymentAddress(listingAddressAt(V2, SECOND_STAKE)); });
    // The transaction and the intent agree on a stake key the wallet owns, but it is not the account's.
    refusedBy('LISTING', () => verifyL(tx, { ...LIST_INTENT, stakeCredential: SECOND_STAKE }, altContext()));
    // The same wallet context lists fine at the account's own stake key.
    expect(verifyL(listTx(), LIST_INTENT, altContext()).deploymentVersion).toBe(2);
  });

  it("refuses an intent that names a stake key other than the account's, even when the transaction is right", () => {
    refusedBy('LISTING', () => verifyL(listTx(), { ...LIST_INTENT, stakeCredential: SECOND_STAKE }));
    refusedBy('LISTING', () => verifyL(listTx(), { ...LIST_INTENT, stakeCredential: OTHER_STAKE }));
  });

  it("refuses a context with no usable account stake key, or one that is not a key of the wallet", () => {
    refusedBy('LISTING', () => verifyL(listTx(), LIST_INTENT, context({ stakeKeyHash: '' })));
    refusedBy('LISTING', () => verifyL(listTx(), LIST_INTENT, context({ stakeKeyHash: 'not hex' })));
    refusedBy('LISTING', () => verifyL(listTx(), LIST_INTENT, context({ stakeKeyHash: 'not hex', ownKeyHashes: new Set([OWNER, OWNER_B, 'not hex']) })));
    refusedBy('LISTING', () => verifyL(listTx((t) => { t.body.outputs[0].address = Cardano.PaymentAddress(listingAddressAt(V2, OTHER_STAKE)); }),
      { ...LIST_INTENT, stakeCredential: OTHER_STAKE }, context({ stakeKeyHash: OTHER_STAKE })));
  });

  it('refuses a deposit above the cap, or none', () => {
    refusedBy('LISTING', () => verifyL(listTx((tx) => { tx.body.outputs[0].value.coins = MAX_LISTING_DEPOSIT + 1n; })));
    expect(verifyL(listTx((tx) => { tx.body.outputs[0].value.coins = MAX_LISTING_DEPOSIT; })).depositLovelace).toBe('5000000');
    refusedBy('LISTING', () => verifyL(listTx((tx) => { tx.body.outputs[0].value.coins = 0n; })));
  });
});

describe('verifyList: the NFT', () => {
  it('refuses an extra token in the listing value', () => {
    refusedBy('NFT', () => verifyL(listTx((tx) => {
      tx.body.outputs[0].value.assets = new Map([[Cardano.AssetId(UNIT_222), 1n], [Cardano.AssetId(OTHER_UNIT), 1n]]) as Cardano.TokenMap;
    })));
  });

  it('refuses a listing value that is not exactly the intent unit once', () => {
    refusedBy('NFT', () => verifyL(listTx((tx) => { tx.body.outputs[0].value.assets = assets(OTHER_UNIT); })));
    refusedBy('NFT', () => verifyL(listTx((tx) => { tx.body.outputs[0].value.assets = assets(UNIT_222, 2n); })));
    refusedBy('NFT', () => verifyL(listTx((tx) => { delete tx.body.outputs[0].value.assets; })));
  });

  it('refuses the CIP-68 (100) reference token, even when the transaction matches the intent', () => {
    const tx = listTx((t) => { t.body.outputs[0] = listingOutput(LISTING_V2, listingDatumHex(DATUM), UNIT_100); });
    refusedBy('NFT', () => verifyL(tx, { ...LIST_INTENT, unit: UNIT_100 }));
  });

  it.each<[string, string]>([
    ['(333) fungible', '0014df10'],
    ['(444) rich fungible', '001bc280'],
    ['(500) royalty', '001f4d70'],
    ['(1), a label this wallet has no name for', '00001070'],
  ])('refuses a CIP-68 token with label %s, and accepts the (222) user token and look-alikes', (_name, prefix) => {
    const unit = `${POLICY}${prefix}${NAME}`;
    const tx = listTx((t) => { t.body.outputs[0] = listingOutput(LISTING_V2, listingDatumHex(DATUM), unit); });
    refusedBy('NFT', () => verifyL(tx, { ...LIST_INTENT, unit }));
  });

  it('recognises CIP-67 labels by their checksum, so a name that only looks like one is a plain NFT', () => {
    expect([100, 222, 333, 444, 500].map((label) => cip68Label(
      { 100: '000643b0', 222: '000de140', 333: '0014df10', 444: '001bc280', 500: '001f4d70' }[label]! + NAME,
    ))).toEqual([100, 222, 333, 444, 500]);
    // Wrong checksum (right padding), wrong padding nibbles, too short, not hex.
    expect(cip68Label('000643c0')).toBeNull();
    expect(cip68Label('000643b1')).toBeNull();
    expect(cip68Label('100643b0')).toBeNull();
    expect(cip68Label('000643b8')).toBeNull();
    expect(cip68Label('0006')).toBeNull();
    expect(cip68Label(NAME)).toBeNull();
    const lookAlike = `${POLICY}000643c0${NAME}`;
    const tx = listTx((t) => { t.body.outputs[0] = listingOutput(LISTING_V2, listingDatumHex(DATUM), lookAlike); });
    expect(verifyL(tx, { ...LIST_INTENT, unit: lookAlike }).unit).toBe(lookAlike);
  });

  it('refuses an intent unit that is no policy id and asset name', () => {
    refusedBy('NFT', () => verifyL(listTx(), { ...LIST_INTENT, unit: 'lovelace' }));
    refusedBy('NFT', () => verifyL(listTx(), { ...LIST_INTENT, unit: POLICY.slice(2) }));
    refusedBy('NFT', () => verifyL(listTx(), { ...LIST_INTENT, unit: `${UNIT_222}zz` }));
  });
});

describe('verifyList: the datum', () => {
  it('refuses a datum hash, no datum, and bytes that are no listing', () => {
    refusedBy('DATUM', () => verifyL(listTx((tx) => {
      delete tx.body.outputs[0].datum;
      tx.body.outputs[0].datumHash = Hash32ByteBase16('00'.repeat(32));
    })));
    refusedBy('DATUM', () => verifyL(listTx((tx) => { delete tx.body.outputs[0].datum; })));
    refusedBy('DATUM', () => verifyL(listWithDatum('d87980')));
    refusedBy('DATUM', () => verifyL(listWithDatum(`${listingDatumHex(DATUM)}00`)));
  });

  it('refuses a seller_address that is not the intent\'s, or not an own address', () => {
    refusedBy('DATUM', () => verifyL(listWithDatum(listingDatumHex(withDatum({ sellerAddress: FOREIGN })))));
    // The datum matches an intent that names a foreign seller, but the wallet does not own it.
    refusedBy('DATUM', () => verifyL(listWithDatum(listingDatumHex(withDatum({ sellerAddress: FOREIGN }))), { ...LIST_INTENT, sellerAddress: FOREIGN }));
    // An own address the intent did not name.
    refusedBy('DATUM', () => verifyL(listWithDatum(listingDatumHex(withDatum({ sellerAddress: CHANGE })))));
  });

  it('refuses an owner that is not the intent\'s, not a key of the wallet, or the stake key', () => {
    refusedBy('DATUM', () => verifyL(listWithDatum(listingDatumHex(withDatum({ owner: OWNER_B })))));
    refusedBy('DATUM', () => verifyL(listWithDatum(listingDatumHex(withDatum({ owner: STRANGER }))), { ...LIST_INTENT, ownerPkh: STRANGER }));
    refusedBy('DATUM', () => verifyL(listWithDatum(listingDatumHex(withDatum({ owner: STAKE }))), { ...LIST_INTENT, ownerPkh: STAKE }));
  });

  it('refuses a price other than the intent\'s, or under the minimum', () => {
    refusedBy('DATUM', () => verifyL(listWithDatum(listingDatumHex(withDatum({ price: PRICE - 1n })))));
    const low = withDatum({ price: MIN_LIST_PRICE - 1n, royalties: [] });
    refusedBy('DATUM', () => verifyL(listWithDatum(listingDatumHex(low)), { ...LIST_INTENT, price: low.price, royalties: [] }));
    const atMin = withDatum({ price: MIN_LIST_PRICE, royalties: [] });
    expect(verifyL(listWithDatum(listingDatumHex(atMin)), { ...LIST_INTENT, price: MIN_LIST_PRICE, royalties: [] }).priceLovelace).toBe('5000000');
  });

  it('refuses royalties that differ from the intent\'s in any way', () => {
    const other = (royalties: Payee[]) => listWithDatum(listingDatumHex(withDatum({ royalties })));
    refusedBy('DATUM', () => verifyL(other([])));
    refusedBy('DATUM', () => verifyL(other([{ address: ROYALTY_ADDRESS, lovelace: 5n * ADA + 1n }])));
    refusedBy('DATUM', () => verifyL(other([{ address: FOREIGN, lovelace: 5n * ADA }])));
    refusedBy('DATUM', () => verifyL(other([...ROYALTIES, { address: ROYALTY_ADDRESS_2, lovelace: 2n * ADA }])));
    // Order matters: the contract pays them in datum order.
    const two: Payee[] = [{ address: ROYALTY_ADDRESS, lovelace: 5n * ADA }, { address: ROYALTY_ADDRESS_2, lovelace: 2n * ADA }];
    const swapped = [two[1], two[0]];
    expect(verifyL(other(two), { ...LIST_INTENT, royalties: two }).royalties).toHaveLength(2);
    refusedBy('DATUM', () => verifyL(other(swapped), { ...LIST_INTENT, royalties: two }));
  });

  it('refuses more than three royalties and a royalty of zero', () => {
    const four: Payee[] = [1n, 2n, 3n, 4n].map((n) => ({ address: baseAddress(TESTNET, `5${n}`.repeat(28), '42'.repeat(28)), lovelace: 2n * ADA }));
    refusedBy('DATUM', () => verifyL(listWithDatum(listingDatumHex(withDatum({ royalties: four }))), { ...LIST_INTENT, royalties: four }));
    expect(verifyL(listWithDatum(listingDatumHex(withDatum({ royalties: four.slice(0, 3) }))), { ...LIST_INTENT, royalties: four.slice(0, 3) }).royalties).toHaveLength(3);
    const zero: Payee[] = [{ address: ROYALTY_ADDRESS, lovelace: 0n }];
    refusedBy('DATUM', () => verifyL(listWithDatum(listingDatumHex(withDatum({ royalties: zero }))), { ...LIST_INTENT, royalties: zero }));
  });

  it('refuses a private listing (phase 1 lists publicly only)', () => {
    refusedBy('DATUM', () => verifyL(listWithDatum(listingDatumHex(withDatum({ buyer: STRANGER })))));
  });

  it('refuses a seller share under the minimum, and accepts exactly the minimum', () => {
    // fee 1.5 ADA (the floor): price 8 ADA with a 5 ADA royalty leaves 1.5 ADA exactly.
    const exact = withDatum({ price: 8n * ADA });
    expect(sellerShare(exact, V2)).toBe(MIN_SELLER_SHARE);
    expect(verifyL(listWithDatum(listingDatumHex(exact)), { ...LIST_INTENT, price: exact.price }).sellerReceivesLovelace).toBe('1500000');
    const short = withDatum({ price: 8n * ADA - 1n });
    refusedBy('DATUM', () => verifyL(listWithDatum(listingDatumHex(short)), { ...LIST_INTENT, price: short.price }));
  });
});

describe('verifyList: scripts, collateral and signers', () => {
  it('refuses a redeemer or script data', () => {
    refusedBy('REDEEMERS', () => verifyL(listTx((tx) => { tx.witness.redeemers = [spend(0, 'd87a80')]; })));
    refusedBy('REDEEMERS', () => verifyL(listTx((tx) => { tx.body.scriptIntegrityHash = Hash32ByteBase16('ab'.repeat(32)); })));
  });

  it('refuses any collateral', () => {
    refusedBy('COLLATERAL', () => verifyL(listTx((tx) => { tx.body.collaterals = [FEE_IN]; })));
    refusedBy('COLLATERAL', () => verifyL(listTx((tx) => {
      tx.body.collateralReturn = { address: Cardano.PaymentAddress(CHANGE), value: { coins: 1_000_000n } };
    })));
    refusedBy('COLLATERAL', () => verifyL(listTx((tx) => { tx.body.totalCollateral = 1_000_000n; })));
  });

  it('refuses any required signer: a list requires none, not even a key of the wallet', () => {
    refusedBy('SIGNERS', () => verifyL(listTx((tx) => { tx.body.requiredExtraSignatures = [Ed25519KeyHashHex(STRANGER)]; })));
    refusedBy('SIGNERS', () => verifyL(listTx((tx) => { tx.body.requiredExtraSignatures = [Ed25519KeyHashHex(OWNER)]; })));
    refusedBy('SIGNERS', () => verifyL(listTx((tx) => { tx.body.requiredExtraSignatures = [Ed25519KeyHashHex(STAKE)]; })));
  });
});

describe('verifyList: every other output', () => {
  it('refuses an output to a foreign address, however small', () => {
    refusedBy('OUTPUTS', () => verifyL(listTx((tx) => {
      tx.body.outputs.push({ address: Cardano.PaymentAddress(FOREIGN), value: { coins: 1_000_000n } });
    })));
  });

  it('refuses a key address among the wallet\'s addresses whose key is not the wallet\'s, and a script', () => {
    const scriptAddress = baseAddress(TESTNET, 'e5'.repeat(28), STAKE, true);
    refusedBy('OUTPUTS', () => verifyL(listTx((tx) => {
      tx.body.outputs.push({ address: Cardano.PaymentAddress(FOREIGN), value: { coins: 1_000_000n } });
    }), LIST_INTENT, context({ ownAddresses: new Set([RECEIVE, CHANGE, FOREIGN]) })));
    refusedBy('OUTPUTS', () => verifyL(listTx((tx) => {
      tx.body.outputs.push({ address: Cardano.PaymentAddress(scriptAddress), value: { coins: 1_000_000n } });
    }), LIST_INTENT, context({ ownAddresses: new Set([RECEIVE, CHANGE, scriptAddress]) })));
  });

  it('refuses a datum, a datum hash or a reference script on a change output', () => {
    refusedBy('OUTPUTS', () => verifyL(listTx((tx) => { tx.body.outputs[1].datum = plutusData('d87980'); })));
    refusedBy('OUTPUTS', () => verifyL(listTx((tx) => { tx.body.outputs[1].datumHash = Hash32ByteBase16('00'.repeat(32)); })));
    refusedBy('OUTPUTS', () => verifyL(listTx((tx) => {
      tx.body.outputs[1].scriptReference = {
        __type: Cardano.ScriptType.Plutus, version: Cardano.PlutusLanguageVersion.V2, bytes: HexBlob('4e4d01000033222220051200120011'),
      };
    })));
  });

  it('refuses a listing output that carries a reference script', () => {
    refusedBy('LISTING', () => verifyL(listTx((tx) => {
      tx.body.outputs[0].scriptReference = {
        __type: Cardano.ScriptType.Plutus, version: Cardano.PlutusLanguageVersion.V2, bytes: HexBlob('4e4d01000033222220051200120011'),
      };
    })));
  });
});

describe('verifyList: fee, window and the rest of the body', () => {
  it('refuses a fee over 2 ADA and accepts exactly 2 ADA', () => {
    refusedBy('FEE', () => verifyL(listTx((tx) => { tx.body.fee = NFT_MARKET_MAX_FEE_LOVELACE + 1n; })));
    expect(verifyL(listTx((tx) => { tx.body.fee = NFT_MARKET_MAX_FEE_LOVELACE; })).networkFeeLovelace).toBe('2000000');
  });

  it('needs a validity window with both bounds, at most an hour wide', () => {
    const window = (start: number, end: number) => (tx: Cardano.Tx) => {
      tx.body.validityInterval = { invalidBefore: Cardano.Slot(start), invalidHereafter: Cardano.Slot(end) };
    };
    refusedBy('FORBIDDEN_FIELD', () => verifyL(listTx(window(1000, 1000 + NFT_MARKET_MAX_VALIDITY_SLOTS + 1))));
    expect(verifyL(listTx(window(1000, 1000 + NFT_MARKET_MAX_VALIDITY_SLOTS))).txId).toBeTruthy();
    // Nexus's window: [tip - 120, tip + 1800].
    expect(verifyL(listTx(window(5_000_000 - 120, 5_000_000 + 1800))).txId).toBeTruthy();
    refusedBy('FORBIDDEN_FIELD', () => verifyL(listTx(window(1000, 1000))));
    refusedBy('FORBIDDEN_FIELD', () => verifyL(listTx(window(2000, 1000))));
    // No window at all, a start with no end, and an end alone (a far-future time-to-live).
    refusedBy('FORBIDDEN_FIELD', () => verifyL(listTx((tx) => { delete tx.body.validityInterval; })));
    refusedBy('FORBIDDEN_FIELD', () => verifyL(listTx((tx) => { tx.body.validityInterval = { invalidBefore: Cardano.Slot(1000) }; })));
    refusedBy('FORBIDDEN_FIELD', () => verifyL(listTx((tx) => { tx.body.validityInterval = { invalidHereafter: Cardano.Slot(5000) }; })));
    refusedBy('FORBIDDEN_FIELD', () => verifyL(listTx((tx) => { tx.body.validityInterval = { invalidHereafter: Cardano.Slot(4_000_000_000) }; })));
    // A window that starts at slot 0 is a window.
    expect(verifyL(listTx(window(0, 1800))).txId).toBeTruthy();
  });

  it.each<[string, (tx: Cardano.Tx) => void]>([
    ['mint', (tx) => { tx.body.mint = assets(OTHER_UNIT); }],
    ['certificates', (tx) => {
      tx.body.certificates = [{
        __typename: Cardano.CertificateType.StakeRegistration,
        stakeCredential: { hash: Hash28ByteBase16(STAKE), type: Cardano.CredentialType.KeyHash },
      }];
    }],
    ['withdrawals', (tx) => {
      tx.body.withdrawals = [{
        stakeAddress: Cardano.RewardAddress.fromCredentials(TESTNET, { hash: Hash28ByteBase16(STAKE), type: Cardano.CredentialType.KeyHash })
          .toAddress().toBech32() as Cardano.RewardAccount,
        quantity: 0n,
      }];
    }],
    ['donation', (tx) => { tx.body.donation = 1n; }],
    ['auxiliary data', (tx) => { tx.body.auxiliaryDataHash = Hash32ByteBase16('00'.repeat(32)); }],
    ['an invalid flag, which forfeits collateral', (tx) => { tx.isValid = false; }],
  ])('refuses %s', (_name, edit) => {
    refusedBy('FORBIDDEN_FIELD', () => verifyL(listTx(edit)));
  });
});

// ---------------------------------------------------------------------------------------------

describe('verifyCancel: the valid cancel', () => {
  it('accepts the cancel of an older deployment\'s listing and summarises it', () => {
    const tx = cancelTx();
    expect(verifyC(tx)).toEqual({
      txId: tx.id,
      ref: LISTING_REF,
      unit: UNIT_222,
      returnAddress: RECEIVE,
      depositLovelace: '2000000',
      networkFeeLovelace: '400000',
    });
  });

  it('accepts the Cancel redeemer written with an indefinite-length field list', () => {
    expect(verifyC(cancelTx((tx) => { tx.witness.redeemers = [spend(LISTING_SORTED, 'd87a9fff')]; })).txId).toBeTruthy();
  });

  it('refuses a tx whose id differs from the one reported', () => {
    const tx = cancelTx();
    refusedBy('TX_ID', () => verifyCancel(tx.cbor, 'ab'.repeat(32), CANCEL_INTENT, context()));
  });

  it('refuses a ref that is not one of the wallet\'s own listings, or whose deployment is gone', () => {
    refusedBy('INPUTS', () => verifyC(cancelTx(), { ...CANCEL_INTENT, ref: `${'cd'.repeat(32)}#0` }));
    refusedBy('INPUTS', () => verifyC(cancelTx(), CANCEL_INTENT, context({ ownListings: new Map() })));
    refusedBy('LISTING', () => verifyC(cancelTx(), CANCEL_INTENT, context({ deployments: [V2] })));
  });
});

describe('verifyCancel: network and the body', () => {
  it('refuses another network, and an empty deployment list', () => {
    refusedBy('NETWORK', () => verifyC(cancelTx((tx) => { tx.body.networkId = MAINNET; })));
    refusedBy('NETWORK', () => verifyC(cancelTx(), CANCEL_INTENT, context({ deployments: [] })));
    refusedBy('NETWORK', () => verifyC(cancelTx((tx) => { tx.body.outputs[1].address = Cardano.PaymentAddress(MAINNET_RECEIVE); })));
  });

  it.each<[string, (tx: Cardano.Tx) => void]>([
    ['mint', (tx) => { tx.body.mint = assets(OTHER_UNIT); }],
    ['withdrawals', (tx) => {
      tx.body.withdrawals = [{
        stakeAddress: Cardano.RewardAddress.fromCredentials(TESTNET, { hash: Hash28ByteBase16(STAKE), type: Cardano.CredentialType.KeyHash })
          .toAddress().toBech32() as Cardano.RewardAccount,
        quantity: 0n,
      }];
    }],
    ['auxiliary data', (tx) => { tx.body.auxiliaryDataHash = Hash32ByteBase16('00'.repeat(32)); }],
    ['an invalid flag', (tx) => { tx.isValid = false; }],
    ['a validity window over an hour', (tx) => {
      tx.body.validityInterval = { invalidBefore: Cardano.Slot(1), invalidHereafter: Cardano.Slot(2 + NFT_MARKET_MAX_VALIDITY_SLOTS) };
    }],
    ['no validity window', (tx) => { delete tx.body.validityInterval; }],
    ['a far-future time-to-live alone', (tx) => { tx.body.validityInterval = { invalidHereafter: Cardano.Slot(4_000_000_000) }; }],
    ['a validity start alone', (tx) => { tx.body.validityInterval = { invalidBefore: Cardano.Slot(1000) }; }],
  ])('refuses %s', (_name, edit) => {
    refusedBy('FORBIDDEN_FIELD', () => verifyC(cancelTx(edit)));
  });
});

describe('verifyCancel: inputs and reference scripts', () => {
  it('refuses a cancel that does not spend the listing', () => {
    refusedBy('INPUTS', () => verifyC(cancelTx((tx) => { tx.body.inputs = [FEE_IN]; })));
  });

  it('refuses a second listing, a foreign input, and the lent collateral spent as an input', () => {
    refusedBy('INPUTS', () => verifyC(cancelTx((tx) => { tx.body.inputs.push(refIn(OTHER_LISTING_REF)); })));
    // Even were the other listing wrongly among the wallet's spendable UTxOs.
    refusedBy('INPUTS', () => verifyC(cancelTx((tx) => { tx.body.inputs.push(refIn(OTHER_LISTING_REF)); }), CANCEL_INTENT, context({
      ownUtxos: [NFT_UTXO, FEE_UTXO, utxo(OTHER_LISTING_TX, 0, LISTING_V1, DEPOSIT, { [UNIT_PLAIN]: 1n })],
    })));
    refusedBy('INPUTS', () => verifyC(cancelTx((tx) => { tx.body.inputs.push(txIn('cd'.repeat(32), 0)); })));
    refusedBy('INPUTS', () => verifyC(cancelTx(), CANCEL_INTENT, context({ ownUtxos: [] })));
    refusedBy('INPUTS', () => verifyC(cancelTx((tx) => { tx.body.inputs.push(refIn(SPONSORED_REF)); }), CANCEL_INTENT, context({
      sponsoredCollateralRef: SPONSORED_REF,
      ownUtxos: [NFT_UTXO, FEE_UTXO, utxo(SPONSORED_TX, 2, RECEIVE, 5n * ADA)],
    })));
  });

  it('refuses any reference input but the listing\'s own deployment script', () => {
    refusedBy('INPUTS', () => verifyC(cancelTx((tx) => { delete tx.body.referenceInputs; })));
    // The newest deployment's script is not the script of a listing at v1.
    refusedBy('INPUTS', () => verifyC(cancelTx((tx) => { tx.body.referenceInputs = [refIn(V2.referenceScript)]; })));
    refusedBy('INPUTS', () => verifyC(cancelTx((tx) => { tx.body.referenceInputs = [refIn(V1.referenceScript), txIn('cd'.repeat(32), 0)]; })));
    refusedBy('INPUTS', () => verifyC(cancelTx((tx) => { tx.body.referenceInputs = [refIn(V1.referenceScript), refIn(V2.referenceScript)]; })));
  });
});

describe('verifyCancel: redeemers', () => {
  const withRedeemers = (redeemers: Cardano.Redeemer[]) => cancelTx((tx) => { tx.witness.redeemers = redeemers; });

  it('refuses Purchase, any other data, and none', () => {
    refusedBy('REDEEMERS', () => verifyC(withRedeemers([spend(LISTING_SORTED, 'd8799f00ff')])));
    refusedBy('REDEEMERS', () => verifyC(withRedeemers([spend(LISTING_SORTED, 'd87980')])));
    // Cancel carrying a field is not the Cancel the contract's redeemer type has.
    refusedBy('REDEEMERS', () => verifyC(withRedeemers([spend(LISTING_SORTED, 'd87a9f00ff')])));
    refusedBy('REDEEMERS', () => verifyC(withRedeemers([])));
    refusedBy('REDEEMERS', () => verifyC(cancelTx((tx) => { delete tx.witness.redeemers; })));
  });

  it('refuses a redeemer on the fee input, an extra redeemer, or another purpose', () => {
    refusedBy('REDEEMERS', () => verifyC(withRedeemers([spend(0, 'd87a80')])));
    refusedBy('REDEEMERS', () => verifyC(withRedeemers([spend(LISTING_SORTED, 'd87a80'), spend(0, 'd87a80')])));
    refusedBy('REDEEMERS', () => verifyC(withRedeemers([redeemer(Cardano.RedeemerPurpose.mint, LISTING_SORTED, 'd87a80')])));
  });

  it('indexes the redeemer in the ledger\'s sorted input order, not the body\'s', () => {
    // Body order puts the listing first; pointing the redeemer there is wrong.
    refusedBy('REDEEMERS', () => verifyC(withRedeemers([spend(2, 'd87a80')])));
    refusedBy('REDEEMERS', () => verifyC(cancelTx((tx) => { tx.body.inputs = [FEE_IN, LISTING_IN]; tx.witness.redeemers = [spend(0, 'd87a80')]; })));
    expect(verifyC(cancelTx((tx) => { tx.body.inputs = [FEE_IN, LISTING_IN]; })).txId).toBeTruthy();
  });
});

describe('verifyCancel: required signers', () => {
  it('requires exactly the listing\'s owner', () => {
    refusedBy('SIGNERS', () => verifyC(cancelTx((tx) => { delete tx.body.requiredExtraSignatures; })));
    refusedBy('SIGNERS', () => verifyC(cancelTx((tx) => { tx.body.requiredExtraSignatures = [Ed25519KeyHashHex(OWNER_B)]; })));
    refusedBy('SIGNERS', () => verifyC(cancelTx((tx) => {
      tx.body.requiredExtraSignatures = [Ed25519KeyHashHex(OWNER), Ed25519KeyHashHex(OWNER_B)];
    })));
  });

  it('refuses an owner that is not a key of the wallet', () => {
    refusedBy('SIGNERS', () => verifyC(cancelTx(), CANCEL_INTENT, context({ ownKeyHashes: new Set([OWNER_B, STAKE]) })));
  });
});

describe('verifyCancel: where the NFT and the deposit go', () => {
  it('refuses a cancel that sends the NFT to a non-own address', () => {
    refusedBy('OUTPUTS', () => verifyC(cancelTx((tx) => {
      tx.body.outputs[0] = { address: Cardano.PaymentAddress(FOREIGN), value: { coins: DEPOSIT, assets: assets(UNIT_222) } };
    })));
  });

  it('refuses the NFT at an own address that is not the return address, and no NFT at all', () => {
    refusedBy('OUTPUTS', () => verifyC(cancelTx((tx) => {
      tx.body.outputs[0] = { address: Cardano.PaymentAddress(CHANGE), value: { coins: DEPOSIT, assets: assets(UNIT_222) } };
    })));
    refusedBy('OUTPUTS', () => verifyC(cancelTx((tx) => { delete tx.body.outputs[0].value.assets; })));
  });

  it('refuses a return address that is not the wallet\'s', () => {
    refusedBy('OUTPUTS', () => verifyC(cancelTx(), { ...CANCEL_INTENT, returnAddress: FOREIGN }));
  });

  it('refuses any other output that is not the wallet\'s, and any datum or script on one', () => {
    refusedBy('OUTPUTS', () => verifyC(cancelTx((tx) => {
      tx.body.outputs.push({ address: Cardano.PaymentAddress(FOREIGN), value: { coins: 1_000_000n } });
    })));
    refusedBy('OUTPUTS', () => verifyC(cancelTx((tx) => { tx.body.outputs[1].datum = plutusData('d87980'); })));
    refusedBy('OUTPUTS', () => verifyC(cancelTx((tx) => { tx.body.outputs[1].datumHash = Hash32ByteBase16('00'.repeat(32)); })));
  });

  it('refuses an output to a script among the wallet\'s addresses, and to a key address that is not the wallet\'s', () => {
    const script = listingAddressAt(V1);
    refusedBy('OUTPUTS', () => verifyC(cancelTx((tx) => {
      tx.body.outputs.push({ address: Cardano.PaymentAddress(script), value: { coins: 1_000_000n } });
    }), CANCEL_INTENT, context({ ownAddresses: new Set([RECEIVE, CHANGE, script]) })));
    refusedBy('OUTPUTS', () => verifyC(cancelTx((tx) => {
      tx.body.outputs.push({ address: Cardano.PaymentAddress(FOREIGN), value: { coins: 1_000_000n } });
    }), CANCEL_INTENT, context({ ownAddresses: new Set([RECEIVE, CHANGE, FOREIGN]) })));
  });
});

describe('verifyCancel: fee and collateral', () => {
  it('refuses a fee over 2 ADA', () => {
    refusedBy('FEE', () => verifyC(cancelTx((tx) => { tx.body.fee = NFT_MARKET_MAX_FEE_LOVELACE + 1n; })));
    expect(verifyC(cancelTx((tx) => { tx.body.fee = NFT_MARKET_MAX_FEE_LOVELACE; })).networkFeeLovelace).toBe('2000000');
  });

  const pooled = () => cancelTx((tx) => {
    tx.body.collaterals = [refIn(SPONSORED_REF)];
    delete tx.body.collateralReturn;
    delete tx.body.totalCollateral;
  });

  it('accepts the lent pool collateral only as collateral and only when Nexus said it lent it', () => {
    const summary = verifyC(pooled(), CANCEL_INTENT, context({ sponsoredCollateralRef: SPONSORED_REF }));
    expect(summary.sponsoredCollateralRef).toBe(SPONSORED_REF);
    expect(verifyC(cancelTx(), CANCEL_INTENT, context({ sponsoredCollateralRef: SPONSORED_REF }))).not.toHaveProperty('sponsoredCollateralRef');
    refusedBy('COLLATERAL', () => verifyC(pooled()));
  });

  it('refuses collateral at risk above 5 ADA, none, and more than one', () => {
    refusedBy('COLLATERAL', () => verifyC(cancelTx((tx) => {
      tx.body.collateralReturn!.value.coins = FEE_COINS - NFT_MARKET_MAX_COLLATERAL_LOVELACE - 1n;
      tx.body.totalCollateral = NFT_MARKET_MAX_COLLATERAL_LOVELACE + 1n;
    })));
    refusedBy('COLLATERAL', () => verifyC(cancelTx((tx) => { delete tx.body.collateralReturn; delete tx.body.totalCollateral; })));
    expect(verifyC(cancelTx((tx) => {
      tx.body.collateralReturn!.value.coins = FEE_COINS - NFT_MARKET_MAX_COLLATERAL_LOVELACE;
      tx.body.totalCollateral = NFT_MARKET_MAX_COLLATERAL_LOVELACE;
    })).txId).toBeTruthy();
    refusedBy('COLLATERAL', () => verifyC(cancelTx((tx) => {
      delete tx.body.collaterals;
      delete tx.body.collateralReturn;
      delete tx.body.totalCollateral;
    })));
    refusedBy('COLLATERAL', () => verifyC(cancelTx((tx) => { tx.body.collaterals!.push(refIn(SPONSORED_REF)); })));
  });

  it('refuses a collateral return that is not plain ADA to the wallet, and a total that disagrees', () => {
    refusedBy('COLLATERAL', () => verifyC(cancelTx((tx) => { tx.body.collateralReturn!.address = Cardano.PaymentAddress(FOREIGN); })));
    refusedBy('COLLATERAL', () => verifyC(cancelTx((tx) => { tx.body.collateralReturn!.value.assets = assets(OTHER_UNIT); })));
    refusedBy('COLLATERAL', () => verifyC(cancelTx((tx) => { tx.body.totalCollateral = 1n; })));
  });
});

// ---------------------------------------------------------------------------------------------

describe('verifyReprice: the valid reprice', () => {
  it('accepts a new price at the same address with the royalties computed for it, and summarises it', () => {
    const tx = repriceTx();
    expect(verifyR(tx)).toEqual({
      txId: tx.id,
      ref: LISTING_REF,
      unit: UNIT_222,
      oldPriceLovelace: '100000000',
      oldDepositLovelace: '2000000',
      priceLovelace: '80000000',
      listingAddress: LISTING_V1,
      listingOutputIndex: 0,
      deploymentVersion: 1,
      royalties: [{ address: ROYALTY_ADDRESS, lovelace: '4000000' }],
      marketFeeLovelace: '1500000',
      royaltiesLovelace: '4000000',
      sellerReceivesLovelace: '74500000',
      depositLovelace: '2000000',
      networkFeeLovelace: '400000',
    });
  });

  it('applies the cancel rules to the input it spends', () => {
    refusedBy('TX_ID', () => verifyReprice(repriceTx().cbor, 'ab'.repeat(32), REPRICE_INTENT, context()));
    refusedBy('INPUTS', () => verifyR(repriceTx(), { ...REPRICE_INTENT, ref: OTHER_LISTING_REF }));
    refusedBy('INPUTS', () => verifyR(repriceTx((tx) => { delete tx.body.referenceInputs; })));
    refusedBy('REDEEMERS', () => verifyR(repriceTx((tx) => { tx.witness.redeemers = [spend(LISTING_SORTED, 'd8799f00ff')]; })));
    refusedBy('SIGNERS', () => verifyR(repriceTx((tx) => { tx.body.requiredExtraSignatures = [Ed25519KeyHashHex(OWNER_B)]; })));
    refusedBy('FEE', () => verifyR(repriceTx((tx) => { tx.body.fee = NFT_MARKET_MAX_FEE_LOVELACE + 1n; })));
    refusedBy('COLLATERAL', () => verifyR(repriceTx((tx) => { delete tx.body.collaterals; })));
    refusedBy('FORBIDDEN_FIELD', () => verifyR(repriceTx((tx) => { tx.body.mint = assets(OTHER_UNIT); })));
  });

  it('needs a validity window with both bounds, at most an hour wide', () => {
    refusedBy('FORBIDDEN_FIELD', () => verifyR(repriceTx((tx) => { delete tx.body.validityInterval; })));
    refusedBy('FORBIDDEN_FIELD', () => verifyR(repriceTx((tx) => { tx.body.validityInterval = { invalidHereafter: Cardano.Slot(4_000_000_000) }; })));
    refusedBy('FORBIDDEN_FIELD', () => verifyR(repriceTx((tx) => { tx.body.validityInterval = { invalidBefore: Cardano.Slot(1000) }; })));
    refusedBy('FORBIDDEN_FIELD', () => verifyR(repriceTx((tx) => {
      tx.body.validityInterval = { invalidBefore: Cardano.Slot(1), invalidHereafter: Cardano.Slot(2 + NFT_MARKET_MAX_VALIDITY_SLOTS) };
    })));
  });
});

describe('verifyReprice: the new listing output', () => {
  it('refuses a reprice with no listing output, or with two', () => {
    refusedBy('LISTING', () => verifyR(repriceTx((tx) => {
      tx.body.outputs[0] = { address: Cardano.PaymentAddress(RECEIVE), value: { coins: DEPOSIT, assets: assets(UNIT_222) } };
    })));
    refusedBy('LISTING', () => verifyR(repriceTx((tx) => {
      tx.body.outputs.push(listingOutput(LISTING_V1, listingDatumHex(REPRICED), OTHER_UNIT));
    })));
  });

  it('refuses a listing at another address than the old listing\'s', () => {
    // The newest deployment, another stake key, the payment key of the wallet in the stake slot.
    refusedBy('LISTING', () => verifyR(repriceTx((tx) => { tx.body.outputs[0].address = Cardano.PaymentAddress(LISTING_V2); })));
    refusedBy('LISTING', () => verifyR(repriceTx((tx) => { tx.body.outputs[0].address = Cardano.PaymentAddress(listingAddressAt(V1, OTHER_STAKE)); })));
    refusedBy('LISTING', () => verifyR(repriceTx((tx) => { tx.body.outputs[0].address = Cardano.PaymentAddress(listingAddressAt(V1, OWNER)); })));
  });

  it("refuses a stake key that is another key of the wallet's own addresses: it must be the account's", () => {
    const altContext = context({
      ownAddresses: new Set([RECEIVE, CHANGE, ALT_ADDRESS]),
      ownKeyHashes: new Set([OWNER, OWNER_B, STAKE, ALT_OWNER, SECOND_STAKE]),
    });
    refusedBy('LISTING', () => verifyR(repriceTx((tx) => {
      tx.body.outputs[0].address = Cardano.PaymentAddress(listingAddressAt(V1, SECOND_STAKE));
    }), REPRICE_INTENT, altContext));
    expect(verifyR(repriceTx(), REPRICE_INTENT, altContext).deploymentVersion).toBe(1);
    refusedBy('LISTING', () => verifyR(repriceTx(), REPRICE_INTENT, context({ stakeKeyHash: SECOND_STAKE, ownKeyHashes: new Set([OWNER, OWNER_B, STAKE, SECOND_STAKE]) })));
  });

  it('refuses a value other than the NFT once plus a deposit within a new listing\'s bounds', () => {
    refusedBy('NFT', () => verifyR(repriceTx((tx) => {
      tx.body.outputs[0].value.assets = new Map([[Cardano.AssetId(UNIT_222), 1n], [Cardano.AssetId(OTHER_UNIT), 1n]]) as Cardano.TokenMap;
    })));
    refusedBy('NFT', () => verifyR(repriceTx((tx) => { tx.body.outputs[0].value.assets = assets(OTHER_UNIT); })));
    refusedBy('NFT', () => verifyR(repriceTx((tx) => { tx.body.outputs[0].value.assets = assets(UNIT_222, 2n); })));
    refusedBy('LISTING', () => verifyR(repriceTx((tx) => { tx.body.outputs[0].value.coins = 0n; })));
    refusedBy('LISTING', () => verifyR(repriceTx((tx) => { tx.body.outputs[0].value.coins = MAX_LISTING_DEPOSIT + 1n; })));
  });

  it('accepts a deposit that grows or shrinks with the new datum (a new listing\'s deposit), and says what it was', () => {
    // More royalties need a larger output: the wallet's own inputs pay the difference.
    const grown = verifyR(repriceTx((tx) => { tx.body.outputs[0].value.coins = DEPOSIT + 300_000n; }));
    expect(grown).toMatchObject({ depositLovelace: '2300000', oldDepositLovelace: '2000000' });
    // Fewer: the rest comes back as change to the wallet's own address.
    const shrunk = verifyR(repriceTx((tx) => { tx.body.outputs[0].value.coins = DEPOSIT - 600_000n; }));
    expect(shrunk).toMatchObject({ depositLovelace: '1400000', oldDepositLovelace: '2000000' });
    expect(verifyR(repriceTx((tx) => { tx.body.outputs[0].value.coins = MAX_LISTING_DEPOSIT; })).depositLovelace).toBe('5000000');
  });

  it('refuses a datum hash, no datum, and bytes that are no listing', () => {
    refusedBy('DATUM', () => verifyR(repriceTx((tx) => {
      delete tx.body.outputs[0].datum;
      tx.body.outputs[0].datumHash = Hash32ByteBase16('00'.repeat(32));
    })));
    refusedBy('DATUM', () => verifyR(repriceTx((tx) => { delete tx.body.outputs[0].datum; })));
    refusedBy('DATUM', () => verifyR(repriceWithDatum('d87980')));
  });

  it('refuses royalties that are not exactly the ones computed for the new price, the old fixed amounts first among them', () => {
    const other = (royalties: Payee[]) => repriceWithDatum(listingDatumHex({ ...REPRICED, royalties }));
    // The old listing's 5 ADA, carried over unchanged: what a seller who listed low and raised the price would want.
    refusedBy('DATUM', () => verifyR(other(ROYALTIES)));
    refusedBy('DATUM', () => verifyR(other([])));
    refusedBy('DATUM', () => verifyR(other([{ address: ROYALTY_ADDRESS, lovelace: 4n * ADA - 1n }])));
    refusedBy('DATUM', () => verifyR(other([{ address: ROYALTY_ADDRESS_2, lovelace: 4n * ADA }])));
    refusedBy('DATUM', () => verifyR(other([...REPRICED_ROYALTIES, { address: ROYALTY_ADDRESS_2, lovelace: 1n * ADA }])));
    // And the other way round: a datum with the old amounts against an intent that computed none.
    refusedBy('DATUM', () => verifyR(repriceWithDatum(listingDatumHex({ ...REPRICED, royalties: ROYALTIES })), { ...REPRICE_INTENT, royalties: [] }));
  });

  it('accepts the royalties computed at a higher and at a lower price, in their order', () => {
    const at = (price: bigint, royalties: Payee[]) =>
      verifyR(repriceWithDatum(listingDatumHex({ ...REPRICED, price, royalties })), { ref: LISTING_REF, price, royalties });
    // Raised to 300 ADA: 5% is 15 ADA, and a second recipient now clears min-UTxO.
    const higher = at(300n * ADA, [{ address: ROYALTY_ADDRESS, lovelace: 15n * ADA }, { address: ROYALTY_ADDRESS_2, lovelace: 1_500_000n }]);
    expect(higher.royalties).toEqual([
      { address: ROYALTY_ADDRESS, lovelace: '15000000' },
      { address: ROYALTY_ADDRESS_2, lovelace: '1500000' },
    ]);
    expect(higher.royaltiesLovelace).toBe('16500000');
    // Cut to 40 ADA: 2 ADA, never the old 5.
    expect(at(40n * ADA, [{ address: ROYALTY_ADDRESS, lovelace: 2n * ADA }]).royaltiesLovelace).toBe('2000000');
    // No royalty left at the new price.
    expect(at(40n * ADA, []).royalties).toEqual([]);
  });

  it('holds the new royalties to a listing\'s limits even when the datum matches the intent', () => {
    const four = Array.from({ length: MAX_ROYALTIES + 1 }, () => ({ address: ROYALTY_ADDRESS, lovelace: 1n * ADA }));
    refusedBy('DATUM', () => verifyR(repriceWithDatum(listingDatumHex({ ...REPRICED, royalties: four })), { ...REPRICE_INTENT, royalties: four }));
    const zero = [{ address: ROYALTY_ADDRESS, lovelace: 0n }];
    refusedBy('DATUM', () => verifyR(repriceWithDatum(listingDatumHex({ ...REPRICED, royalties: zero })), { ...REPRICE_INTENT, royalties: zero }));
  });

  it('refuses a reprice that changes the owner, the seller address or the buyer', () => {
    refusedBy('DATUM', () => verifyR(repriceWithDatum(listingDatumHex({ ...REPRICED, owner: OWNER_B }))));
    refusedBy('DATUM', () => verifyR(repriceWithDatum(listingDatumHex({ ...REPRICED, sellerAddress: CHANGE }))));
    refusedBy('DATUM', () => verifyR(repriceWithDatum(listingDatumHex({ ...REPRICED, sellerAddress: FOREIGN }))));
    refusedBy('DATUM', () => verifyR(repriceWithDatum(listingDatumHex({ ...REPRICED, buyer: STRANGER }))));
  });

  it('keeps a private listing\'s buyer', () => {
    const buyer = STRANGER;
    const privateListing: OwnListing = { ...OWN_LISTING, datum: { ...DATUM, buyer } };
    const ctx = context({ ownListings: new Map([[LISTING_REF, privateListing]]) });
    expect(verifyR(repriceWithDatum(listingDatumHex({ ...REPRICED, buyer })), REPRICE_INTENT, ctx).priceLovelace).toBe('80000000');
    refusedBy('DATUM', () => verifyR(repriceWithDatum(listingDatumHex({ ...REPRICED, buyer: null })), REPRICE_INTENT, ctx));
  });

  it('refuses a price other than the intent\'s, under the minimum, or leaving the seller under the minimum', () => {
    refusedBy('DATUM', () => verifyR(repriceTx(), { ...REPRICE_INTENT, price: 81n * ADA }));
    const low = MIN_LIST_PRICE - 1n;
    refusedBy('DATUM', () => verifyR(repriceWithDatum(listingDatumHex({ ...REPRICED, price: low })), { ...REPRICE_INTENT, price: low }));
    // New royalties of 5 ADA and the 1.5 ADA fee floor leave 1.5 ADA at 8 ADA and less below it.
    const heavy = { royalties: ROYALTIES };
    const short = 8n * ADA - 1n;
    refusedBy('DATUM', () => verifyR(repriceWithDatum(listingDatumHex({ ...REPRICED, ...heavy, price: short })), { ...REPRICE_INTENT, ...heavy, price: short }));
    const exact = 8n * ADA;
    expect(verifyR(repriceWithDatum(listingDatumHex({ ...REPRICED, ...heavy, price: exact })), { ...REPRICE_INTENT, ...heavy, price: exact }).sellerReceivesLovelace).toBe('1500000');
  });

  it('refuses any other output that is not the wallet\'s', () => {
    refusedBy('OUTPUTS', () => verifyR(repriceTx((tx) => {
      tx.body.outputs.push({ address: Cardano.PaymentAddress(FOREIGN), value: { coins: 1_000_000n } });
    })));
    refusedBy('OUTPUTS', () => verifyR(repriceTx((tx) => { tx.body.outputs[1].datum = plutusData('d87980'); })));
  });
});

// ---------------------------------------------------------------------------------------------

describe('the checks the migrate verifier reuses', () => {
  const emptyContext = () => context({ deployments: [] });

  it('refuse an empty deployment list with a MarketVerifyError, never a TypeError', () => {
    refusedBy('NETWORK', () => newestDeployment([]));
    expect(newestDeployment([V1, V2])).toBe(V2);
    const serialized = Serialization.Transaction.fromCbor(HexBlob(listTx().cbor));
    refusedBy('NETWORK', () => checkNewListing(serialized, 0, serialized.toCore().body.outputs[0], V2, LIST_INTENT, emptyContext()));
    refusedBy('NETWORK', () => checkEnvelope(serialized.toCore(), emptyContext()));
  });

  it('apply the envelope, including the validity window, to any transaction', () => {
    expect(() => checkEnvelope(Serialization.Transaction.fromCbor(HexBlob(listTx().cbor)).toCore(), context())).not.toThrow();
    const open = Serialization.Transaction.fromCbor(HexBlob(listTx((tx) => { delete tx.body.validityInterval; }).cbor)).toCore();
    refusedBy('FORBIDDEN_FIELD', () => checkEnvelope(open, context()));
    refusedBy('FORBIDDEN_FIELD', () => checkValidityWindow(open.body));
    expect(() => checkValidityWindow(validList().body)).not.toThrow();
  });
});
