// The wallet's own check of a Gero market list, reprice or cancel that Nexus built, before
// anything is signed (spec 5.7, 5.10). Pure and fail closed: every rule below either holds or the
// transaction is refused with a MarketVerifyError naming the rule. Nothing Nexus says about the
// transaction is trusted; only the CBOR is read, against what the user asked for.
//
// Why this is the wallet's job: the listing contract validates a listing only when it is SPENT.
// Nothing checks one when it is created, so a datum with the wrong owner, a seller address that is
// not the user's, a different price or other royalties is accepted on chain and loses the NFT (or
// its proceeds) at the first sale. The datum is therefore compared with the user's intent byte for
// byte of meaning before the wallet signs a list or a reprice.
//
// What a transaction that passes can do to the wallet:
//  - list: spend the wallet's own UTxOs; pay exactly one output to the NEWEST deployment's
//    listing script with the account's own stake key, holding the one NFT the user chose (never
//    a CIP-68 token of another label than (222)) and at most MAX_LISTING_DEPOSIT of ADA, with an inline
//    `Listing` datum that names the wallet's own payment key as owner, one of its own addresses as
//    seller, the price the user entered, exactly the royalties the worker computed and no buyer,
//    leaving the seller at least MIN_SELLER_SHARE; pay everything else to the wallet's own key
//    addresses; no script runs, there is no collateral and no required signer;
//  - reprice and cancel: spend exactly one of the wallet's own listings with the `Cancel`
//    redeemer, the listing's own deployment script as the only reference input, signed by exactly
//    the listing's owner (a key of the wallet), plus the wallet's own UTxOs for the fee; a cancel
//    returns the NFT to the return address and everything else to the wallet; a reprice pays the
//    same NFT and deposit back to the same listing address with the old datum except the price;
//  - pay a fee of at most NFT_MARKET_MAX_FEE_LOVELACE and, if a script fails anyway, lose at most
//    NFT_MARKET_MAX_COLLATERAL_LOVELACE of the wallet's own collateral, or none when it is the
//    Nexus pool UTxO Nexus said it lent;
//  - be valid for a window of at most NFT_MARKET_MAX_VALIDITY_SLOTS, and it must have one with
//    both bounds: a signed transaction never stays valid for longer than that.
// It cannot mint, burn, certify, withdraw, vote, propose, donate, carry metadata, spend another
// listing or any UTxO that is not the wallet's, or pay anyone but the wallet (and the one listing).

import { Cardano, Serialization } from '@cardano-sdk/core';
import { forEachAsset } from '@/api/nexusInputSelection';
import {
  checkCollateral,
  checkForbiddenFields,
  compareInputs,
  outputNetwork,
  paysOwnKey,
  readTransaction,
  refOf,
} from '@/chrome/txVerifyCommon';
import { listingFee, decodeListingDatum, sellerShare, type ListingDatum, type Payee } from '@/chrome/nftMarket/listingDatum';
import type { OwnListing } from '@/chrome/nftMarket/ownListings';
import {
  CIP68_USER_TOKEN_LABEL,
  MAX_LISTING_DEPOSIT,
  MAX_ROYALTIES,
  MIN_LIST_PRICE,
  MIN_SELLER_SHARE,
  NFT_MARKET_MAX_COLLATERAL_LOVELACE,
  NFT_MARKET_MAX_FEE_LOVELACE,
  NFT_MARKET_MAX_VALIDITY_SLOTS,
  NFT_UNIT_PATTERN as UNIT,
  POLICY_ID_HEX_LENGTH as POLICY_HEX_LENGTH,
  type NftMarketDeployment,
} from '@/utils/nftMarketDeployments';

export type MarketVerifyRule =
  | 'TX_ID'
  | 'NETWORK'
  | 'INPUTS'
  | 'OUTPUTS'
  | 'LISTING'
  | 'PRIVATE_LISTING'
  | 'DATUM'
  | 'NFT'
  | 'REDEEMERS'
  | 'SIGNERS'
  | 'COLLATERAL'
  | 'FEE'
  | 'FORBIDDEN_FIELD';

export class MarketVerifyError extends Error {
  constructor(readonly rule: MarketVerifyRule, detail: string) {
    super(`NFT market transaction refused (${rule}): ${detail}`);
    this.name = 'MarketVerifyError';
  }
}

/** Throws the market's error. A declaration, so control-flow analysis sees it never returns. */
function refuse(rule: MarketVerifyRule, detail: string): never {
  throw new MarketVerifyError(rule, detail);
}

/** What the wallet worker knows when it verifies a market transaction. */
export interface MarketVerifyContext {
  networkId: Cardano.NetworkId;
  /** Every configured deployment of the network (`resolveNftMarketDeployments`), newest first. */
  deployments: readonly NftMarketDeployment[];
  /** The wallet's own spendable UTxOs (fee inputs and own collateral must be among them). */
  ownUtxos: readonly Cardano.Utxo[];
  /** The wallet's own key addresses: every other output must go to one. */
  ownAddresses: ReadonlySet<string>;
  /** The wallet's own key hashes (payment, change and stake). */
  ownKeyHashes: ReadonlySet<string>;
  /** The wallet's verified own listings, by `txHash#index`. */
  ownListings: ReadonlyMap<string, OwnListing>;
  /**
   * The account's stake KEY hash (56 hex): the stake part of every listing this wallet makes or
   * reprices. Gero Sync finds a listing through it, so a listing under any other key (even
   * another key of the wallet) would be one the seller cannot see or cancel.
   */
  stakeKeyHash: string;
  /** `txHash#index` of the Nexus pool collateral, when Nexus said it lent one. */
  sponsoredCollateralRef?: string;
}

/** What the user asked to list. */
export interface ListIntent {
  /** Policy id and asset name, hex. */
  unit: string;
  price: bigint;
  /** Exactly the `royalties` array `computeRoyalties` returned for this list, in its order. */
  royalties: Payee[];
  /** The payment key hash that will sign a cancel (56 hex). */
  ownerPkh: string;
  /** One of the wallet's own addresses (bech32): where the proceeds and the deposit go. */
  sellerAddress: string;
  /** The wallet's stake KEY hash (56 hex): the listing address's stake part. */
  stakeCredential: string;
}

export interface PricedSummary {
  priceLovelace: string;
  marketFeeLovelace: string;
  royaltiesLovelace: string;
  sellerReceivesLovelace: string;
  depositLovelace: string;
  networkFeeLovelace: string;
}

/** What the review screen shows, read from the verified list transaction. */
export interface ListSummary extends PricedSummary {
  txId: string;
  unit: string;
  listingAddress: string;
  listingOutputIndex: number;
  deploymentVersion: number;
  royalties: { address: string; lovelace: string }[];
}

export interface RepriceSummary extends PricedSummary {
  txId: string;
  ref: string;
  unit: string;
  oldPriceLovelace: string;
  listingAddress: string;
  listingOutputIndex: number;
  deploymentVersion: number;
  sponsoredCollateralRef?: string;
}

export interface CancelSummary {
  txId: string;
  ref: string;
  unit: string;
  returnAddress: string;
  depositLovelace: string;
  networkFeeLovelace: string;
  sponsoredCollateralRef?: string;
}

/** `Constr 1 []`, the contract's `Cancel`, in either list encoding (the same Plutus data). */
const CANCEL_REDEEMER_CBOR: readonly string[] = ['d87a80', 'd87a9fff'];

// ---------------------------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------------------------

/**
 * Check `txCbor` against the list the user asked for and return what it does, or throw
 * MarketVerifyError. `txHash` is the id Nexus reported; it must equal the id computed here.
 */
export function verifyList(txCbor: string, txHash: string, intent: ListIntent, ctx: MarketVerifyContext): ListSummary {
  const { serialized, tx, txId } = readTransaction(txCbor, txHash, refuse);
  const body = tx.body;
  checkEnvelope(tx, ctx);

  // Inputs: only the wallet's own UTxOs. No listing, no reference input, no script.
  const inputRefs = new Set(body.inputs.map(refOf));
  if (inputRefs.size !== body.inputs.length) refuse('INPUTS', 'repeats an input');
  if (ctx.sponsoredCollateralRef && inputRefs.has(ctx.sponsoredCollateralRef)) refuse('INPUTS', 'spends the lent pool collateral');
  const ownByRef = ownUtxosByRef(ctx);
  for (const ref of inputRefs) {
    if (ctx.ownListings.has(ref)) refuse('INPUTS', `spends ${ref}, a listing, which a list never does`);
    // OX Agent: Authorization prevented by ownership check - a list spends only the wallet's own UTxOs
    if (!ownByRef.has(ref)) refuse('INPUTS', `spends ${ref}, which is not the wallet's`);
  }
  if ((body.referenceInputs ?? []).length > 0) refuse('INPUTS', 'has a reference input, which a list never needs');
  checkNoScripts(serialized, tx);

  // Required signers: none. A list is an ordinary payment; the keys that sign are those of its inputs.
  if ((body.requiredExtraSignatures ?? []).length > 0) refuse('SIGNERS', 'a list requires no signer');

  // Collateral: none (nothing runs).
  if ((body.collaterals ?? []).length > 0 || body.collateralReturn !== undefined || body.totalCollateral !== undefined) {
    refuse('COLLATERAL', 'a list runs no script and needs no collateral');
  }

  // Outputs: every one but the listing is the wallet's; exactly one is the new listing.
  const { listings } = checkOutputs(tx, ctx);
  if (listings.length !== 1) refuse('LISTING', 'must pay exactly one output to a listing script');
  const [listing] = listings;
  const facts = checkNewListing(serialized, listing.index, listing.out, listing.deployment, intent, ctx);

  checkFee(body.fee);

  const share = economics(facts.datum, facts.deployment);
  return {
    txId,
    unit: facts.unit,
    listingAddress: String(listing.out.address),
    listingOutputIndex: listing.index,
    deploymentVersion: facts.deployment.version,
    royalties: facts.datum.royalties.map((r) => ({ address: r.address, lovelace: r.lovelace.toString() })),
    ...priced(facts.datum.price, facts.depositLovelace, body.fee, share),
  };
}

export interface NewListingFacts {
  unit: string;
  datum: ListingDatum;
  deployment: NftMarketDeployment;
  depositLovelace: bigint;
}

/**
 * Check one output of `serialized` as the NEW listing for `intent` (spec 5.7): the address, the
 * value, the inline datum and the limits. Throws MarketVerifyError. Exported so the migrate
 * verifier holds the listing it creates to exactly the same rules.
 */
export function checkNewListing(
  serialized: Serialization.Transaction,
  index: number,
  out: Cardano.TxOut,
  at: NftMarketDeployment,
  intent: ListIntent,
  ctx: MarketVerifyContext,
): NewListingFacts {
  const newest = newestDeployment(ctx.deployments);
  const stakeKey = accountStakeKey(ctx);
  const unit = checkIntent(intent, ownPaymentKeyHashes(ctx.ownAddresses), stakeKey, ctx.ownAddresses);

  // Address: the NEWEST deployment's script, the account's own stake key.
  if (at.scriptHash !== newest.scriptHash) {
    refuse('LISTING', `a new listing goes to the newest deployment (v${newest.version}), not v${at.version}`);
  }
  // OX Agent: Authorization prevented by ownership check - the listing sits under the account's own stake key
  if (listingStakeKey(out, at) !== stakeKey) refuse('LISTING', "the listing's stake key is not the account's");
  if (out.scriptReference !== undefined) refuse('LISTING', 'the listing carries a reference script');

  // Value: the one NFT and a bounded deposit, nothing else.
  checkNftValue(out, unit);
  const deposit = out.value.coins;
  if (deposit <= 0n || deposit > MAX_LISTING_DEPOSIT) refuse('LISTING', 'the deposit is zero or above the cap');

  // Datum: the user's intent, exactly.
  const datum = readInlineDatum(serialized, index, out, ctx);
  // OX Agent: Authorization prevented by ownership check - the datum's owner and seller address are the wallet's own
  if (datum.owner !== intent.ownerPkh.toLowerCase()) refuse('DATUM', 'the owner is not the one asked for');
  if (!sameAddress(datum.sellerAddress, intent.sellerAddress)) refuse('DATUM', 'the seller address is not the one asked for');
  if (datum.price !== intent.price) refuse('DATUM', 'the price is not the one asked for');
  if (datum.price < MIN_LIST_PRICE) refuse('DATUM', 'the price is below the minimum');
  if (!sameRoyalties(datum.royalties, intent.royalties)) refuse('DATUM', 'the royalties are not exactly the ones computed');
  checkRoyaltyLimits(datum.royalties);
  if (datum.buyer !== null) refuse('DATUM', 'a listing names no buyer (public listings only)');
  if (sellerShare(datum, at) < MIN_SELLER_SHARE) refuse('DATUM', 'the seller would receive less than the minimum');

  return { unit, datum, deployment: at, depositLovelace: deposit };
}

/**
 * Validate what the user asked for and return the lower-case unit. `ownPayments` are the payment
 * key hashes of the wallet's own addresses, `stakeKey` the account's stake key hash.
 */
function checkIntent(
  intent: ListIntent,
  ownPayments: ReadonlySet<string>,
  stakeKey: string,
  ownAddresses: ReadonlySet<string>,
): string {
  const unit = typeof intent?.unit === 'string' ? intent.unit.toLowerCase() : '';
  if (!UNIT.test(unit)) refuse('NFT', 'the unit is not a policy id and an asset name');
  // A CIP-68 asset is listed only as its (222) user token. Every other label is
  // refused: (100) is the metadata reference, (333), (444) and (500) are fungible, rich-fungible
  // and royalty tokens, and an unknown label is none of the wallet's business to guess.
  const label = cip68Label(unit.slice(POLICY_HEX_LENGTH));
  if (label !== null && label !== CIP68_USER_TOKEN_LABEL) refuse('NFT', `a CIP-68 token with label (${label}) is not a listable NFT`);
  if (typeof intent.price !== 'bigint') refuse('DATUM', 'the price is not an integer');
  // OX Agent: Authorization prevented by ownership check - the proceeds go to one of the wallet's own addresses
  if (!ownAddresses.has(String(intent.sellerAddress ?? ''))) refuse('DATUM', "the seller address is not the wallet's");
  const owner = String(intent.ownerPkh ?? '').toLowerCase();
  // OX Agent: Authorization prevented by ownership check - the owner is the payment key of one of the wallet's own addresses
  if (!ownPayments.has(owner)) refuse('DATUM', "the owner is not a payment key of the wallet");
  if (String(intent.stakeCredential ?? '').toLowerCase() !== stakeKey) refuse('LISTING', "the stake key is not the account's");
  return unit;
}

// ---------------------------------------------------------------------------------------------
// Cancel and reprice
// ---------------------------------------------------------------------------------------------

/**
 * Check `txCbor` as the cancel of the wallet's own listing `intent.ref`, its NFT returned to
 * `intent.returnAddress`. Throws MarketVerifyError.
 */
export function verifyCancel(
  txCbor: string,
  txHash: string,
  intent: { ref: string; returnAddress: string },
  ctx: MarketVerifyContext,
): CancelSummary {
  const { serialized, tx, txId } = readTransaction(txCbor, txHash, refuse);
  const body = tx.body;
  checkEnvelope(tx, ctx);
  const listing = ownListingFor(intent.ref, ctx);
  const deployment = deploymentOf(listing, ctx);
  const spent = checkListingSpend(serialized, tx, listing, deployment, ctx);

  // Outputs: all the wallet's, the NFT at the return address.
  // OX Agent: Authorization prevented by ownership check - the NFT is returned to one of the wallet's own addresses
  if (!ctx.ownAddresses.has(String(intent.returnAddress))) refuse('OUTPUTS', "the return address is not the wallet's");
  const { listings } = checkOutputs(tx, ctx);
  if (listings.length > 0) refuse('OUTPUTS', 'pays a listing script, which a cancel never does');
  let returned = 0n;
  for (const out of body.outputs) {
    if (String(out.address) !== intent.returnAddress) continue;
    forEachAsset(out, (unit, quantity) => {
      if (unit.toLowerCase() === listing.unit.toLowerCase()) returned += quantity;
    });
  }
  if (returned < 1n) refuse('OUTPUTS', 'does not return the NFT to the return address');

  checkFee(body.fee);
  const sponsored = checkSpendCollateral(body, spent, ctx);

  return {
    txId,
    ref: listing.ref,
    unit: listing.unit,
    returnAddress: intent.returnAddress,
    depositLovelace: listing.depositLovelace,
    networkFeeLovelace: body.fee.toString(),
    ...(sponsored ? { sponsoredCollateralRef: ctx.sponsoredCollateralRef } : {}),
  };
}

/**
 * Check `txCbor` as the reprice of the wallet's own listing `intent.ref` to `intent.price`: the
 * cancel's rules for the input, and one new listing at the SAME address with the same NFT and
 * deposit, whose datum is the old one except for the price. Throws MarketVerifyError.
 */
export function verifyReprice(
  txCbor: string,
  txHash: string,
  intent: { ref: string; price: bigint },
  ctx: MarketVerifyContext,
): RepriceSummary {
  const { serialized, tx, txId } = readTransaction(txCbor, txHash, refuse);
  const body = tx.body;
  checkEnvelope(tx, ctx);
  const listing = ownListingFor(intent.ref, ctx);
  const deployment = deploymentOf(listing, ctx);
  const spent = checkListingSpend(serialized, tx, listing, deployment, ctx);

  const { listings } = checkOutputs(tx, ctx);
  if (listings.length !== 1) refuse('LISTING', 'must pay exactly one output to a listing script');
  const [created] = listings;
  const stakeKey = accountStakeKey(ctx);

  // Address: the old listing's, the script of its own deployment and the account's own stake key.
  if (created.deployment.scriptHash !== deployment.scriptHash) refuse('LISTING', "the new listing is not at the old listing's script");
  // OX Agent: Authorization prevented by ownership check - the repriced listing stays under the account's own stake key
  if (listingStakeKey(created.out, deployment) !== stakeKey) refuse('LISTING', "the new listing's stake key is not the account's");
  if (created.out.scriptReference !== undefined) refuse('LISTING', 'the new listing carries a reference script');

  // Value: the same NFT once and the same deposit.
  checkNftValue(created.out, listing.unit.toLowerCase());
  const deposit = BigInt(listing.depositLovelace);
  if (created.out.value.coins !== deposit) refuse('LISTING', 'the deposit is not the old listing\'s');

  // Datum: the old one except for the price.
  const old = listing.datum;
  const datum = readInlineDatum(serialized, created.index, created.out, ctx);
  if (typeof intent.price !== 'bigint' || datum.price !== intent.price) refuse('DATUM', 'the price is not the one asked for');
  if (datum.price < MIN_LIST_PRICE) refuse('DATUM', 'the price is below the minimum');
  if (datum.owner !== old.owner.toLowerCase()) refuse('DATUM', 'the owner changed');
  if (!sameAddress(datum.sellerAddress, old.sellerAddress)) refuse('DATUM', 'the seller address changed');
  const oldRoyalties = old.royalties.map((r) => ({ address: r.address, lovelace: BigInt(r.lovelace) }));
  if (!sameRoyalties(datum.royalties, oldRoyalties)) refuse('DATUM', 'the royalties changed');
  if ((datum.buyer?.toLowerCase() ?? null) !== (old.buyer?.toLowerCase() ?? null)) refuse('DATUM', 'the buyer changed');
  checkRoyaltyLimits(datum.royalties);
  if (sellerShare(datum, deployment) < MIN_SELLER_SHARE) refuse('DATUM', 'the seller would receive less than the minimum');

  checkFee(body.fee);
  const sponsored = checkSpendCollateral(body, spent, ctx);

  return {
    txId,
    ref: listing.ref,
    unit: listing.unit,
    oldPriceLovelace: BigInt(old.price).toString(),
    listingAddress: String(created.out.address),
    listingOutputIndex: created.index,
    deploymentVersion: deployment.version,
    ...priced(datum.price, deposit, body.fee, economics(datum, deployment)),
    ...(sponsored ? { sponsoredCollateralRef: ctx.sponsoredCollateralRef } : {}),
  };
}

interface Spent {
  inputRefs: ReadonlySet<string>;
  ownByRef: ReadonlyMap<string, Cardano.Utxo>;
}

/**
 * The rules cancel and reprice share for what they spend: the listing and the wallet's own UTxOs
 * only; the deployment's reference script and nothing else referenced; one `Cancel` redeemer at
 * the listing's place in the ledger's input order; the listing's owner, a key of the wallet, as the
 * only required signer.
 */
function checkListingSpend(
  serialized: Serialization.Transaction,
  tx: Cardano.Tx,
  listing: OwnListing,
  deployment: NftMarketDeployment,
  ctx: MarketVerifyContext,
): Spent {
  const body = tx.body;
  const inputRefs = new Set(body.inputs.map(refOf));
  if (inputRefs.size !== body.inputs.length) refuse('INPUTS', 'repeats an input');
  if (ctx.sponsoredCollateralRef && inputRefs.has(ctx.sponsoredCollateralRef)) refuse('INPUTS', 'spends the lent pool collateral');
  if (!inputRefs.has(listing.ref)) refuse('INPUTS', `does not spend ${listing.ref}`);
  const ownByRef = ownUtxosByRef(ctx);
  for (const ref of inputRefs) {
    if (ref === listing.ref) continue;
    if (ctx.ownListings.has(ref)) refuse('INPUTS', `spends ${ref}, another listing, which was not asked for`);
    // OX Agent: Authorization prevented by ownership check - only the listing asked for and the wallet's own UTxOs are spent
    if (!ownByRef.has(ref)) refuse('INPUTS', `spends ${ref}, which is not the wallet's`);
  }

  // Reference inputs: exactly the listing's deployment's reference script.
  const referenceInputs = (body.referenceInputs ?? []).map(refOf);
  if (referenceInputs.length !== 1 || referenceInputs[0].toLowerCase() !== deployment.referenceScript.toLowerCase()) {
    refuse('INPUTS', "the reference inputs are not exactly the listing's deployment script");
  }

  // Redeemers: the one Cancel, spending the listing, at its index in the ledger's sorted order.
  const index = [...body.inputs].sort(compareInputs).findIndex((input) => refOf(input) === listing.ref);
  const redeemers = serialized.witnessSet().redeemers()?.values() ?? [];
  if (redeemers.length !== 1) refuse('REDEEMERS', 'needs exactly one redeemer, the cancel of the listing');
  const [redeemer] = redeemers;
  if (redeemer.tag() !== Serialization.RedeemerTag.Spend || redeemer.index() !== BigInt(index)) {
    refuse('REDEEMERS', 'the redeemer is not the spend of the listing');
  }
  if (!CANCEL_REDEEMER_CBOR.includes(redeemer.data().toCbor())) refuse('REDEEMERS', 'the listing is not spent with the contract\'s Cancel');

  // Required signers: exactly the listing's owner, a key of this wallet.
  const owner = listing.datum.owner.toLowerCase();
  const signers = (body.requiredExtraSignatures ?? []).map((s) => String(s).toLowerCase());
  if (signers.length !== 1 || signers[0] !== owner) refuse('SIGNERS', "must require exactly the listing's owner");
  // OX Agent: Authorization prevented by ownership check - the signing owner is a key of this wallet
  if (!ctx.ownKeyHashes.has(owner)) refuse('SIGNERS', 'the owner is not a key of this wallet');

  return { inputRefs, ownByRef };
}

function checkSpendCollateral(body: Cardano.TxBody, spent: Spent, ctx: MarketVerifyContext): boolean {
  return checkCollateral(body, spent.inputRefs, spent.ownByRef, {
    ownAddresses: ctx.ownAddresses,
    ownKeyHashes: ctx.ownKeyHashes,
    sponsoredCollateralRef: ctx.sponsoredCollateralRef,
    maxAtRiskLovelace: NFT_MARKET_MAX_COLLATERAL_LOVELACE,
  }, refuse);
}

// ---------------------------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------------------------

/**
 * The rules that hold whatever the market transaction does: the market is configured here, the
 * body's network, the forbidden fields, and the validity window. Exported so the migrate verifier
 * applies exactly the same envelope.
 */
export function checkEnvelope(tx: Cardano.Tx, ctx: MarketVerifyContext): void {
  const body = tx.body;
  if (ctx.deployments.length === 0) refuse('NETWORK', 'the market has no deployment on this network');
  if (body.networkId !== undefined && body.networkId !== ctx.networkId) refuse('NETWORK', 'body network id differs');
  checkForbiddenFields(tx, refuse, 'market transaction');
  checkValidityWindow(body);
}

/**
 * A market transaction is valid for a bounded window and says so: BOTH bounds are present, the
 * window is not empty, and it is at most NFT_MARKET_MAX_VALIDITY_SLOTS wide. Without both a signed
 * transaction would stay valid indefinitely (a far-future end, or no end), so one that leaks could
 * be submitted long after the user reviewed it. Nexus sets `[tip - 120, tip + 1800]`.
 */
export function checkValidityWindow(body: Cardano.TxBody): void {
  const start = body.validityInterval?.invalidBefore;
  const end = body.validityInterval?.invalidHereafter;
  if (start === undefined || end === undefined || end <= start || end - start > NFT_MARKET_MAX_VALIDITY_SLOTS) {
    refuse('FORBIDDEN_FIELD', 'needs a validity window with both bounds, of at most one hour');
  }
}

function checkFee(fee: bigint): void {
  if (fee > NFT_MARKET_MAX_FEE_LOVELACE) refuse('FEE', 'is above the cap');
}

/** No script runs in a list: no redeemer and no script data hash. */
function checkNoScripts(serialized: Serialization.Transaction, tx: Cardano.Tx): void {
  if ((serialized.witnessSet().redeemers()?.values() ?? []).length > 0) refuse('REDEEMERS', 'a list runs no script and has no redeemer');
  if (tx.body.scriptIntegrityHash !== undefined) refuse('REDEEMERS', 'a list runs no script and has no script data hash');
}

export interface ListingOutput {
  index: number;
  out: Cardano.TxOut;
  deployment: NftMarketDeployment;
}

/**
 * Split the outputs into those at a deployed listing script (any version) and the rest, and
 * require every other output to be a plain payment to the wallet: its network, an own address
 * whose payment credential is one of the wallet's keys (never a script, however the address set
 * came to hold one), no datum, no reference script.
 */
export function checkOutputs(tx: Cardano.Tx, ctx: MarketVerifyContext): { listings: ListingOutput[] } {
  const listings: ListingOutput[] = [];
  const others: Cardano.TxOut[] = [];
  tx.body.outputs.forEach((out, index) => {
    const address = String(out.address);
    if (outputNetwork(address) !== ctx.networkId) refuse('NETWORK', 'pays an address of another network');
    const deployment = listingDeployment(address, ctx.deployments);
    if (deployment) listings.push({ index, out, deployment });
    else others.push(out);
  });
  for (const out of others) {
    const address = String(out.address);
    // OX Agent: Authorization prevented by ownership check - every other output pays one of the wallet's addresses, at one of its own keys
    if (!ctx.ownAddresses.has(address) || !paysOwnKey(address, ctx.ownKeyHashes)) {
      refuse('OUTPUTS', "pays an address that is not the wallet's");
    }
    if (out.datum !== undefined || out.datumHash !== undefined || out.scriptReference !== undefined) {
      refuse('OUTPUTS', 'an output carries a datum or a reference script');
    }
  }
  return { listings };
}

/** The listing output's value: exactly the one NFT, once, and ADA. */
function checkNftValue(out: Cardano.TxOut, unit: string): void {
  const held: [string, bigint][] = [];
  forEachAsset(out, (u, q) => held.push([u.toLowerCase(), q]));
  if (held.length !== 1 || held[0][0] !== unit || held[0][1] !== 1n) refuse('NFT', 'the listing must hold exactly the one NFT and nothing else');
}

/**
 * The inline datum of output `index` as the transaction carries it, decoded strictly as a
 * `Listing`. The bytes are read from the serialized transaction, not from the Core conversion,
 * which re-encodes them.
 */
function readInlineDatum(
  serialized: Serialization.Transaction,
  index: number,
  out: Cardano.TxOut,
  ctx: MarketVerifyContext,
): ListingDatum {
  if (out.datumHash !== undefined) refuse('DATUM', 'the datum is a hash, not inline');
  const cbor = serialized.body().outputs()[index]?.datum()?.asInlineData()?.toCbor();
  if (!cbor) refuse('DATUM', 'the listing has no inline datum');
  try {
    return decodeListingDatum(cbor, ctx.networkId);
  } catch (e) {
    return refuse('DATUM', (e as Error)?.message ?? 'the datum is not a Gero listing');
  }
}

function checkRoyaltyLimits(royalties: readonly Payee[]): void {
  if (royalties.length > MAX_ROYALTIES) refuse('DATUM', `has more than ${MAX_ROYALTIES} royalties`);
  if (royalties.some((r) => r.lovelace <= 0n)) refuse('DATUM', 'a royalty is zero or negative');
}

const sameAddress = (a: string, b: string) => String(a).toLowerCase() === String(b).toLowerCase();

function sameRoyalties(a: readonly Payee[], b: readonly Payee[]): boolean {
  return Array.isArray(b) && a.length === b.length && a.every((p, i) => sameAddress(p.address, b[i].address) && p.lovelace === b[i].lovelace);
}

/** The listing output's address as a base address of `deployment`'s script; returns its stake key hash. */
function listingStakeKey(out: Cardano.TxOut, deployment: NftMarketDeployment): string {
  let base: Cardano.BaseAddress | undefined;
  try {
    base = Cardano.Address.fromBech32(String(out.address)).asBase();
  } catch {
    base = undefined;
  }
  const payment = base?.getPaymentCredential();
  if (!base || payment?.type !== Cardano.CredentialType.ScriptHash || payment.hash !== deployment.scriptHash) {
    refuse('LISTING', 'the listing address is not the listing script with a stake part');
  }
  const stake = base.getStakeCredential();
  if (stake.type !== Cardano.CredentialType.KeyHash) refuse('LISTING', "the listing's stake part is not a key");
  return String(stake.hash).toLowerCase();
}

/** The deployment whose script is the payment credential of `address`, if it is one. */
function listingDeployment(address: string, deployments: readonly NftMarketDeployment[]): NftMarketDeployment | undefined {
  try {
    const parsed = Cardano.Address.fromBech32(address);
    const credential = (parsed.asBase() ?? parsed.asEnterprise() ?? parsed.asPointer())?.getPaymentCredential();
    if (credential?.type !== Cardano.CredentialType.ScriptHash) return undefined;
    return deployments.find((d) => d.scriptHash === credential.hash);
  } catch {
    return undefined;
  }
}

/** The deployment new listings go to. An empty list is a refusal, never a TypeError. */
export function newestDeployment(deployments: readonly NftMarketDeployment[]): NftMarketDeployment {
  if (!Array.isArray(deployments) || deployments.length === 0) refuse('NETWORK', 'the market has no deployment on this network');
  return deployments.reduce((best, d) => (d.version > best.version ? d : best));
}

const KEY_HASH = /^[0-9a-f]{56}$/;

/** The account's stake key hash from the context, lower-case; it must be a key hash of the wallet. */
function accountStakeKey(ctx: MarketVerifyContext): string {
  const stakeKey = typeof ctx.stakeKeyHash === 'string' ? ctx.stakeKeyHash.toLowerCase() : '';
  if (!KEY_HASH.test(stakeKey)) refuse('LISTING', "the account's stake key hash is missing or malformed");
  // OX Agent: Authorization prevented by ownership check - the stake key listings sit under is one of the wallet's own keys
  if (!ctx.ownKeyHashes.has(stakeKey)) refuse('LISTING', "the account's stake key is not a key of this wallet");
  return stakeKey;
}

/**
 * The CIP-68 label of an asset name (hex), or null when it carries none. CIP-67 puts the label in
 * the first four bytes: `0`, the 16-bit label, its CRC-8 (polynomial 0x07, initial value 0), `0`.
 * (100) is `000643b0`, (222) `000de140`, (333) `0014df10`, (444) `001bc280`, (500) `001f4d70`.
 */
export function cip68Label(assetNameHex: string): number | null {
  if (!/^[0-9a-f]{8}/.test(assetNameHex)) return null;
  const head = parseInt(assetNameHex.slice(0, 8), 16);
  if ((head >>> 28) !== 0 || (head & 0xf) !== 0) return null;
  const label = (head >>> 12) & 0xffff;
  const crc = (head >>> 4) & 0xff;
  return crc8([label >>> 8, label & 0xff]) === crc ? label : null;
}

function crc8(bytes: readonly number[]): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

function ownListingFor(ref: string, ctx: MarketVerifyContext): OwnListing {
  // OX Agent: Authorization prevented by ownership check - only a verified listing of this wallet can be cancelled or repriced
  const listing = ctx.ownListings.get(ref);
  if (!listing || listing.ref !== ref) refuse('INPUTS', `${String(ref)} is not one of the wallet's own listings`);
  return listing;
}

function deploymentOf(listing: OwnListing, ctx: MarketVerifyContext): NftMarketDeployment {
  const deployment = ctx.deployments.find((d) => d.version === listing.deploymentVersion);
  if (!deployment) refuse('LISTING', `the listing's deployment (v${listing.deploymentVersion}) is not configured`);
  return deployment;
}

function ownUtxosByRef(ctx: MarketVerifyContext): Map<string, Cardano.Utxo> {
  return new Map(ctx.ownUtxos.map((utxo) => [refOf(utxo[0]), utxo]));
}

/** The payment key hashes of the wallet's own addresses (lower-case hex). */
function ownPaymentKeyHashes(ownAddresses: ReadonlySet<string>): Set<string> {
  const payment = new Set<string>();
  for (const address of ownAddresses) {
    try {
      const parsed = Cardano.Address.fromBech32(address);
      const credential = (parsed.asBase() ?? parsed.asEnterprise())?.getPaymentCredential();
      if (credential?.type === Cardano.CredentialType.KeyHash) payment.add(String(credential.hash).toLowerCase());
    } catch {
      // Not a Shelley bech32 address: it carries no key the wallet could own a listing with.
    }
  }
  return payment;
}

export function economics(datum: ListingDatum, deployment: NftMarketDeployment) {
  return {
    marketFee: listingFee(datum.price, deployment),
    royalties: datum.royalties.reduce((sum, r) => sum + r.lovelace, 0n),
    sellerReceives: sellerShare(datum, deployment),
  };
}

export function priced(
  price: bigint,
  deposit: bigint,
  networkFee: bigint,
  share: ReturnType<typeof economics>,
): PricedSummary {
  return {
    priceLovelace: price.toString(),
    marketFeeLovelace: share.marketFee.toString(),
    royaltiesLovelace: share.royalties.toString(),
    sellerReceivesLovelace: share.sellerReceives.toString(),
    depositLovelace: deposit.toString(),
    networkFeeLovelace: networkFee.toString(),
  };
}
