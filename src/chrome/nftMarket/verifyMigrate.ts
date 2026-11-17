// The wallet's own check of a migrate Nexus built, before anything is signed (spec 5.7, NFT
// rescue + Gero market). A migrate is ONE transaction: the owner-signed cancel of a listing on
// the closed marketplace's contract (the phase 0 rescue) whose NFT goes straight into a NEW Gero
// listing instead of back to the wallet. Pure and fail closed: every rule below either holds or
// the transaction is refused with a MarketVerifyError naming the rule. Nothing Nexus says about
// the transaction is trusted; only the CBOR is read, against what the user asked for.
//
// Both halves are checked, each by the code of its own family, so neither can drift from the
// transaction it is also used in:
//  - the legacy half is `checkLegacySpend` (legacyCancelVerify.ts), the very checks the rescue's
//    cancel passes: the inputs are the one legacy listing plus the wallet's own UTxOs, the
//    reference inputs are exactly that contract's reference script, the only redeemer is that
//    contract's cancel at the listing's place in the ledger's input order, and the required
//    signer is exactly the listing's owner, a key of the wallet;
//  - the Gero half is `checkNewListing` (verifyListing.ts), the rules a plain list passes: the
//    listing goes to the NEWEST deployment under the account's own stake key, holds the legacy
//    NFT once plus at most MAX_LISTING_DEPOSIT of ADA, and its inline datum is the user's
//    intent (owner, seller address, price, royalties, no buyer, the share floors, only a (222)
//    token of a CIP-68 asset).
//
// What a migrate that passes can do to the wallet:
//  - cancel exactly one legacy LISTING (an offer holds no NFT, so it is never a migrate) and
//    run only the legacy Plutus V2 script: no Gero script input, no Gero reference input, no
//    other redeemer;
//  - spend the wallet's own UTxOs for the fee;
//  - pay exactly one output to a Gero listing script, holding the legacy NFT and nothing else,
//    and every other output to the wallet's own key addresses with no datum and no reference
//    script (an output to the legacy contract or to anyone else is refused);
//  - pay a fee of at most 2 ADA and, if a script fails anyway, lose at most 5 ADA of the
//    wallet's own collateral, or none when it is the Nexus pool UTxO Nexus said it lent;
//  - be valid for a window of at most NFT_MARKET_MAX_VALIDITY_SLOTS with BOTH bounds, which the
//    legacy cancel verifier does not ask for.
// It cannot mint, burn, certify, withdraw, vote, propose, donate or carry metadata.
//
// Mainnet only: the legacy contracts exist nowhere else. The mainnet Gero deployment list is
// EMPTY in phase 1, and an empty list is a NETWORK refusal, so no migrate is signed on mainnet
// until that list is reviewed and filled (spec 9); migrate there is exercised by dry run only.

import { Cardano } from '@cardano-sdk/core';
import {
  checkLegacySpend,
  requestedItems,
  type LegacyCancelVerifyContext,
  type RefuseLegacySpend,
} from '@/chrome/legacyCancelVerify';
import {
  MarketVerifyError,
  checkEnvelope,
  checkNewListing,
  checkOutputs,
  economics,
  priced,
  type ListIntent,
  type ListSummary,
  type MarketVerifyContext,
  type MarketVerifyRule,
} from '@/chrome/nftMarket/verifyListing';
import { checkCollateral, readTransaction } from '@/chrome/txVerifyCommon';
import { LEGACY_CANCEL_MAX_COLLATERAL, LEGACY_CANCEL_MAX_FEE, type LegacyContract } from '@/utils/legacyMarketScripts';
import { NFT_MARKET_MAX_COLLATERAL_LOVELACE, NFT_MARKET_MAX_FEE_LOVELACE } from '@/utils/nftMarketDeployments';

/** Throws the market's error. A declaration, so control-flow analysis sees it never returns. */
function refuse(rule: MarketVerifyRule, detail: string): never {
  throw new MarketVerifyError(rule, detail);
}

/** The legacy spend checks refuse with the rescue's rules; the market has no rule for a reference input of its own. */
const refuseSpend: RefuseLegacySpend = (rule, detail) => refuse(rule === 'REFERENCE_INPUTS' ? 'INPUTS' : rule, detail);

/** What the wallet worker knows when it verifies a migrate: the market's context and the rescue's. */
export type MigrateVerifyContext = MarketVerifyContext
  & Omit<LegacyCancelVerifyContext, 'returnAddress'>
  & {
    /** Unused: the NFT goes into the listing, not to a return address. Accepted so the rescue's context passes as it is. */
    returnAddress?: string;
  };

/** What the user asked to move. */
export interface MigrateIntent {
  /** The legacy listing to move, `txHash#outputIndex`. Exactly one; an offer is refused. */
  legacyRef: string;
  /** The Gero listing it becomes. `list.unit` must be the NFT the legacy listing holds. */
  list: ListIntent;
}

/** What the review screen shows, read from the verified migrate. All amounts are lovelace as decimal strings. */
export interface MigrateSummary extends ListSummary {
  /** The legacy listing moved, `txHash#outputIndex`. */
  legacyRef: string;
  legacyContract: LegacyContract;
  /** Present only when the transaction's collateral is the lent Nexus pool UTxO. */
  sponsoredCollateralRef?: string;
}

const min = (a: bigint, b: bigint) => (a < b ? a : b);
/** A migrate runs a legacy script AND is a market transaction, so it is held to the stricter of the two caps. */
const MAX_FEE = min(LEGACY_CANCEL_MAX_FEE, NFT_MARKET_MAX_FEE_LOVELACE);
const MAX_COLLATERAL = min(LEGACY_CANCEL_MAX_COLLATERAL, NFT_MARKET_MAX_COLLATERAL_LOVELACE);

/**
 * Check `txCbor` against moving the legacy listing `intent.legacyRef` into the Gero listing
 * `intent.list` and return what it does, or throw MarketVerifyError. `txHash` is the id Nexus
 * reported; it must equal the id computed here from the body's own bytes.
 */
export function verifyMigrate(
  txCbor: string,
  txHash: string,
  intent: MigrateIntent,
  ctx: MigrateVerifyContext,
): MigrateSummary {
  const { serialized, tx, txId } = readTransaction(txCbor, txHash, refuse);
  const body = tx.body;

  // Network and envelope: mainnet (the legacy contracts exist nowhere else); the market is
  // configured here (an empty deployment list is a refusal); the body's network id; the fields no
  // market transaction uses; and a bounded validity window with both bounds.
  if (ctx.networkId !== Cardano.NetworkId.Mainnet) refuse('NETWORK', 'the legacy contracts are mainnet only');
  checkEnvelope(tx, ctx);

  // What is moved: exactly one legacy LISTING holding exactly one NFT, the one the user is listing.
  const legacyRef = intent?.legacyRef;
  if (typeof legacyRef !== 'string') refuse('INPUTS', 'must move exactly one legacy listing');
  const [item] = requestedItems([legacyRef], ctx.items, refuseSpend);
  if (item.kind !== 'listing') refuse('INPUTS', 'an offer holds no NFT, so there is nothing to list');
  if (item.assets.length !== 1 || BigInt(item.assets[0].quantity) !== 1n) {
    refuse('NFT', 'a legacy listing is moved with exactly one NFT and nothing else');
  }
  const unit = item.assets[0].unit.toLowerCase();
  if (typeof intent.list?.unit !== 'string' || intent.list.unit.toLowerCase() !== unit) {
    refuse('NFT', 'the NFT to list is not the one the legacy listing holds');
  }

  // The legacy half: the rescue's own checks on inputs, reference script, redeemer and signer.
  const spent = checkLegacySpend(serialized, tx, [item], ctx, refuseSpend);
  for (const ref of spent.inputRefs) {
    if (ctx.ownListings.has(ref)) refuse('INPUTS', `spends ${ref}, a Gero listing, which a migrate never does`);
  }

  // The Gero half: the one output that would have returned the NFT is the new listing, and every
  // other output is a plain payment to the wallet.
  const { listings } = checkOutputs(tx, ctx);
  if (listings.length !== 1) refuse('LISTING', 'must pay exactly one output to a listing script, the moved NFT');
  const [listing] = listings;
  const facts = checkNewListing(serialized, listing.index, listing.out, listing.deployment, intent.list, ctx);

  // Fee and collateral.
  if (body.fee > MAX_FEE) refuse('FEE', 'is above the cap');
  const sponsored = checkCollateral(body, spent.inputRefs, spent.ownByRef, {
    ownAddresses: ctx.ownAddresses,
    ownKeyHashes: ctx.ownKeyHashes,
    sponsoredCollateralRef: ctx.sponsoredCollateralRef,
    maxAtRiskLovelace: MAX_COLLATERAL,
  }, refuse);

  return {
    txId,
    legacyRef,
    legacyContract: item.contract,
    unit: facts.unit,
    listingAddress: String(listing.out.address),
    listingOutputIndex: listing.index,
    deploymentVersion: facts.deployment.version,
    royalties: facts.datum.royalties.map((r) => ({ address: r.address, lovelace: r.lovelace.toString() })),
    ...priced(facts.datum.price, facts.depositLovelace, body.fee, economics(facts.datum, facts.deployment)),
    ...(sponsored ? { sponsoredCollateralRef: ctx.sponsoredCollateralRef } : {}),
  };
}
