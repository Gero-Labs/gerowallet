// The wallet's check of a buy that Nexus built for a Gero listing (spec 5.10). A wrong buy either
// fails on chain and burns the collateral, or pays someone more than the listing says: each rule
// has one passing transaction here and an altered copy that must be refused with that rule's code.
//
// The listing and its datum are built by hand (indefinite-length constructors, as Nexus writes
// them). Amounts follow docs/rules.md: fee = clamp(1.5 ADA, 5 ADA, 1%), seller due = price - fee -
// royalties + deposit, tag = blake2b-256 of the listing's out-ref. Min-UTxO figures in the top-up
// tests come from the SDK's own `minAdaRequired`, not from the verifier's byte count.
import { describe, expect, it } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Ed25519KeyHashHex, Hash28ByteBase16, Hash32ByteBase16 } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { minAdaRequired } from '@cardano-sdk/tx-construction';
import type { ListingDto } from '@/api/nft-market-api';
import { inlineDatumFromCbor } from '@/shared/utils/utxoCbor';
import {
  NFT_MARKET_DEPLOYMENTS_PREPROD,
  NFT_MARKET_MAX_COLLATERAL_LOVELACE,
  NFT_MARKET_MAX_FEE_LOVELACE,
  NFT_MARKET_MAX_VALIDITY_SLOTS,
  type NftMarketDeployment,
} from '@/utils/nftMarketDeployments';
import { decodeListingDatum, listingFee, listingTag, sellerDue, sellerShare, type ListingDatum, type Payee } from './listingDatum';
import type { OwnListing } from './ownListings';
import { MarketVerifyError, type MarketVerifyRule } from './verifyListing';
import type { ListingChainUtxo } from './listingChainUtxo';
import { verifyBuy, type BuyVerifyContext } from './verifyBuy';

const TESTNET = Cardano.NetworkId.Testnet;
const MAINNET = Cardano.NetworkId.Mainnet;
const ADA = 1_000_000n;
const CPB = 4_310n;

// ---------------------------------------------------------------------------------------------
// Datum encoder (test side)
// ---------------------------------------------------------------------------------------------

const hex2 = (n: number) => n.toString(16).padStart(2, '0');
const bstr = (h: string) => `58${hex2(h.length / 2)}${h}`;
const NONE = 'd87a80';

/** A CBOR integer, negative ones included (major type 1 holds -1 - n). */
function uint(n: bigint): string {
  if (n < 0n) return `${(0x20 | 0x1b).toString(16)}${(-1n - n).toString(16).padStart(16, '0')}`;
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
// The wallet, the seller, the deployments
// ---------------------------------------------------------------------------------------------

const BUYER_PAY = '1864a6eb4242da06750913784d9afb549dc3022d01bbd316530f390c';
const BUYER_PAY_B = 'b551db0a6c4f3e1d2a90b7c85e4f13d6a7b8c9d0e1f2a3b4c5d6e7f8';
const BUYER_STAKE = '5ce6d8a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6071829';
const SELLER_PKH = '2a'.repeat(28);

function baseAddress(networkId: Cardano.NetworkId, payment: string, stake: string, paymentIsScript = false): string {
  return Cardano.BaseAddress.fromCredentials(
    networkId,
    { hash: Hash28ByteBase16(payment), type: paymentIsScript ? Cardano.CredentialType.ScriptHash : Cardano.CredentialType.KeyHash },
    { hash: Hash28ByteBase16(stake), type: Cardano.CredentialType.KeyHash },
  ).toAddress().toBech32();
}

const BUYER = baseAddress(TESTNET, BUYER_PAY, BUYER_STAKE);
const BUYER_CHANGE = baseAddress(TESTNET, BUYER_PAY_B, BUYER_STAKE);
const SELLER_ADDRESS = baseAddress(TESTNET, SELLER_PKH, '2b'.repeat(28));
const ROYALTY_ADDRESS = baseAddress(TESTNET, '41'.repeat(28), '42'.repeat(28));
const ROYALTY_ADDRESS_2 = baseAddress(TESTNET, '43'.repeat(28), '44'.repeat(28));
const STRANGER = baseAddress(TESTNET, '77'.repeat(28), '78'.repeat(28));
const REWARD_ACCOUNT = Cardano.RewardAccount(
  Cardano.RewardAddress.fromCredentials(TESTNET, { hash: Hash28ByteBase16(BUYER_STAKE), type: Cardano.CredentialType.KeyHash }).toAddress().toBech32(),
);

// v1 is the real preprod deployment. v2 is newer, with its own script, reference script and fee
// address (one fee address per contract version, spec 5.9): the fee address of a buy comes from
// the deployment of the listing being bought, never from the newest one.
const V1: NftMarketDeployment = NFT_MARKET_DEPLOYMENTS_PREPROD[0];
function withStake(address: string, stake: string): string {
  const base = Cardano.Address.fromBech32(address).asBase()!;
  return baseAddress(TESTNET, base.getPaymentCredential().hash, stake, base.getPaymentCredential().type === Cardano.CredentialType.ScriptHash);
}
const FEE_ADDRESS = V1.feeAddress;
const V2_FEE_ADDRESS = withStake(FEE_ADDRESS, '9a'.repeat(28));
const V2: NftMarketDeployment = {
  ...V1,
  version: 2,
  scriptHash: 'c2'.repeat(28),
  referenceScript: `${'d2'.repeat(32)}#0`,
  feeAddress: V2_FEE_ADDRESS,
};

const POLICY = 'aa'.repeat(28);
const NAME = Buffer.from('Gero NFT').toString('hex');
const ASSET_NAME_222 = `000de140${NAME}`;
const UNIT_222 = `${POLICY}${ASSET_NAME_222}`;
const UNIT_100 = `${POLICY}000643b0${NAME}`;

const BUYER_TX = '7d'.repeat(32);
const LISTING_TX = 'b1'.repeat(32);
const OTHER_LISTING_TX = 'b2'.repeat(32);
const STRANGER_TX = 'c3'.repeat(32);
const SPONSORED_TX = 'aa'.repeat(32);
const LISTING_REF = `${LISTING_TX}#0`;
const SPONSORED_REF = `${SPONSORED_TX}#2`;

const txIn = (txId: string, index: number): Cardano.TxIn => ({ txId: Cardano.TransactionId(txId), index });
const refIn = (ref: string) => txIn(ref.split('#')[0], Number(ref.split('#')[1]));
const BUYER_IN = txIn(BUYER_TX, 0);
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

const BUYER_COINS = 2000n * ADA;
const BUYER_UTXO = utxo(BUYER_TX, 0, BUYER_CHANGE, BUYER_COINS);

const assetMap = (unit: string, quantity = 1n) => new Map([[Cardano.AssetId(unit), quantity]]) as Cardano.TokenMap;
const plutusData = (cbor: string) => Serialization.PlutusData.fromCbor(HexBlob(cbor)).toCore();
const inline = (cbor: string) => inlineDatumFromCbor(HexBlob(cbor));

// ---------------------------------------------------------------------------------------------
// The listing and its datum
// ---------------------------------------------------------------------------------------------

const PRICE = 100n * ADA;
const DEPOSIT = 2n * ADA;
const ROYALTIES: Payee[] = [{ address: ROYALTY_ADDRESS, lovelace: 5n * ADA }];
const DATUM: ListingDatum = { owner: SELLER_PKH, sellerAddress: SELLER_ADDRESS, price: PRICE, royalties: ROYALTIES, buyer: null };

function listingDto(datum: ListingDatum = DATUM, over: Partial<ListingDto> = {}): ListingDto {
  const deployment = over.version === 2 ? V2 : V1;
  return {
    txHash: LISTING_TX,
    outputIndex: 0,
    version: deployment.version,
    scriptHash: deployment.scriptHash,
    unit: UNIT_222,
    policyId: POLICY,
    assetName: ASSET_NAME_222,
    priceLovelace: datum.price.toString(),
    feeLovelace: listingFee(datum.price, deployment).toString(),
    royalties: datum.royalties.map((r) => ({ address: r.address, lovelace: r.lovelace.toString() })),
    depositLovelace: DEPOSIT.toString(),
    sellerAddress: datum.sellerAddress,
    ownerPkh: datum.owner,
    listedSlot: 1234,
    datumCbor: listingDatumHex(datum),
    ...over,
  };
}
const LISTING = listingDto();

function context(over: Partial<BuyVerifyContext> = {}): BuyVerifyContext {
  return {
    networkId: TESTNET,
    deployments: [V1],
    ownUtxos: [BUYER_UTXO],
    ownAddresses: new Set([BUYER, BUYER_CHANGE]),
    ownKeyHashes: new Set([BUYER_PAY, BUYER_PAY_B, BUYER_STAKE]),
    ownListings: new Map<string, OwnListing>(),
    stakeKeyHash: BUYER_STAKE,
    ...over,
  };
}

// ---------------------------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------------------------

type Built = { cbor: string; id: string };

function build(tx: Cardano.Tx, edit: (tx: Cardano.Tx) => void): Built {
  edit(tx);
  const serialized = Serialization.Transaction.fromCore(tx);
  return { cbor: serialized.toCbor(), id: serialized.getId() };
}

const tagOf = (txId = LISTING_TX, index = 0) => listingTag(txId, index);
const tagDatum = (txId = LISTING_TX, index = 0) => inline(`5820${tagOf(txId, index)}`);

/** A plain payment, tagged by default; pass `null` for an output with no datum. */
const payOut = (address: string, coins: bigint, datum: Cardano.PlutusData | null = tagDatum()): Cardano.TxOut => ({
  address: Cardano.PaymentAddress(address),
  value: { coins },
  ...(datum ? { datum } : {}),
});

/** What a builder pays a payee: the due, raised to the output's min-UTxO (the SDK's own figure). */
function paidTo(address: string, due: bigint, cpb = CPB): bigint {
  const min = minAdaRequired(payOut(address, due), cpb);
  return due >= min ? due : minAdaRequired(payOut(address, min), cpb);
}

const redeemer = (purpose: Cardano.RedeemerPurpose, index: number, cbor: string): Cardano.Redeemer => ({
  purpose,
  index,
  data: plutusData(cbor),
  executionUnits: { memory: 600_000, steps: 250_000_000 },
});
const purchase = (sortedIndex: number, firstOutput: number) =>
  redeemer(Cardano.RedeemerPurpose.spend, sortedIndex, `d8799f${uint(BigInt(firstOutput))}ff`);

// Body order [LISTING, BUYER]; the ledger sorts by id, so BUYER (7d) is 0 and LISTING (b1) is 1.
const LISTING_SORTED = 1;
const WINDOW = { invalidBefore: Cardano.Slot(1000), invalidHereafter: Cardano.Slot(1000 + 1920) };
const NETWORK_FEE = 400_000n;
const NFT_COINS = 1_500_000n;

interface BuyOptions {
  datum?: ListingDatum;
  deployment?: NftMarketDeployment;
  deposit?: bigint;
  /** What the buyer's own NFT output holds besides the NFT. */
  nftCoins?: bigint;
  cpb?: bigint;
}

/**
 * A valid buy: the fee output, the seller, each royalty, the NFT to the buyer, change. Change is
 * derived so the transaction balances with the listing's deposit as the listing input's lovelace.
 */
function validBuy(opts: BuyOptions = {}): Cardano.Tx {
  const datum = opts.datum ?? DATUM;
  const deployment = opts.deployment ?? V1;
  const deposit = opts.deposit ?? DEPOSIT;
  const cpb = opts.cpb ?? CPB;
  const fee = listingFee(datum.price, deployment);
  const outputs: Cardano.TxOut[] = [
    payOut(deployment.feeAddress, fee, null),
    payOut(datum.sellerAddress, paidTo(datum.sellerAddress, sellerDue(datum, deployment, deposit), cpb)),
    ...datum.royalties.map((r) => payOut(r.address, paidTo(r.address, r.lovelace, cpb))),
    {
      address: Cardano.PaymentAddress(BUYER),
      value: { coins: opts.nftCoins ?? NFT_COINS, assets: assetMap(UNIT_222) },
    },
  ];
  const paid = outputs.reduce((sum, o) => sum + o.value.coins, 0n);
  const change = BUYER_COINS + deposit - paid - NETWORK_FEE;
  outputs.push({ address: Cardano.PaymentAddress(BUYER_CHANGE), value: { coins: change } });
  return {
    id: Cardano.TransactionId('00'.repeat(32)),
    body: {
      inputs: [LISTING_IN, BUYER_IN],
      outputs,
      fee: NETWORK_FEE,
      validityInterval: WINDOW,
      collaterals: [BUYER_IN],
      collateralReturn: { address: Cardano.PaymentAddress(BUYER_CHANGE), value: { coins: BUYER_COINS - 2n * ADA } },
      totalCollateral: 2n * ADA,
      referenceInputs: [refIn(deployment.referenceScript)],
      scriptIntegrityHash: Hash32ByteBase16('ab'.repeat(32)),
    },
    witness: { signatures: new Map(), redeemers: [purchase(LISTING_SORTED, 1)] },
    isValid: true,
  };
}
const buyTx = (edit: (tx: Cardano.Tx) => void = () => undefined, opts?: BuyOptions) => build(validBuy(opts), edit);

/**
 * Like buyTx, but the change output absorbs whatever the edit moved, so the transaction still
 * balances against the listing's deposit. This is how a lying builder would do it: the extra
 * paid to a payee comes out of the buyer's change, and the outflow check alone cannot see it.
 */
const balancedBuyTx = (edit: (tx: Cardano.Tx) => void, opts?: BuyOptions) =>
  buyTx((tx) => {
    edit(tx);
    const change = tx.body.outputs[tx.body.outputs.length - 1];
    const others = tx.body.outputs.slice(0, -1).reduce((sum, o) => sum + o.value.coins, 0n);
    change.value.coins = BUYER_COINS + (opts?.deposit ?? DEPOSIT) - others - tx.body.fee;
  }, opts);

// Output positions in validBuy: 0 fee, 1 seller, 2 royalty, 3 the NFT to the buyer, 4 change.
const FEE_OUT = 0;
const SELLER_OUT = 1;
const ROYALTY_OUT = 2;
const NFT_OUT = 3;
const CHANGE_OUT = 4;

/**
 * The listing UTxO as an independent source (the hash-proven read of its creating transaction)
 * would report it when Nexus tells the truth: for the listing's own out-ref, at the deployment's
 * script, holding the deposit and the one NFT, with the row's own datum inline. The tests of the
 * chain check pass something else.
 */
function chainFrom(listing: ListingDto): ListingChainUtxo {
  try {
    return {
      ref: `${listing.txHash}#${listing.outputIndex}`,
      address: baseAddress(TESTNET, listing.scriptHash, '2c'.repeat(28), true),
      lovelace: BigInt(listing.depositLovelace),
      assets: [{ unit: listing.unit, quantity: 1n }],
      inlineDatumCbor: listing.datumCbor,
    };
  } catch {
    // A row too broken to mirror (its own checks refuse it first).
    return CHAIN;
  }
}
const CHAIN: ListingChainUtxo = {
  ref: LISTING_REF,
  address: baseAddress(TESTNET, V1.scriptHash, '2c'.repeat(28), true),
  lovelace: DEPOSIT,
  assets: [{ unit: UNIT_222, quantity: 1n }],
  inlineDatumCbor: listingDatumHex(DATUM),
};
const intentOf = (listing: ListingDto, chainUtxo: ListingChainUtxo = chainFrom(listing)) => ({ listing, buyerAddress: BUYER, chainUtxo });
const INTENT = intentOf(LISTING);
const verify = (tx: Built, intent = INTENT, ctx = context()) => verifyBuy(tx.cbor, tx.id, intent, ctx);

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

// ---------------------------------------------------------------------------------------------

describe('verifyBuy: a valid buy', () => {
  it('accepts the buy and reports what the buyer pays', () => {
    const tx = buyTx();
    const summary = verify(tx);
    expect(summary).toEqual({
      txId: tx.id,
      ref: LISTING_REF,
      unit: UNIT_222,
      priceLovelace: '100000000',
      feeLovelace: '1500000',
      royaltiesLovelace: '5000000',
      depositLovelace: '2000000',
      networkFeeLovelace: '400000',
      minUtxoTopUpLovelace: '0',
      totalOutflowLovelace: '100400000',
    });
  });

  it('puts the contract numbers where docs/rules.md says (1.5 ADA fee, 95.5 ADA to the seller)', () => {
    const tx = validBuy();
    expect(tx.body.outputs[FEE_OUT].value.coins).toBe(1_500_000n);
    expect(tx.body.outputs[SELLER_OUT].value.coins).toBe(95_500_000n);
    expect(tx.body.outputs[ROYALTY_OUT].value.coins).toBe(5_000_000n);
    expect(sellerShare(DATUM, V1)).toBe(93_500_000n);
  });

  it("charges the buyer the price and the network fee, the deposit is the seller's own ADA", () => {
    const tx = validBuy();
    const body = tx.body;
    const ownIn = BUYER_COINS;
    const ownOut = body.outputs[NFT_OUT].value.coins + body.outputs[CHANGE_OUT].value.coins;
    // The payees are paid price + deposit; the listing input brings the deposit back.
    const toPayees = body.outputs[FEE_OUT].value.coins + body.outputs[SELLER_OUT].value.coins + body.outputs[ROYALTY_OUT].value.coins;
    expect(toPayees).toBe(PRICE + DEPOSIT);
    expect(ownIn - ownOut).toBe(PRICE + body.fee);
    expect(BigInt(verify(buyTx()).totalOutflowLovelace)).toBe(PRICE + NETWORK_FEE);
  });

  it("keeps the ADA of the buyer's own NFT output theirs: a bigger NFT output does not change the outflow", () => {
    const small = verify(buyTx(undefined, { nftCoins: 1_200_000n }));
    const big = verify(buyTx(undefined, { nftCoins: 25n * ADA }));
    expect(small.totalOutflowLovelace).toBe('100400000');
    expect(big.totalOutflowLovelace).toBe('100400000');
  });

  it('accepts a buy with no royalty, with two royalties, and with the NFT output also carrying change', () => {
    const none = withDatum({ royalties: [] });
    expect(verify(buyTx(undefined, { datum: none }), intentOf(listingDto(none))).royaltiesLovelace).toBe('0');
    const two = withDatum({ royalties: [...ROYALTIES, { address: ROYALTY_ADDRESS_2, lovelace: 2n * ADA }] });
    const summary = verify(buyTx(undefined, { datum: two }), intentOf(listingDto(two)));
    expect(summary.royaltiesLovelace).toBe('7000000');
    expect(summary.totalOutflowLovelace).toBe('100400000');
  });

  it("treats a payee output at the buyer's own address as paid out, so buying one's own listing still costs price + fee", () => {
    const mine = withDatum({ owner: BUYER_PAY, sellerAddress: BUYER });
    const summary = verify(buyTx(undefined, { datum: mine }), intentOf(listingDto(mine)));
    expect(summary.totalOutflowLovelace).toBe('100400000');
  });

  it('takes the fee from the cap on a dear listing', () => {
    const dear = withDatum({ price: 1000n * ADA, royalties: [] });
    const summary = verify(buyTx(undefined, { datum: dear }), intentOf(listingDto(dear)));
    expect(summary.feeLovelace).toBe('5000000');
    expect(summary.totalOutflowLovelace).toBe((1000n * ADA + NETWORK_FEE).toString());
  });

  it('buys from an older deployment while a newer one exists, with that deployment\'s own reference script', () => {
    const ctx = context({ deployments: [V2, V1] });
    expect(verify(buyTx(), INTENT, ctx).ref).toBe(LISTING_REF);
  });

  it("pays the fee address of the listing's own deployment", () => {
    const listing = listingDto(DATUM, { version: 2 });
    const ctx = context({ deployments: [V2, V1] });
    const ok = buyTx(undefined, { deployment: V2 });
    expect(verify(ok, intentOf(listing), ctx).feeLovelace).toBe('1500000');
    // The same buy paying v1's fee address is not v2's.
    const wrong = buyTx((tx) => { tx.body.outputs[FEE_OUT].address = Cardano.PaymentAddress(FEE_ADDRESS); }, { deployment: V2 });
    refusedBy('OUTPUTS', () => verify(wrong, intentOf(listing), ctx));
  });

  it('accepts a lent pool UTxO as the collateral and says so', () => {
    const ctx = context({ sponsoredCollateralRef: SPONSORED_REF });
    const tx = buyTx((t) => {
      t.body.collaterals = [refIn(SPONSORED_REF)];
      delete t.body.collateralReturn;
      delete t.body.totalCollateral;
    });
    expect(verify(tx, INTENT, ctx).sponsoredCollateralRef).toBe(SPONSORED_REF);
  });
});

describe('verifyBuy: the seller output', () => {
  it('refuses a seller output short by 1 lovelace', () => {
    refusedBy('OUTPUTS', () => verify(balancedBuyTx((tx) => { tx.body.outputs[SELLER_OUT].value.coins -= 1n; })));
  });

  it('refuses a seller output overpaid by 3 ADA "for min-UTxO"', () => {
    refusedBy('OUTPUTS', () => verify(balancedBuyTx((tx) => { tx.body.outputs[SELLER_OUT].value.coins += 3n * ADA; })));
  });

  it('refuses a seller output overpaid by 1 lovelace when its due is above its min-UTxO', () => {
    refusedBy('OUTPUTS', () => verify(balancedBuyTx((tx) => { tx.body.outputs[SELLER_OUT].value.coins += 1n; })));
  });

  it('refuses a seller output that pays another address', () => {
    refusedBy('OUTPUTS', () => verify(buyTx((tx) => { tx.body.outputs[SELLER_OUT].address = Cardano.PaymentAddress(STRANGER); })));
  });

  it('refuses a seller output whose tag is another listing\'s', () => {
    refusedBy('OUTPUTS', () => verify(buyTx((tx) => { tx.body.outputs[SELLER_OUT].datum = tagDatum(OTHER_LISTING_TX, 0); })));
    refusedBy('OUTPUTS', () => verify(buyTx((tx) => { tx.body.outputs[SELLER_OUT].datum = tagDatum(LISTING_TX, 1); })));
  });

  it('refuses a seller output with no datum, a datum hash, or a datum that is not the tag', () => {
    refusedBy('OUTPUTS', () => verify(buyTx((tx) => { delete tx.body.outputs[SELLER_OUT].datum; })));
    refusedBy('OUTPUTS', () => verify(buyTx((tx) => {
      delete tx.body.outputs[SELLER_OUT].datum;
      tx.body.outputs[SELLER_OUT].datumHash = Hash32ByteBase16(tagOf());
    })));
    refusedBy('OUTPUTS', () => verify(buyTx((tx) => { tx.body.outputs[SELLER_OUT].datum = inline('182a'); })));
  });

  it('refuses a seller output that carries a token or a reference script', () => {
    refusedBy('OUTPUTS', () => verify(buyTx((tx) => { tx.body.outputs[SELLER_OUT].value.assets = assetMap(UNIT_222); })));
    refusedBy('OUTPUTS', () => verify(buyTx((tx) => {
      tx.body.outputs[SELLER_OUT].scriptReference = { __type: Cardano.ScriptType.Plutus, bytes: HexBlob('4e4d01000033222220051200120011'), version: Cardano.PlutusLanguageVersion.V3 } as Cardano.Script;
    })));
  });

  it("raises a seller output to its min-UTxO only when the seller's due is below it, and reports the top-up", () => {
    // Seller due: price 100, fee 1.5, a 98.4 ADA royalty, deposit 0.07 ADA: share 0.1 ADA, due 0.17 ADA.
    const small = withDatum({ royalties: [{ address: ROYALTY_ADDRESS, lovelace: 98_400_000n }] });
    const dto = listingDto(small, { depositLovelace: '70000' });
    const due = sellerDue(small, V1, 70_000n);
    expect(due).toBe(170_000n);
    const min = paidTo(SELLER_ADDRESS, due);
    expect(min).toBeGreaterThan(due);
    const summary = verify(buyTx(undefined, { datum: small, deposit: 70_000n }), intentOf(dto));
    expect(summary.minUtxoTopUpLovelace).toBe((min - due).toString());
    expect(summary.totalOutflowLovelace).toBe((PRICE + NETWORK_FEE + min - due).toString());
    // One lovelace more than the min-UTxO, or one less, is not what a builder pays.
    refusedBy('OUTPUTS', () => verify(balancedBuyTx((t) => { t.body.outputs[SELLER_OUT].value.coins += 1n; }, { datum: small, deposit: 70_000n }), intentOf(dto)));
    refusedBy('OUTPUTS', () => verify(balancedBuyTx((t) => { t.body.outputs[SELLER_OUT].value.coins -= 1n; }, { datum: small, deposit: 70_000n }), intentOf(dto)));
    // Exactly the due, below the min-UTxO, is an output the ledger would reject.
    refusedBy('OUTPUTS', () => verify(balancedBuyTx((t) => { t.body.outputs[SELLER_OUT].value.coins = due; }, { datum: small, deposit: 70_000n }), intentOf(dto)));
  });

  describe('the protocol parameter behind min-UTxO', () => {
    const small = withDatum({ royalties: [{ address: ROYALTY_ADDRESS, lovelace: 98_400_000n }] });
    const dto = listingDto(small, { depositLovelace: '70000' });
    const topUpBuy = (cpb: bigint) => buyTx(undefined, { datum: small, deposit: 70_000n, cpb });

    it('uses a lower value from the context as it is (a buy built under the real one then fails the check, which is safe)', () => {
      const half = CPB / 2n;
      expect(verify(topUpBuy(half), intentOf(dto), context({ coinsPerUtxoByte: half })).minUtxoTopUpLovelace).not.toBe('0');
      refusedBy('OUTPUTS', () => verify(topUpBuy(CPB), intentOf(dto), context({ coinsPerUtxoByte: half })));
    });

    it('never goes above the reviewed 4310, so an inflated value cannot make the verifier demand an overpayment', () => {
      const inflated = CPB * 10n;
      // A buy that pays the min-UTxO of an inflated parameter is refused, whatever the context says.
      refusedBy('OUTPUTS', () => verify(topUpBuy(inflated), intentOf(dto), context({ coinsPerUtxoByte: inflated })));
      refusedBy('OUTPUTS', () => verify(topUpBuy(CPB * 2n), intentOf(dto), context({ coinsPerUtxoByte: CPB * 2n })));
      // The honest buy is accepted whether the context carries 4310 or something above it.
      expect(verify(topUpBuy(CPB), intentOf(dto), context({ coinsPerUtxoByte: inflated })).minUtxoTopUpLovelace).not.toBe('0');
    });

    it('refuses a parameter that is not a positive integer', () => {
      refusedBy('OUTPUTS', () => verify(topUpBuy(CPB), intentOf(dto), context({ coinsPerUtxoByte: 0n })));
      refusedBy('OUTPUTS', () => verify(topUpBuy(CPB), intentOf(dto), context({ coinsPerUtxoByte: -1n })));
    });
  });

  describe("min-UTxO is measured on the output's canonical encoding, not on the builder's bytes", () => {
    const hexLen = (h: string) => h.length / 2;
    const bytesHead = (n: number) => (n < 24 ? (0x40 + n).toString(16).padStart(2, '0') : n < 0x100 ? `58${hex2(n)}` : n < 0x10000 ? `59${n.toString(16).padStart(4, '0')}` : `5a${n.toString(16).padStart(8, '0')}`);

    /** A tagged ADA output whose inline datum is an indefinite byte string padded with `chunks` empty chunks. */
    function paddedTagOutput(address: string, coin: bigint, chunks: number): string {
      const addr = String(Cardano.Address.fromBech32(address).toBytes());
      const inner = `5f${'40'.repeat(chunks)}5820${tagOf()}ff`;
      return `a300${bytesHead(hexLen(addr))}${addr}011a${coin.toString(16).padStart(8, '0')}028201d818${bytesHead(hexLen(inner))}${inner}`;
    }

    /** A balanced buy whose royalty output is that padded output, paid the "min-UTxO" of its padded bytes. */
    function paddedRoyaltyBuy(chunks: number) {
      const datum = withDatum({ royalties: [{ address: ROYALTY_ADDRESS, lovelace: 1n * ADA }] });
      const rawMin = BigInt(160 + hexLen(paddedTagOutput(ROYALTY_ADDRESS, 0n, chunks))) * CPB;
      const core = validBuy({ datum });
      core.body.outputs[ROYALTY_OUT].value.coins = rawMin;
      const change = core.body.outputs[CHANGE_OUT];
      const others = core.body.outputs.slice(0, -1).reduce((sum, o) => sum + o.value.coins, 0n);
      change.value.coins = BUYER_COINS + DEPOSIT - others - core.body.fee;
      const serialized = Serialization.Transaction.fromCore(core);
      const body = serialized.body();
      const outputs = body.outputs();
      outputs[ROYALTY_OUT] = Serialization.TransactionOutput.fromCbor(HexBlob(paddedTagOutput(ROYALTY_ADDRESS, rawMin, chunks)));
      body.setOutputs(outputs);
      serialized.setBody(body);
      return { datum, rawMin, built: { cbor: serialized.toCbor(), id: serialized.getId() } };
    }

    it('refuses a royalty padded to a 40 ADA "min-UTxO top-up", though the datum and the tag read the same', () => {
      const { datum, rawMin, built } = paddedRoyaltyBuy(10_000);
      // The premise: the output the transaction carries is the padded one, it still holds the tag,
      // and its own bytes put the ledger's min-UTxO far above the canonical 1,155,080 lovelace.
      const back = Serialization.Transaction.fromCbor(HexBlob(built.cbor));
      expect(hexLen(back.body().outputs()[ROYALTY_OUT].toCbor())).toBeGreaterThan(10_000);
      expect(rawMin).toBeGreaterThan(40n * ADA);
      expect(paidTo(ROYALTY_ADDRESS, 1n * ADA)).toBe(1_155_080n);
      refusedBy('OUTPUTS', () => verify(built, intentOf(listingDto(datum))));
    });

    it('refuses a small padding too (a few empty chunks), and any other bytes beyond the canonical form', () => {
      const { datum, built } = paddedRoyaltyBuy(10);
      refusedBy('OUTPUTS', () => verify(built, intentOf(listingDto(datum))));
    });
  });
});

describe('verifyBuy: the royalty outputs', () => {
  const TWO = withDatum({ royalties: [...ROYALTIES, { address: ROYALTY_ADDRESS_2, lovelace: 2n * ADA }] });
  const twoDto = listingDto(TWO);
  const buyTwo = (edit: (tx: Cardano.Tx) => void = () => undefined) => buyTx(edit, { datum: TWO });
  const verifyTwo = (tx: Built) => verify(tx, intentOf(twoDto));

  it('refuses a royalty short by 1 lovelace, or overpaid by 1 lovelace', () => {
    refusedBy('OUTPUTS', () => verify(balancedBuyTx((tx) => { tx.body.outputs[ROYALTY_OUT].value.coins -= 1n; })));
    refusedBy('OUTPUTS', () => verify(balancedBuyTx((tx) => { tx.body.outputs[ROYALTY_OUT].value.coins += 1n; })));
  });

  it('refuses a royalty overpaid by 3 ADA', () => {
    refusedBy('OUTPUTS', () => verify(balancedBuyTx((tx) => { tx.body.outputs[ROYALTY_OUT].value.coins += 3n * ADA; })));
  });

  it('refuses royalties paid in another order than the datum\'s', () => {
    refusedBy('OUTPUTS', () => verifyTwo(buyTwo((tx) => {
      const [a, b] = [tx.body.outputs[ROYALTY_OUT], tx.body.outputs[ROYALTY_OUT + 1]];
      tx.body.outputs[ROYALTY_OUT] = b;
      tx.body.outputs[ROYALTY_OUT + 1] = a;
    })));
  });

  it('refuses a royalty output with another listing\'s tag, or untagged', () => {
    refusedBy('OUTPUTS', () => verify(buyTx((tx) => { tx.body.outputs[ROYALTY_OUT].datum = tagDatum(OTHER_LISTING_TX, 0); })));
    refusedBy('OUTPUTS', () => verify(buyTx((tx) => { delete tx.body.outputs[ROYALTY_OUT].datum; })));
  });

  it('refuses a transaction that leaves a royalty out', () => {
    refusedBy('OUTPUTS', () => verifyTwo(buyTwo((tx) => { tx.body.outputs.splice(ROYALTY_OUT + 1, 1); })));
  });

  it("raises a royalty under its min-UTxO to it, reports the top-up, and refuses any other amount", () => {
    const small = withDatum({ royalties: [{ address: ROYALTY_ADDRESS, lovelace: 500_000n }] });
    const dto = listingDto(small);
    const min = paidTo(ROYALTY_ADDRESS, 500_000n);
    expect(min).toBeGreaterThan(1_000_000n);
    const summary = verify(buyTx(undefined, { datum: small }), intentOf(dto));
    expect(summary.minUtxoTopUpLovelace).toBe((min - 500_000n).toString());
    expect(summary.totalOutflowLovelace).toBe((PRICE + NETWORK_FEE + min - 500_000n).toString());
    refusedBy('OUTPUTS', () => verify(balancedBuyTx((t) => { t.body.outputs[ROYALTY_OUT].value.coins = min + 3n * ADA; }, { datum: small }), intentOf(dto)));
    refusedBy('OUTPUTS', () => verify(balancedBuyTx((t) => { t.body.outputs[ROYALTY_OUT].value.coins = min + 1n; }, { datum: small }), intentOf(dto)));
    refusedBy('OUTPUTS', () => verify(balancedBuyTx((t) => { t.body.outputs[ROYALTY_OUT].value.coins = 500_000n; }, { datum: small }), intentOf(dto)));
  });
});

describe('verifyBuy: the fee output', () => {
  it('refuses a fee short by 1 lovelace', () => {
    refusedBy('OUTPUTS', () => verify(balancedBuyTx((tx) => { tx.body.outputs[FEE_OUT].value.coins -= 1n; })));
  });

  it('refuses a fee overpaid by 1 lovelace or by 3 ADA (its min-UTxO is below the fee)', () => {
    refusedBy('OUTPUTS', () => verify(balancedBuyTx((tx) => { tx.body.outputs[FEE_OUT].value.coins += 1n; })));
    refusedBy('OUTPUTS', () => verify(balancedBuyTx((tx) => { tx.body.outputs[FEE_OUT].value.coins += 3n * ADA; })));
  });

  it('refuses a fee output to the fee payment key with another stake part', () => {
    refusedBy('OUTPUTS', () => verify(buyTx((tx) => { tx.body.outputs[FEE_OUT].address = Cardano.PaymentAddress(withStake(FEE_ADDRESS, '99'.repeat(28))); })));
  });

  it('refuses a transaction with no fee output', () => {
    refusedBy('OUTPUTS', () => verify(buyTx((tx) => {
      tx.body.outputs.splice(FEE_OUT, 1);
      tx.witness.redeemers = [purchase(LISTING_SORTED, 0)];
    })));
  });

  it('refuses a fee split over two outputs, so the min-UTxO allowance cannot be multiplied', () => {
    refusedBy('OUTPUTS', () => verify(buyTx((tx) => {
      tx.body.outputs[FEE_OUT].value.coins -= 1_000_000n;
      tx.body.outputs.splice(FEE_OUT + 1, 0, payOut(FEE_ADDRESS, 1_000_000n, null));
      tx.witness.redeemers = [purchase(LISTING_SORTED, 2)];
    })));
  });

  it('refuses a fee output with a datum or a token', () => {
    refusedBy('OUTPUTS', () => verify(buyTx((tx) => { tx.body.outputs[FEE_OUT].datum = tagDatum(); })));
    refusedBy('OUTPUTS', () => verify(buyTx((tx) => { tx.body.outputs[FEE_OUT].value.assets = assetMap(UNIT_222); })));
  });

  it("wants its own fee output even when the seller's address is the fee address", () => {
    const toFeeAddress = withDatum({ sellerAddress: FEE_ADDRESS });
    const dto = listingDto(toFeeAddress);
    // A seller output at the fee address does not stand in for the untagged fee output.
    refusedBy('OUTPUTS', () => verify(buyTx((tx) => {
      tx.body.outputs.splice(FEE_OUT, 1);
      tx.witness.redeemers = [purchase(LISTING_SORTED, 0)];
    }, { datum: toFeeAddress }), intentOf(dto)));
    // With both, it is a valid buy.
    expect(verify(buyTx(undefined, { datum: toFeeAddress }), intentOf(dto)).totalOutflowLovelace).toBe('100400000');
  });
});

describe('verifyBuy: every other output is the wallet\'s', () => {
  it('refuses an extra output to a foreign address', () => {
    refusedBy('OUTPUTS', () => verify(balancedBuyTx((tx) => { tx.body.outputs.splice(CHANGE_OUT, 0, payOut(STRANGER, 2n * ADA, null)); })));
  });

  it('refuses a second output to the seller after the payee group, which the contract would ignore', () => {
    refusedBy('OUTPUTS', () => verify(balancedBuyTx((tx) => { tx.body.outputs.splice(CHANGE_OUT, 0, payOut(SELLER_ADDRESS, 1_200_000n, null)); })));
  });

  it('refuses an extra output to a foreign address that pays the NFT away', () => {
    refusedBy('OUTPUTS', () => verify(buyTx((tx) => { tx.body.outputs[NFT_OUT].address = Cardano.PaymentAddress(STRANGER); })));
  });

  it('refuses an own output with a datum or a reference script', () => {
    refusedBy('OUTPUTS', () => verify(buyTx((tx) => { tx.body.outputs[CHANGE_OUT].datum = tagDatum(); })));
    refusedBy('OUTPUTS', () => verify(buyTx((tx) => {
      tx.body.outputs[CHANGE_OUT].scriptReference = { __type: Cardano.ScriptType.Plutus, bytes: HexBlob('4e4d01000033222220051200120011'), version: Cardano.PlutusLanguageVersion.V3 } as Cardano.Script;
    })));
  });

  it('refuses an output to a script address of the wallet\'s own stake key (a new listing)', () => {
    const listingAddress = baseAddress(TESTNET, V1.scriptHash, BUYER_STAKE, true);
    refusedBy('OUTPUTS', () => verify(buyTx((tx) => { tx.body.outputs[CHANGE_OUT].address = Cardano.PaymentAddress(listingAddress); })));
  });

  it('refuses an output on another network', () => {
    refusedBy('NETWORK', () => verify(buyTx((tx) => { tx.body.outputs[CHANGE_OUT].address = Cardano.PaymentAddress(baseAddress(MAINNET, BUYER_PAY_B, BUYER_STAKE)); })));
  });

  it('refuses a transaction that does not deliver the NFT to the buyer address', () => {
    // The NFT goes to the change address instead of the address the buyer asked for.
    refusedBy('OUTPUTS', () => verify(buyTx((tx) => {
      tx.body.outputs[NFT_OUT].address = Cardano.PaymentAddress(BUYER_CHANGE);
    })));
    // No output carries it.
    refusedBy('OUTPUTS', () => verify(buyTx((tx) => { delete tx.body.outputs[NFT_OUT].value.assets; })));
  });

  it('refuses a buyer address that is not the wallet\'s', () => {
    refusedBy('OUTPUTS', () => verify(buyTx(), { ...INTENT, buyerAddress: STRANGER }));
  });

  it('refuses the wrong NFT in the buyer\'s output', () => {
    const other = `${'bb'.repeat(28)}${NAME}`;
    refusedBy('OUTPUTS', () => verify(buyTx((tx) => { tx.body.outputs[NFT_OUT].value.assets = assetMap(other); })));
  });
});

describe("verifyBuy: the buyer's net cost", () => {
  it('refuses a buy in which the buyer funds the deposit as well (the deposit is the listing input\'s ADA)', () => {
    // The payees are paid as usual, but the listing input is taken to bring no ADA: the change
    // output shrinks by the deposit, so the buyer pays price + deposit + fee.
    const tx = buyTx((t) => { t.body.outputs[CHANGE_OUT].value.coins -= DEPOSIT; });
    refusedBy('OUTPUTS', () => verify(tx));
  });

  it('refuses a buy that costs the buyer 1 lovelace more than the price and the network fee', () => {
    refusedBy('OUTPUTS', () => verify(buyTx((tx) => { tx.body.outputs[CHANGE_OUT].value.coins -= 1n; })));
  });

  it("refuses a buy whose deposit is not the listing's (it would fail on chain for the seller's due)", () => {
    // The listing UTxO holds 3 ADA while Nexus said 2: the transaction pays the seller 2 ADA of
    // deposit and the change output absorbs the third, so the buyer costs 1 ADA less than the price.
    refusedBy('OUTPUTS', () => verify(buyTx((tx) => { tx.body.outputs[CHANGE_OUT].value.coins += ADA; })));
  });

  it('counts an own input only once and ignores the listing input\'s value', () => {
    const summary = verify(buyTx());
    expect(summary.totalOutflowLovelace).toBe((PRICE + NETWORK_FEE).toString());
  });
});

describe('verifyBuy: the listing', () => {
  it('refuses a private listing', () => {
    const priv = withDatum({ buyer: BUYER_PAY });
    refusedBy('PRIVATE_LISTING', () => verify(buyTx(), intentOf(listingDto(priv))));
  });

  it('refuses a private listing that Nexus presented as public, once the chain says so', () => {
    const priv = withDatum({ buyer: BUYER_PAY });
    const chain = { ...CHAIN, inlineDatumCbor: listingDatumHex(priv) };
    refusedBy('PRIVATE_LISTING', () => verify(buyTx(), intentOf(LISTING, chain)));
  });

  it('refuses a listing whose seller share is zero or below (it can never be bought)', () => {
    // 3.5 ADA with a 2 ADA royalty: fee 1.5, share 0 (docs/rules.md P2).
    const zero = withDatum({ price: 3_500_000n, royalties: [{ address: ROYALTY_ADDRESS, lovelace: 2n * ADA }] });
    expect(sellerShare(zero, V1)).toBe(0n);
    refusedBy('DATUM', () => verify(buyTx(), intentOf(listingDto(zero))));
    const negative = withDatum({ price: 10n * ADA, royalties: [{ address: ROYALTY_ADDRESS, lovelace: 9n * ADA }] });
    refusedBy('DATUM', () => verify(buyTx(), intentOf(listingDto(negative))));
  });

  it('refuses a listing with a zero or negative royalty', () => {
    const zero = withDatum({ royalties: [{ address: ROYALTY_ADDRESS, lovelace: 0n }] });
    refusedBy('DATUM', () => verify(buyTx(), intentOf(listingDto(zero))));
    const negative = withDatum({ royalties: [{ address: ROYALTY_ADDRESS, lovelace: -ADA }] });
    // The datum decodes (the codec accepts any integer), so it is the buy check that refuses it.
    expect(decodeListingDatum(listingDatumHex(negative), TESTNET).royalties[0].lovelace).toBe(-ADA);
    refusedBy('DATUM', () => verify(buyTx(), intentOf(listingDto(negative))));
  });

  it('refuses a datum that is not a Gero listing', () => {
    refusedBy('DATUM', () => verify(buyTx(), intentOf({ ...LISTING, datumCbor: '182a' })));
    refusedBy('DATUM', () => verify(buyTx(), intentOf({ ...LISTING, datumCbor: `${LISTING.datumCbor}00` })));
    refusedBy('DATUM', () => verify(buyTx(), intentOf({ ...LISTING, datumCbor: 'zz' })));
  });

  it('refuses a row whose fields disagree with its datum', () => {
    refusedBy('DATUM', () => verify(buyTx(), intentOf({ ...LISTING, priceLovelace: '90000000' })));
    refusedBy('DATUM', () => verify(buyTx(), intentOf({ ...LISTING, sellerAddress: STRANGER })));
    refusedBy('DATUM', () => verify(buyTx(), intentOf({ ...LISTING, ownerPkh: '3c'.repeat(28) })));
    refusedBy('DATUM', () => verify(buyTx(), intentOf({ ...LISTING, royalties: [{ address: ROYALTY_ADDRESS, lovelace: '4000000' }] })));
    refusedBy('DATUM', () => verify(buyTx(), intentOf({ ...LISTING, royalties: [] })));
  });

  it('refuses a listing at a script that is not a reviewed deployment, or at the wrong version', () => {
    refusedBy('LISTING', () => verify(buyTx(), intentOf({ ...LISTING, scriptHash: 'ee'.repeat(28) })));
    refusedBy('LISTING', () => verify(buyTx(), intentOf({ ...LISTING, version: 2 })));
    refusedBy('LISTING', () => verify(buyTx(), intentOf({ ...LISTING, version: 7 })));
  });

  it('refuses a malformed listing row', () => {
    refusedBy('LISTING', () => verify(buyTx(), intentOf({ ...LISTING, txHash: 'b1' })));
    refusedBy('LISTING', () => verify(buyTx(), intentOf({ ...LISTING, outputIndex: -1 })));
    refusedBy('LISTING', () => verify(buyTx(), intentOf({ ...LISTING, depositLovelace: '2.5' })));
    refusedBy('LISTING', () => verify(buyTx(), intentOf({ ...LISTING, unit: `${POLICY}00` })));
    refusedBy('LISTING', () => verify(buyTx(), intentOf(undefined as unknown as ListingDto)));
  });

  it('refuses a CIP-68 reference token, which is not an NFT to own', () => {
    const reference = listingDto(DATUM, { unit: UNIT_100, assetName: `000643b0${NAME}` });
    const tx = buyTx((t) => { t.body.outputs[NFT_OUT].value.assets = assetMap(UNIT_100); });
    refusedBy('NFT', () => verify(tx, intentOf(reference)));
  });

  it('refuses a market with no deployment on the network', () => {
    refusedBy('NETWORK', () => verify(buyTx(), INTENT, context({ deployments: [] })));
  });
});

describe('verifyBuy: what the transaction spends', () => {
  it('refuses a transaction that does not spend the listing', () => {
    refusedBy('INPUTS', () => verify(buyTx(), intentOf(listingDto(DATUM, { outputIndex: 1 }))));
  });

  it('refuses a UTxO that is not the wallet\'s', () => {
    refusedBy('INPUTS', () => verify(buyTx((tx) => { tx.body.inputs.push(txIn(STRANGER_TX, 0)); })));
  });

  it('refuses a second listing as an input, whoever owns it', () => {
    const second = `${OTHER_LISTING_TX}#0`;
    refusedBy('INPUTS', () => verify(buyTx((tx) => { tx.body.inputs.push(refIn(second)); })));
    const own = { ref: second } as OwnListing;
    refusedBy('INPUTS', () => verify(buyTx((tx) => { tx.body.inputs.push(refIn(second)); }), INTENT, context({ ownListings: new Map([[second, own]]), ownUtxos: [BUYER_UTXO, utxo(OTHER_LISTING_TX, 0, BUYER_CHANGE, 5n * ADA)] })));
  });

  it('refuses the lent pool UTxO as an input', () => {
    const ctx = context({ sponsoredCollateralRef: SPONSORED_REF });
    refusedBy('INPUTS', () => verify(buyTx((tx) => { tx.body.inputs.push(refIn(SPONSORED_REF)); }), INTENT, ctx));
  });

  it('refuses an input listed twice', () => {
    refusedBy('INPUTS', () => verify(buyTx((tx) => { tx.body.inputs.push(BUYER_IN); })));
  });

  it("refuses reference inputs other than exactly the listing's deployment script", () => {
    refusedBy('INPUTS', () => verify(buyTx((tx) => { tx.body.referenceInputs = [refIn(V2.referenceScript)]; })));
    refusedBy('INPUTS', () => verify(buyTx((tx) => { tx.body.referenceInputs = [refIn(V1.referenceScript), refIn(V2.referenceScript)]; })));
    refusedBy('INPUTS', () => verify(buyTx((tx) => { delete tx.body.referenceInputs; })));
  });
});

describe('verifyBuy: the redeemer', () => {
  it('refuses a Cancel redeemer', () => {
    refusedBy('REDEEMERS', () => verify(buyTx((tx) => { tx.witness.redeemers = [redeemer(Cardano.RedeemerPurpose.spend, LISTING_SORTED, 'd87a80')]; })));
  });

  it('refuses a redeemer on another input than the listing', () => {
    refusedBy('REDEEMERS', () => verify(buyTx((tx) => { tx.witness.redeemers = [purchase(0, 1)]; })));
  });

  it('refuses no redeemer, two redeemers, and a redeemer of another purpose', () => {
    refusedBy('REDEEMERS', () => verify(buyTx((tx) => { tx.witness.redeemers = []; })));
    refusedBy('REDEEMERS', () => verify(buyTx((tx) => { tx.witness.redeemers = [purchase(LISTING_SORTED, 1), purchase(0, 1)]; })));
    refusedBy('REDEEMERS', () => verify(buyTx((tx) => { tx.witness.redeemers = [redeemer(Cardano.RedeemerPurpose.mint, 0, 'd8799f01ff')]; })));
  });

  it('refuses a Purchase with the wrong shape', () => {
    refusedBy('REDEEMERS', () => verify(buyTx((tx) => { tx.witness.redeemers = [redeemer(Cardano.RedeemerPurpose.spend, LISTING_SORTED, 'd8799f0102ff')]; })));
    refusedBy('REDEEMERS', () => verify(buyTx((tx) => { tx.witness.redeemers = [redeemer(Cardano.RedeemerPurpose.spend, LISTING_SORTED, 'd87b9f01ff')]; })));
    refusedBy('REDEEMERS', () => verify(buyTx((tx) => { tx.witness.redeemers = [redeemer(Cardano.RedeemerPurpose.spend, LISTING_SORTED, '01')]; })));
  });

  it('refuses a first_output that is negative or past the payee group', () => {
    refusedBy('REDEEMERS', () => verify(buyTx((tx) => { tx.witness.redeemers = [redeemer(Cardano.RedeemerPurpose.spend, LISTING_SORTED, 'd8799f20ff')]; })));
    refusedBy('REDEEMERS', () => verify(buyTx((tx) => { tx.witness.redeemers = [purchase(LISTING_SORTED, 5)]; })));
    refusedBy('REDEEMERS', () => verify(buyTx((tx) => { tx.witness.redeemers = [purchase(LISTING_SORTED, 4)]; })));
  });

  it("refuses a first_output that points the contract at the wrong outputs", () => {
    // 0 would take the fee output as the seller's.
    refusedBy('OUTPUTS', () => verify(buyTx((tx) => { tx.witness.redeemers = [purchase(LISTING_SORTED, 0)]; })));
    refusedBy('OUTPUTS', () => verify(buyTx((tx) => { tx.witness.redeemers = [purchase(LISTING_SORTED, 2)]; })));
  });

  it('reads the redeemer index in the ledger\'s input order, not the body\'s', () => {
    // Body order is [LISTING, BUYER]; the listing is index 1 once sorted. Index 0 is the buyer's UTxO.
    expect(LISTING_SORTED).toBe(1);
    expect(verify(buyTx()).ref).toBe(LISTING_REF);
  });
});

describe('verifyBuy: signers, collateral, fee and the envelope', () => {
  it('refuses a required signer (a public listing needs none)', () => {
    refusedBy('SIGNERS', () => verify(buyTx((tx) => { tx.body.requiredExtraSignatures = [Ed25519KeyHashHex(BUYER_PAY)]; })));
    refusedBy('SIGNERS', () => verify(buyTx((tx) => { tx.body.requiredExtraSignatures = [Ed25519KeyHashHex(SELLER_PKH)]; })));
  });

  it('refuses collateral that puts too much of the wallet\'s ADA at risk', () => {
    const risk = NFT_MARKET_MAX_COLLATERAL_LOVELACE + ADA;
    refusedBy('COLLATERAL', () => verify(buyTx((tx) => {
      tx.body.collateralReturn = { address: Cardano.PaymentAddress(BUYER_CHANGE), value: { coins: BUYER_COINS - risk } };
      tx.body.totalCollateral = risk;
    })));
  });

  it('refuses collateral that is neither the wallet\'s nor the lent pool UTxO, and missing collateral', () => {
    refusedBy('COLLATERAL', () => verify(buyTx((tx) => { tx.body.collaterals = [refIn(SPONSORED_REF)]; delete tx.body.collateralReturn; delete tx.body.totalCollateral; })));
    refusedBy('COLLATERAL', () => verify(buyTx((tx) => { delete tx.body.collaterals; delete tx.body.collateralReturn; delete tx.body.totalCollateral; })));
  });

  it('refuses a collateral return to another address', () => {
    refusedBy('COLLATERAL', () => verify(buyTx((tx) => { tx.body.collateralReturn = { address: Cardano.PaymentAddress(STRANGER), value: { coins: BUYER_COINS - 2n * ADA } }; })));
  });

  it('refuses a network fee above the cap', () => {
    refusedBy('FEE', () => verify(buyTx((tx) => { tx.body.fee = NFT_MARKET_MAX_FEE_LOVELACE + 1n; })));
  });

  it('refuses a validity window with no bounds, one bound, or a width above one hour', () => {
    refusedBy('FORBIDDEN_FIELD', () => verify(buyTx((tx) => { delete tx.body.validityInterval; })));
    refusedBy('FORBIDDEN_FIELD', () => verify(buyTx((tx) => { tx.body.validityInterval = { invalidBefore: Cardano.Slot(1000) }; })));
    refusedBy('FORBIDDEN_FIELD', () => verify(buyTx((tx) => { tx.body.validityInterval = { invalidHereafter: Cardano.Slot(5000) }; })));
    refusedBy('FORBIDDEN_FIELD', () => verify(buyTx((tx) => {
      tx.body.validityInterval = { invalidBefore: Cardano.Slot(1000), invalidHereafter: Cardano.Slot(1000 + NFT_MARKET_MAX_VALIDITY_SLOTS + 1) };
    })));
  });

  it('refuses the fields a buy never uses', () => {
    refusedBy('FORBIDDEN_FIELD', () => verify(buyTx((tx) => { tx.body.mint = assetMap(UNIT_222); })));
    refusedBy('FORBIDDEN_FIELD', () => verify(buyTx((tx) => { tx.body.withdrawals = [{ stakeAddress: REWARD_ACCOUNT, quantity: 0n }]; })));
    refusedBy('FORBIDDEN_FIELD', () => verify(buyTx((tx) => { tx.isValid = false; })));
    refusedBy('FORBIDDEN_FIELD', () => verify(buyTx((tx) => { tx.body.donation = 1n; })));
  });

  it('refuses a transaction whose id is not the one Nexus reported', () => {
    const tx = buyTx();
    refusedBy('TX_ID', () => verifyBuy(tx.cbor, 'ee'.repeat(32), INTENT, context()));
    refusedBy('TX_ID', () => verifyBuy('00', tx.id, INTENT, context()));
  });

  it('refuses a body for another network', () => {
    refusedBy('NETWORK', () => verify(buyTx((tx) => { tx.body.networkId = MAINNET; })));
  });
});

describe('verifyBuy: the listing UTxO as the chain has it (rulings P28, P30)', () => {
  // The attack: Nexus supplies a datum that is a SUPERSET of the real one, same seller, the price
  // raised by 5 ADA and one extra royalty of 5 ADA to the attacker. The contract ignores trailing
  // outputs and accepts overpayment, so a buy paid out per the fake datum succeeds on chain.
  const REAL = withDatum({ royalties: [] });
  const FAKE = withDatum({ price: REAL.price + 5n * ADA, royalties: [{ address: STRANGER, lovelace: 5n * ADA }] });

  it('refuses a buy paid out per a superset datum Nexus made up, which the contract itself would accept', () => {
    const fakeBuy = buyTx(undefined, { datum: FAKE });
    // The seller output is the real due, so the contract is satisfied with the REAL datum too.
    const tx = validBuy({ datum: FAKE });
    expect(tx.body.outputs[SELLER_OUT].value.coins).toBe(sellerDue(REAL, V1, DEPOSIT));
    expect(tx.body.outputs[ROYALTY_OUT].address).toBe(STRANGER);
    // Taken at Nexus's word it passes every other check; against the chain's datum it does not.
    expect(verify(fakeBuy, intentOf(listingDto(FAKE))).priceLovelace).toBe('105000000');
    refusedBy('DATUM', () => verify(fakeBuy, intentOf(listingDto(FAKE), chainFrom(listingDto(REAL)))));
  });

  it('accepts the buy when the chain and the row agree', () => {
    expect(verify(buyTx(), intentOf(LISTING, CHAIN)).ref).toBe(LISTING_REF);
  });

  it.each([
    ['another owner', { owner: '3c'.repeat(28) }],
    ['another seller address', { sellerAddress: STRANGER }],
    ['another price', { price: PRICE + 1n }],
    ['another royalty amount', { royalties: [{ address: ROYALTY_ADDRESS, lovelace: 5n * ADA + 1n }] }],
    ['another royalty address', { royalties: [{ address: ROYALTY_ADDRESS_2, lovelace: 5n * ADA }] }],
    ['an extra royalty', { royalties: [...ROYALTIES, { address: ROYALTY_ADDRESS_2, lovelace: 1n * ADA }] }],
    ['no royalty', { royalties: [] }],
  ] as [string, Partial<ListingDatum>][])('refuses a chain datum with %s', (_name, patch) => {
    const chain = { ...CHAIN, inlineDatumCbor: listingDatumHex(withDatum(patch)) };
    refusedBy('DATUM', () => verify(buyTx(), intentOf(LISTING, chain)));
  });

  it('refuses royalties in another order on chain', () => {
    const two = withDatum({ royalties: [...ROYALTIES, { address: ROYALTY_ADDRESS_2, lovelace: 2n * ADA }] });
    const swapped = withDatum({ royalties: [two.royalties[1], two.royalties[0]] });
    const chain = { ...chainFrom(listingDto(two)), inlineDatumCbor: listingDatumHex(swapped) };
    refusedBy('DATUM', () => verify(buyTx(undefined, { datum: two }), intentOf(listingDto(two), chain)));
  });

  it('refuses a chain UTxO with no inline datum, or one that is not a Gero listing', () => {
    refusedBy('DATUM', () => verify(buyTx(), intentOf(LISTING, { ...CHAIN, inlineDatumCbor: null })));
    refusedBy('DATUM', () => verify(buyTx(), intentOf(LISTING, { ...CHAIN, inlineDatumCbor: '182a' })));
    refusedBy('DATUM', () => verify(buyTx(), intentOf(LISTING, { ...CHAIN, inlineDatumCbor: `${listingDatumHex(DATUM)}00` })));
  });

  it('refuses a chain UTxO that holds another amount of ADA than the deposit', () => {
    refusedBy('LISTING', () => verify(buyTx(), intentOf(LISTING, { ...CHAIN, lovelace: DEPOSIT + 1n })));
    refusedBy('LISTING', () => verify(buyTx(), intentOf(LISTING, { ...CHAIN, lovelace: DEPOSIT - 1n })));
  });

  it('refuses a chain UTxO that does not hold exactly the one NFT', () => {
    const other = `${'bb'.repeat(28)}${NAME}`;
    refusedBy('NFT', () => verify(buyTx(), intentOf(LISTING, { ...CHAIN, assets: [{ unit: other, quantity: 1n }] })));
    refusedBy('NFT', () => verify(buyTx(), intentOf(LISTING, { ...CHAIN, assets: [{ unit: UNIT_222, quantity: 2n }] })));
    refusedBy('NFT', () => verify(buyTx(), intentOf(LISTING, { ...CHAIN, assets: [] })));
    refusedBy('NFT', () => verify(buyTx(), intentOf(LISTING, { ...CHAIN, assets: [{ unit: UNIT_222, quantity: 1n }, { unit: other, quantity: 1n }] })));
  });

  it("refuses a chain UTxO that is not at the listing's deployment script on this network", () => {
    const at = (payment: string, isScript: boolean, network = TESTNET) => baseAddress(network, payment, '2c'.repeat(28), isScript);
    refusedBy('LISTING', () => verify(buyTx(), intentOf(LISTING, { ...CHAIN, address: at(V2.scriptHash, true) })));
    refusedBy('LISTING', () => verify(buyTx(), intentOf(LISTING, { ...CHAIN, address: at(V1.scriptHash, false) })));
    refusedBy('LISTING', () => verify(buyTx(), intentOf(LISTING, { ...CHAIN, address: at(V1.scriptHash, true, MAINNET) })));
    refusedBy('LISTING', () => verify(buyTx(), intentOf(LISTING, { ...CHAIN, address: 'not an address' })));
  });

  it('refuses a chain read made for another out-ref than the listing being bought', () => {
    // A UTxO that looks exactly right (script, deposit, NFT, datum), read for a neighbour.
    refusedBy('LISTING', () => verify(buyTx(), intentOf(LISTING, { ...CHAIN, ref: `${OTHER_LISTING_TX}#0` })));
    refusedBy('LISTING', () => verify(buyTx(), intentOf(LISTING, { ...CHAIN, ref: `${LISTING_TX}#1` })));
    refusedBy('LISTING', () => verify(buyTx(), intentOf(LISTING, { ...CHAIN, ref: LISTING_REF.toUpperCase() })));
    refusedBy('LISTING', () => verify(buyTx(), intentOf(LISTING, { ...CHAIN, ref: '' })));
    refusedBy('LISTING', () => verify(buyTx(), intentOf(LISTING, { ...CHAIN, ref: undefined as unknown as string })));
    // The right ref is accepted.
    expect(verify(buyTx(), intentOf(LISTING, { ...CHAIN, ref: LISTING_REF })).ref).toBe(LISTING_REF);
  });

  it('requires the on-chain read: without it nothing is bought', () => {
    refusedBy('LISTING', () => verify(buyTx(), { ...INTENT, chainUtxo: undefined as unknown as ListingChainUtxo }));
  });
});

describe('verifyBuy: the NFT comes from the listing, and the witness set is empty of scripts', () => {
  it("refuses a buy whose NFT is the buyer's own copy (the wallet's balance of it does not rise)", () => {
    const OWN_NFT_TX = 'e1'.repeat(32);
    const ownNft = utxo(OWN_NFT_TX, 0, BUYER_CHANGE, 2n * ADA, { [UNIT_222]: 1n });
    const tx = buyTx((t) => {
      t.body.inputs.push(txIn(OWN_NFT_TX, 0));
      t.body.outputs[CHANGE_OUT].value.coins += 2n * ADA;
    });
    refusedBy('NFT', () => verify(tx, INTENT, context({ ownUtxos: [BUYER_UTXO, ownNft] })));
    // The same transaction without the buyer's own copy is a plain buy.
    expect(verify(buyTx(), INTENT, context({ ownUtxos: [BUYER_UTXO, ownNft] })).ref).toBe(LISTING_REF);
  });

  it.each([
    ['a datum', (tx: Cardano.Tx) => { tx.witness.datums = [plutusData('182a')]; }],
    ['a native script', (tx: Cardano.Tx) => { tx.witness.scripts = [{ __type: Cardano.ScriptType.Native, kind: Cardano.NativeScriptKind.RequireAllOf, scripts: [] } as Cardano.Script]; }],
    ['a Plutus V3 script', (tx: Cardano.Tx) => { tx.witness.scripts = [{ __type: Cardano.ScriptType.Plutus, bytes: HexBlob('4e4d01000033222220051200120011'), version: Cardano.PlutusLanguageVersion.V3 } as Cardano.Script]; }],
    ['a Plutus V2 script', (tx: Cardano.Tx) => { tx.witness.scripts = [{ __type: Cardano.ScriptType.Plutus, bytes: HexBlob('4e4d01000033222220051200120011'), version: Cardano.PlutusLanguageVersion.V2 } as Cardano.Script]; }],
    ['a Plutus V1 script', (tx: Cardano.Tx) => { tx.witness.scripts = [{ __type: Cardano.ScriptType.Plutus, bytes: HexBlob('4e4d01000033222220051200120011'), version: Cardano.PlutusLanguageVersion.V1 } as Cardano.Script]; }],
  ])('refuses %s in the witness set', (_name, edit) => {
    refusedBy('FORBIDDEN_FIELD', () => verify(buyTx(edit)));
  });
});
