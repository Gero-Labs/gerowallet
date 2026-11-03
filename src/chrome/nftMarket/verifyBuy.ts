// The wallet's own check of a Gero market buy that Nexus built, before anything is signed
// (spec 5.8, 5.10). Pure and fail closed: every rule below either holds or the transaction is
// refused with a MarketVerifyError naming the rule. Nothing Nexus says about the transaction is
// trusted; only the CBOR is read, against the listing's datum and the reviewed deployment.
//
// Why this is the wallet's job: a wrong buy either fails on chain, which forfeits the collateral,
// or pays somebody more than the listing says. The contract pays the seller and the royalty
// payees what the DATUM says (rules.md P4, P5) and the fee address what the deployment's
// parameters say (P3); it never looks at where the NFT goes (P7) or at what else the transaction
// pays. So the wallet reads the datum itself (ruling R11: it decodes the inline datum Nexus
// supplied, strictly) and holds every output to it.
//
// What a buy that passes can do to the wallet:
//  - spend exactly one listing, the one asked for, at a reviewed deployment of the network, with
//    the contract's `Purchase{first_output}` as the only redeemer and exactly that deployment's
//    reference script as the only reference input; and spend the wallet's own UTxOs, nothing else;
//    carry no script and no datum of its own in the witness set;
//  - pay, at `first_output`, the datum's seller address exactly its due (share + the listing's
//    deposit), then one output per royalty, in datum order, each exactly its amount, all ADA only
//    and tagged with this listing's tag; an output below its min-UTxO is raised to it, and the
//    raise is the buyer's top-up, shown in the summary;
//  - pay the deployment's fee address (full address, stake part included) the listing fee in one
//    untagged ADA output, raised to its min-UTxO at most, so no payee can be overpaid "for
//    min-UTxO" by more than that output's own gap;
//  - pay every other output to the wallet itself, at one of its own keys, with no datum and no
//    reference script, and deliver the NFT to the buyer address the user chose, a net gain of one
//    for the wallet (the NFT comes out of the listing, not out of a copy the buyer already held);
//  - cost the buyer exactly price + network fee + the min-UTxO top-ups: the listing's deposit is
//    the listing input's own ADA, passed on to the seller, and the ADA of the buyer's own NFT
//    output stays theirs;
//  - pay a network fee of at most NFT_MARKET_MAX_FEE_LOVELACE, require no signer, be valid for a
//    bounded window with both bounds, and, if a script fails anyway, lose at most
//    NFT_MARKET_MAX_COLLATERAL_LOVELACE of the wallet's own collateral (none when it is the lent
//    Nexus pool UTxO).
// It cannot mint, burn, certify, withdraw, vote, propose, donate, carry metadata, spend another
// listing or any UTxO that is not the wallet's, or pay anyone but the datum's payees, the fee
// address and the wallet.
//
// What the transaction cannot tell: the listing UTxO's own content. It names the input, not what
// it holds, and a datum Nexus made up can be a SUPERSET of the real one (same seller, a higher
// price, one extra royalty to an attacker): the contract ignores trailing outputs and accepts
// overpayment, so such a buy SUCCEEDS on chain and Nexus keeps the difference. Ruling P28
// (overriding R11) therefore makes the caller read the listing UTxO from a source independent of
// Nexus (`listingChainUtxo.ts`, Koios) and `verifyBuy` refuses unless that UTxO is at the
// deployment's script, holds exactly the deposit and the one NFT, and carries an inline datum
// equal to the one the row supplied, field by field. The balance equation then ties the same
// deposit to the transaction: the ledger forces inputs to equal outputs plus the fee, so the
// buyer's net cost equals price + fee + top-up only if the deposit the payees are paid is the
// deposit the listing UTxO really holds.

import { Cardano, Serialization } from '@cardano-sdk/core';
import { bytesToHex } from '@noble/hashes/utils.js';
import { forEachAsset } from '@/api/nexusInputSelection';
import type { ListingDto } from '@/api/nft-market-api';
import type { ListingChainUtxo } from '@/chrome/nftMarket/listingChainUtxo';
import { DEFAULT_COINS_PER_UTXO_BYTE } from '@/shared/utils/txIntentGuard';
import {
  checkCollateral,
  compareInputs,
  outputNetwork,
  paysOwnKey,
  readTransaction,
  refOf,
} from '@/chrome/txVerifyCommon';
import {
  decodeListingDatum,
  listingFee,
  listingTag,
  sellerDue,
  sellerShare,
  type ListingDatum,
} from '@/chrome/nftMarket/listingDatum';
import {
  MarketVerifyError,
  checkEnvelope,
  cip68Label,
  type MarketVerifyContext,
  type MarketVerifyRule,
} from '@/chrome/nftMarket/verifyListing';
import {
  NFT_MARKET_MAX_COLLATERAL_LOVELACE,
  NFT_MARKET_MAX_FEE_LOVELACE,
  type NftMarketDeployment,
} from '@/utils/nftMarketDeployments';

/** What the wallet worker knows when it verifies a buy: the market context plus the live protocol parameter. */
export interface BuyVerifyContext extends MarketVerifyContext {
  /**
   * `coinsPerUtxoByte` of the current epoch (`NetworkStore.state.epochParams`). It sets the
   * min-UTxO of the payee and fee outputs. Defaults to 4310, the value on mainnet, preprod and
   * preview since Babbage, and is CAPPED at it: a larger value would make the verifier demand
   * more than the ledger does, so an inflated figure could talk it into accepting overpayment. A
   * lower value only makes a buy built under the real one fail the check (and, were it signed,
   * the ledger's own min-UTxO rule), which is safe. A buy built under a different value than the
   * one used here is refused, never accepted.
   */
  coinsPerUtxoByte?: bigint;
}

/** What the user asked to buy. */
export interface BuyIntent {
  /** The listing as Nexus indexed it. Only its datum, ref, script and deposit are used, and they are cross-checked. */
  listing: ListingDto;
  /** One of the wallet's own addresses (bech32): where the NFT goes. */
  buyerAddress: string;
  /**
   * The listing UTxO as read from a source independent of Nexus (`fetchListingUtxoFromKoios`),
   * for the same out-ref as `listing`. Required: without it a made-up datum cannot be told from
   * the real one (ruling P28).
   */
  chainUtxo: ListingChainUtxo;
}

/** What the review screen shows, read from the verified buy. All amounts are lovelace as decimal strings. */
export interface BuySummary {
  txId: string;
  /** The listing bought, `txHash#index`. */
  ref: string;
  unit: string;
  /** What the buyer pays the payees for the NFT: the datum's price (fee + royalties + seller share). */
  priceLovelace: string;
  /** The Gero market fee inside the price, from the deployment's parameters. */
  feeLovelace: string;
  /** The royalties inside the price. */
  royaltiesLovelace: string;
  /** The ADA riding with the NFT; the seller gets it back and it costs the buyer nothing. */
  depositLovelace: string;
  networkFeeLovelace: string;
  /** What the buyer adds on top of the price because some payee output needs more than its due to reach min-UTxO. */
  minUtxoTopUpLovelace: string;
  /** What the buyer's own UTxOs lose in total: own inputs minus the transaction's change and NFT outputs. */
  totalOutflowLovelace: string;
  sponsoredCollateralRef?: string;
}

/** Throws the market's error. A declaration, so control-flow analysis sees it never returns. */
function refuse(rule: MarketVerifyRule, detail: string): never {
  throw new MarketVerifyError(rule, detail);
}

const TX_HASH = /^[0-9a-f]{64}$/;
const HASH28 = /^[0-9a-f]{56}$/;
/** policy id (28 bytes) then an asset name of up to 32 bytes. */
const UNIT = /^[0-9a-f]{56}(?:[0-9a-f]{2}){0,32}$/;
const DECIMAL = /^[0-9]+$/;
const POLICY_HEX_LENGTH = 56;
/** CIP-68 user token: the only CIP-68 label an NFT is bought under. */
const CIP68_USER_TOKEN_LABEL = 222;
/** The ledger charges 160 bytes of overhead per output on top of its serialised size (Babbage). */
const MIN_UTXO_OVERHEAD_BYTES = 160;

/** The listing the user asked to buy, cross-checked, with the reviewed deployment it sits at. */
interface ListingFacts {
  ref: string;
  txHash: string;
  outputIndex: number;
  unit: string;
  datum: ListingDatum;
  deployment: NftMarketDeployment;
  deposit: bigint;
}

/**
 * Check `txCbor` against the listing the user asked to buy and return what it costs, or throw
 * MarketVerifyError. `txHash` is the id Nexus reported; it must equal the id computed here.
 */
export function verifyBuy(txCbor: string, txHash: string, intent: BuyIntent, ctx: BuyVerifyContext): BuySummary {
  const { serialized, tx, txId } = readTransaction(txCbor, txHash, refuse);
  const body = tx.body;
  checkEnvelope(tx, ctx);
  const cpb = coinsPerUtxoByte(ctx);
  const listing = listingFacts(intent?.listing, ctx);
  const { datum, deployment, deposit } = listing;
  checkChainUtxo(intent?.chainUtxo, listing, ctx);

  // The buyer address: where the NFT goes. One of the wallet's own, at one of its own keys.
  const buyerAddress = String(intent?.buyerAddress ?? '');
  // OX Agent: Authorization prevented by ownership check - the NFT is delivered to one of the wallet's own addresses
  if (!ctx.ownAddresses.has(buyerAddress) || !paysOwnKey(buyerAddress, ctx.ownKeyHashes)) {
    refuse('OUTPUTS', "the buyer address is not the wallet's");
  }

  // Inputs: the listing and the wallet's own UTxOs, nothing else. One script input only.
  const inputRefs = new Set(body.inputs.map(refOf));
  if (inputRefs.size !== body.inputs.length) refuse('INPUTS', 'repeats an input');
  if (ctx.sponsoredCollateralRef && inputRefs.has(ctx.sponsoredCollateralRef)) refuse('INPUTS', 'spends the lent pool collateral');
  if (!inputRefs.has(listing.ref)) refuse('INPUTS', `does not spend the listing ${listing.ref}`);
  const ownByRef = new Map(ctx.ownUtxos.map((utxo) => [refOf(utxo[0]), utxo]));
  let ownIn = 0n;
  let ownUnitIn = 0n;
  for (const ref of inputRefs) {
    if (ref === listing.ref) continue;
    if (ctx.ownListings.has(ref)) refuse('INPUTS', `spends ${ref}, another listing, which a buy never does`);
    const own = ownByRef.get(ref);
    // OX Agent: Authorization prevented by ownership check - a buy spends only the listing asked for and the wallet's own UTxOs
    if (!own) refuse('INPUTS', `spends ${ref}, which is not the wallet's`);
    ownIn += own[1].value.coins;
    forEachAsset(own[1], (unit, quantity) => {
      if (unit.toLowerCase() === listing.unit) ownUnitIn += quantity;
    });
  }

  // Reference inputs: exactly the listing's deployment's reference script.
  const referenceInputs = (body.referenceInputs ?? []).map(refOf);
  if (referenceInputs.length !== 1 || referenceInputs[0].toLowerCase() !== deployment.referenceScript.toLowerCase()) {
    refuse('INPUTS', "the reference inputs are not exactly the listing's deployment script");
  }

  // Redeemer: the one Purchase, spending the listing at its place in the ledger's sorted inputs.
  const payeeCount = 1 + datum.royalties.length;
  const firstOutput = checkRedeemer(serialized, tx, listing.ref, payeeCount);

  // Required signers: none. A public listing needs no key; the keys that sign are those of the inputs.
  if ((body.requiredExtraSignatures ?? []).length > 0) refuse('SIGNERS', 'a public buy requires no signer');

  // Witness set: the listing script comes from the reference input and its datum is inline, so a
  // buy carries no script and no datum of its own.
  checkWitnessSet(serialized);

  // Outputs: the payees, the fee, the wallet's own. Nothing else.
  const outputs = checkBuyOutputs(serialized, tx, listing, firstOutput, buyerAddress, ctx, cpb);

  // The NFT must come out of the listing: the wallet ends up holding one more of it than it spent.
  if (outputs.ownUnitOut - ownUnitIn < 1n) refuse('NFT', "the wallet's NFT balance does not rise by the one in the listing");

  // Network fee.
  if (body.fee > NFT_MARKET_MAX_FEE_LOVELACE) refuse('FEE', 'is above the cap');

  // Collateral: the wallet's own bounded ADA, or the lent pool UTxO.
  const sponsored = checkCollateral(body, inputRefs, ownByRef, {
    ownAddresses: ctx.ownAddresses,
    ownKeyHashes: ctx.ownKeyHashes,
    sponsoredCollateralRef: ctx.sponsoredCollateralRef,
    maxAtRiskLovelace: NFT_MARKET_MAX_COLLATERAL_LOVELACE,
  }, refuse);

  // What the buyer pays. The ledger balances the transaction against the listing UTxO's real
  // lovelace, so the wallet's net loss is price + network fee + top-up exactly when the deposit
  // paid on to the seller is that UTxO's own ADA. More means the buyer funds somebody (or the
  // deposit as well); less means the deposit paid on is more than the listing holds, which the
  // seller's due on chain will not match.
  const outflow = ownIn - outputs.ownOut;
  const expected = datum.price + body.fee + outputs.topUp;
  if (outflow > expected) refuse('OUTPUTS', 'costs the buyer more than the price and the network fee');
  if (outflow < expected) refuse('OUTPUTS', "pays the seller a deposit that is not the one the listing holds");

  return {
    txId,
    ref: listing.ref,
    unit: listing.unit,
    priceLovelace: datum.price.toString(),
    feeLovelace: listingFee(datum.price, deployment).toString(),
    royaltiesLovelace: datum.royalties.reduce((sum, r) => sum + r.lovelace, 0n).toString(),
    depositLovelace: deposit.toString(),
    networkFeeLovelace: body.fee.toString(),
    minUtxoTopUpLovelace: outputs.topUp.toString(),
    totalOutflowLovelace: outflow.toString(),
    ...(sponsored ? { sponsoredCollateralRef: ctx.sponsoredCollateralRef } : {}),
  };
}

/** The protocol parameter min-UTxO is measured with: the context's, never above the reviewed ceiling. */
function coinsPerUtxoByte(ctx: BuyVerifyContext): bigint {
  const cpb = ctx.coinsPerUtxoByte ?? DEFAULT_COINS_PER_UTXO_BYTE;
  if (typeof cpb !== 'bigint' || cpb <= 0n) refuse('OUTPUTS', 'the protocol parameter that sets min-UTxO is unusable');
  return cpb > DEFAULT_COINS_PER_UTXO_BYTE ? DEFAULT_COINS_PER_UTXO_BYTE : cpb;
}

// ---------------------------------------------------------------------------------------------
// The listing
// ---------------------------------------------------------------------------------------------

/**
 * Read the listing row for a buy: its ref, its reviewed deployment (looked up by script hash and
 * version, never by what the row says about fees), and its datum, which the worker decodes itself
 * from the raw bytes (R11) and cross-checks against the row. Refuses a private listing (R2), a
 * listing that can never be bought (seller share or a royalty at or below zero) and a unit that
 * is not an NFT.
 */
function listingFacts(listing: ListingDto, ctx: BuyVerifyContext): ListingFacts {
  if (typeof listing !== 'object' || listing === null) refuse('LISTING', 'there is no listing to buy');
  const txHash = typeof listing.txHash === 'string' ? listing.txHash.toLowerCase() : '';
  if (!TX_HASH.test(txHash) || !Number.isSafeInteger(listing.outputIndex) || listing.outputIndex < 0) {
    refuse('LISTING', 'the listing reference is malformed');
  }
  const scriptHash = typeof listing.scriptHash === 'string' ? listing.scriptHash.toLowerCase() : '';
  const deployment = ctx.deployments.find((d) => d.scriptHash === scriptHash && d.version === listing.version);
  if (!HASH28.test(scriptHash) || !deployment) refuse('LISTING', 'the listing is not at a reviewed deployment of this network');
  if (typeof listing.depositLovelace !== 'string' || !DECIMAL.test(listing.depositLovelace)) {
    refuse('LISTING', 'the listing deposit is malformed');
  }
  if (typeof listing.priceLovelace !== 'string' || !DECIMAL.test(listing.priceLovelace)) {
    refuse('LISTING', 'the listing price is malformed');
  }
  const unit = typeof listing.unit === 'string' ? listing.unit.toLowerCase() : '';
  if (!UNIT.test(unit) || unit !== `${String(listing.policyId).toLowerCase()}${String(listing.assetName).toLowerCase()}`) {
    refuse('LISTING', 'the listing unit is malformed');
  }
  // CIP-68: only the (222) user token is an NFT to own; (100) is the metadata reference token.
  const label = cip68Label(unit.slice(POLICY_HEX_LENGTH));
  if (label !== null && label !== CIP68_USER_TOKEN_LABEL) refuse('NFT', `a CIP-68 token with label (${label}) is not an NFT`);

  let datum: ListingDatum;
  try {
    datum = decodeListingDatum(String(listing.datumCbor ?? ''), ctx.networkId);
  } catch (e) {
    return refuse('DATUM', (e as Error)?.message ?? 'the datum is not a Gero listing');
  }
  if (datum.buyer !== null) refuse('PRIVATE_LISTING', 'a private listing is not for sale to everyone (public listings only)');

  // The row must say what the datum says: the user is shown the row, the contract pays the datum.
  if (BigInt(listing.priceLovelace) !== datum.price) refuse('DATUM', "the listing's price is not its datum's");
  if (!sameAddress(listing.sellerAddress, datum.sellerAddress)) refuse('DATUM', "the listing's seller is not its datum's");
  if (String(listing.ownerPkh).toLowerCase() !== datum.owner.toLowerCase()) refuse('DATUM', "the listing's owner is not its datum's");
  const rows = Array.isArray(listing.royalties) ? listing.royalties : [];
  if (
    rows.length !== datum.royalties.length ||
    rows.some((row, i) => !sameAddress(row?.address, datum.royalties[i].address) || String(row?.lovelace) !== datum.royalties[i].lovelace.toString())
  ) {
    refuse('DATUM', "the listing's royalties are not its datum's");
  }

  // Unbuyable on chain (rules.md P2, P5): refuse before the buyer signs a transaction that burns collateral.
  if (datum.price <= 0n) refuse('DATUM', 'the price is zero or negative');
  if (datum.royalties.some((r) => r.lovelace <= 0n)) refuse('DATUM', 'a royalty is zero or negative, which the contract never accepts');
  if (sellerShare(datum, deployment) <= 0n) refuse('DATUM', "the seller's share is zero or negative, so the listing can never be bought");

  return {
    ref: `${txHash}#${listing.outputIndex}`,
    txHash,
    outputIndex: listing.outputIndex,
    unit,
    datum,
    deployment,
    deposit: BigInt(listing.depositLovelace),
  };
}

// ---------------------------------------------------------------------------------------------
// The listing UTxO on chain
// ---------------------------------------------------------------------------------------------

/**
 * Hold the row Nexus gave to the listing UTxO as an independent source read it (ruling P28): it is
 * at the deployment's script on this network, holds exactly the deposit and the one NFT, and its
 * inline datum is a Gero listing equal, field by field, to the datum the row supplied. A datum
 * that differs (above all a superset with an extra royalty, which the contract would accept) is
 * the attack this refuses.
 */
function checkChainUtxo(chain: ListingChainUtxo, listing: ListingFacts, ctx: BuyVerifyContext): void {
  if (typeof chain !== 'object' || chain === null) refuse('LISTING', 'the listing was not read from the chain');

  // Address: the deployment's script.
  const address = typeof chain.address === 'string' ? chain.address : '';
  // OX Agent: Authorization prevented by ownership check - the listing UTxO is at the reviewed deployment's script on this network
  if (outputNetwork(address) !== ctx.networkId || listingScriptHash(address) !== listing.deployment.scriptHash) {
    refuse('LISTING', "the listing on chain is not at its deployment's script");
  }

  // Value: the deposit and the one NFT, nothing else.
  if (typeof chain.lovelace !== 'bigint' || chain.lovelace !== listing.deposit) {
    refuse('LISTING', 'the listing on chain holds a different amount of ADA than the row says');
  }
  const assets = Array.isArray(chain.assets) ? chain.assets : [];
  if (assets.length !== 1 || String(assets[0]?.unit).toLowerCase() !== listing.unit || assets[0]?.quantity !== 1n) {
    refuse('NFT', 'the listing on chain must hold exactly the one NFT and nothing else');
  }

  // Datum: inline, a Gero listing, and the one the row supplied.
  if (typeof chain.inlineDatumCbor !== 'string') refuse('DATUM', 'the listing on chain has no inline datum, so it cannot be bought');
  let onChain: ListingDatum;
  try {
    onChain = decodeListingDatum(chain.inlineDatumCbor, ctx.networkId);
  } catch (e) {
    return refuse('DATUM', (e as Error)?.message ?? 'the datum on chain is not a Gero listing');
  }
  if (onChain.buyer !== null) refuse('PRIVATE_LISTING', 'a private listing is not for sale to everyone (public listings only)');
  const row = listing.datum;
  if (
    onChain.owner.toLowerCase() !== row.owner.toLowerCase() ||
    !sameAddress(onChain.sellerAddress, row.sellerAddress) ||
    onChain.price !== row.price ||
    onChain.royalties.length !== row.royalties.length ||
    onChain.royalties.some((r, i) => !sameAddress(r.address, row.royalties[i].address) || r.lovelace !== row.royalties[i].lovelace)
  ) {
    refuse('DATUM', "the datum on chain is not the one the row supplied");
  }
}

/** The script hash an address pays, or null when it pays a key or cannot be read. */
function listingScriptHash(address: string): string | null {
  try {
    const parsed = Cardano.Address.fromBech32(address);
    const credential = (parsed.asBase() ?? parsed.asEnterprise() ?? parsed.asPointer())?.getPaymentCredential();
    return credential?.type === Cardano.CredentialType.ScriptHash ? String(credential.hash) : null;
  } catch {
    return null;
  }
}

/**
 * A buy brings no script of its own (the listing's comes from the reference input) and no witness
 * datum (the listing's is inline): refuse any Plutus or native script and any datum in the witness set.
 */
function checkWitnessSet(serialized: Serialization.Transaction): void {
  const witness = serialized.witnessSet();
  const sizes = [
    witness.plutusV1Scripts()?.size() ?? 0,
    witness.plutusV2Scripts()?.size() ?? 0,
    witness.plutusV3Scripts()?.size() ?? 0,
    witness.nativeScripts()?.size() ?? 0,
    witness.plutusData()?.size() ?? 0,
  ];
  if (sizes.some((size) => size > 0)) refuse('FORBIDDEN_FIELD', 'carries a script or a datum in its witness set, which a buy never needs');
}

// ---------------------------------------------------------------------------------------------
// The redeemer
// ---------------------------------------------------------------------------------------------

/**
 * The one redeemer is `Purchase{first_output}` (`Constr 0 [Int]`) spending the listing at its
 * index in the ledger's sorted inputs. Returns `first_output`, which must name a non-negative
 * index with room for the whole payee group after it (the contract reads a negative one as 0;
 * the wallet does not accept it).
 */
function checkRedeemer(serialized: Serialization.Transaction, tx: Cardano.Tx, listingRef: string, payeeCount: number): number {
  const body = tx.body;
  const sorted = [...body.inputs].sort(compareInputs);
  const index = sorted.findIndex((input) => refOf(input) === listingRef);
  const redeemers = serialized.witnessSet().redeemers()?.values() ?? [];
  if (redeemers.length !== 1) refuse('REDEEMERS', 'needs exactly one redeemer, the purchase of the listing');
  const [redeemer] = redeemers;
  if (redeemer.tag() !== Serialization.RedeemerTag.Spend || redeemer.index() !== BigInt(index)) {
    refuse('REDEEMERS', 'the redeemer is not the spend of the listing');
  }
  const constr = redeemer.data().asConstrPlutusData();
  const fields = constr?.getData();
  if (!constr || constr.getAlternative() !== 0n || !fields || fields.getLength() !== 1) {
    refuse('REDEEMERS', "the listing is not spent with the contract's Purchase");
  }
  const first = fields.get(0).asInteger();
  if (first === undefined) refuse('REDEEMERS', 'the purchase has no output index');
  if (first < 0n || first + BigInt(payeeCount) > BigInt(body.outputs.length)) {
    refuse('REDEEMERS', 'first_output is negative or leaves no room for the seller and royalty outputs');
  }
  return Number(first);
}

// ---------------------------------------------------------------------------------------------
// The outputs
// ---------------------------------------------------------------------------------------------

interface OutputSums {
  /** What the buyer pays above the payees' dues so that their outputs reach min-UTxO. */
  topUp: bigint;
  /** Lovelace in the outputs that are neither payee nor fee outputs: the buyer's own NFT output and change. */
  ownOut: bigint;
  /** The listing's NFT in those same outputs. */
  ownUnitOut: bigint;
}

/**
 * Hold every output to its role. The payee group (`first_output` onward: the seller, then each
 * royalty) pays exactly `max(due, min-UTxO)` in ADA with the tag; one untagged ADA output at the
 * deployment's fee address pays the fee (up to its own min-UTxO gap); every other output is the
 * wallet's own plain payment and one of them delivers the NFT to the buyer address.
 */
function checkBuyOutputs(
  serialized: Serialization.Transaction,
  tx: Cardano.Tx,
  listing: ListingFacts,
  firstOutput: number,
  buyerAddress: string,
  ctx: BuyVerifyContext,
  cpb: bigint,
): OutputSums {
  const { datum, deployment, deposit } = listing;
  const outputs = tx.body.outputs;
  const raw = serialized.body().outputs();
  if (raw.length !== outputs.length) refuse('OUTPUTS', 'the outputs could not be read');
  outputs.forEach((out) => {
    if (outputNetwork(String(out.address)) !== ctx.networkId) refuse('NETWORK', 'pays an address of another network');
  });

  const tag = listingTag(listing.txHash, listing.outputIndex);
  const payees = [
    { name: 'seller', address: datum.sellerAddress, due: sellerDue(datum, deployment, deposit) },
    ...datum.royalties.map((r, i) => ({ name: `royalty ${i + 1}`, address: r.address, due: r.lovelace })),
  ];

  // The payee group. The amount is the due, raised to the output's min-UTxO when the due is below it.
  let topUp = 0n;
  const roles = new Set<number>();
  payees.forEach((payee, i) => {
    const index = firstOutput + i;
    roles.add(index);
    const out = outputs[index];
    if (!sameAddress(String(out.address), payee.address)) refuse('OUTPUTS', `the ${payee.name} output does not pay the address in the datum`);
    if (!isAdaOnly(out) || out.scriptReference !== undefined) refuse('OUTPUTS', `the ${payee.name} output is not plain ADA`);
    if (out.datumHash !== undefined || !hasTag(raw[index], tag)) refuse('OUTPUTS', `the ${payee.name} output does not carry this listing's tag`);
    const min = minUtxo(out, cpb);
    const required = payee.due >= min ? payee.due : min;
    if (out.value.coins !== required) {
      refuse('OUTPUTS', `the ${payee.name} output pays ${out.value.coins} lovelace, not the ${required} the listing requires`);
    }
    topUp += required - payee.due;
  });

  // The rest: the fee output, then the wallet's own outputs.
  const fee = listingFee(datum.price, deployment);
  const feeOutputs: number[] = [];
  let ownOut = 0n;
  let ownUnitOut = 0n;
  let delivered = 0n;
  outputs.forEach((out, index) => {
    if (roles.has(index)) return;
    const address = String(out.address);
    if (sameAddress(address, deployment.feeAddress)) {
      feeOutputs.push(index);
      return;
    }
    // OX Agent: Authorization prevented by ownership check - every other output pays one of the wallet's addresses, at one of its own keys
    if (!ctx.ownAddresses.has(address) || !paysOwnKey(address, ctx.ownKeyHashes)) {
      refuse('OUTPUTS', "pays an address that is not the wallet's, the seller's, a royalty payee's or the fee address");
    }
    if (out.datum !== undefined || out.datumHash !== undefined || out.scriptReference !== undefined) {
      refuse('OUTPUTS', 'an output of the wallet carries a datum or a reference script');
    }
    ownOut += out.value.coins;
    forEachAsset(out, (unit, quantity) => {
      if (unit.toLowerCase() !== listing.unit) return;
      ownUnitOut += quantity;
      if (address === buyerAddress) delivered += quantity;
    });
  });

  // The fee: one untagged ADA output at the fee address, at least the fee, at most the fee or its own min-UTxO.
  if (feeOutputs.length !== 1) refuse('OUTPUTS', 'needs exactly one fee output at the fee address of the listing\'s deployment');
  const [feeIndex] = feeOutputs;
  const feeOut = outputs[feeIndex];
  if (!isAdaOnly(feeOut) || feeOut.datum !== undefined || feeOut.datumHash !== undefined || feeOut.scriptReference !== undefined) {
    refuse('OUTPUTS', 'the fee output is not plain ADA with no datum');
  }
  const feeMin = minUtxo(feeOut, cpb);
  const feeCeiling = fee >= feeMin ? fee : feeMin;
  if (feeOut.value.coins < fee) refuse('OUTPUTS', 'the fee output pays less than the market fee');
  if (feeOut.value.coins > feeCeiling) refuse('OUTPUTS', 'the fee output pays more than the market fee and its own min-UTxO');
  topUp += feeOut.value.coins - fee;

  // The NFT: delivered to the buyer address the user chose.
  if (delivered < 1n) refuse('OUTPUTS', 'does not deliver the NFT to the buyer address');

  return { topUp, ownOut, ownUnitOut };
}

/** Whether `out` holds lovelace and nothing else. */
function isAdaOnly(out: Cardano.TxOut): boolean {
  let assets = 0;
  forEachAsset(out, () => assets++);
  return assets === 0;
}

/**
 * Whether the output's inline datum is the listing tag: a byte string of the 32 tag bytes. Read
 * from the transaction's own bytes, as the contract compares the datum's value, not its encoding.
 */
function hasTag(out: Serialization.TransactionOutput, tag: string): boolean {
  const bytes = out.datum()?.asInlineData()?.asBoundedBytes();
  return bytes !== undefined && bytesToHex(bytes) === tag;
}

/**
 * The minimum ADA the wallet allows an output to be raised to: `(160 + size) * coinsPerUtxoByte`
 * over the CANONICAL encoding of the output, its coin included (ruling P29). Not over the bytes
 * the builder wrote: a datum padded with empty chunks of an indefinite-length byte string means
 * the same value, costs the buyer thousands of lovelace per byte, and would turn a "min-UTxO
 * top-up" into a payment of tens of ADA to a payee. Re-encoding drops the padding, a
 * non-minimal integer head and any other non-canonical form. The honest case is unchanged: a
 * seller output with a 32-byte tag is 108 bytes, 268 * 4310 = 1,155,080 lovelace. A builder whose
 * encoding is larger than canonical is refused here (a false refusal that fails closed).
 */
function minUtxo(out: Cardano.TxOut, cpb: bigint): bigint {
  const canonical = Serialization.TransactionOutput.fromCore(out).toCbor();
  return BigInt(MIN_UTXO_OVERHEAD_BYTES + canonical.length / 2) * cpb;
}

const sameAddress = (a: unknown, b: unknown) => String(a).toLowerCase() === String(b).toLowerCase();
