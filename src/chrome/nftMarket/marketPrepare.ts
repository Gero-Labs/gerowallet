// NFT_MARKET_PREPARE_{LIST,REPRICE,CANCEL,BUY,MIGRATE}: turn what the user asked for into one
// verified, unsigned Gero market transaction. Background only. The page names only the thing
// (an NFT and a price, or a listing ref); the worker chooses every address, key and input itself
// from the logged wallet's record (never from the request), reads what it must (the collection's
// royalties, the listing, the legacy item), asks Nexus to build, and hands the CBOR back only
// after the wallet's own verifier (verifyListing.ts, verifyBuy.ts, verifyMigrate.ts) accepted
// exactly those bytes. The page then signs and submits that CBOR untouched.
//
//   list     { unit, priceLovelace, confirmRoyaltyAboveCap? }   the worker finds the UTxO holding
//            the NFT, takes `owner` from its payment key and the stake credential from the
//            account's own base address, computes the royalties from the NFT's own policy
//   reprice  { ref, priceLovelace }                              ref must be one of the wallet's own listings
//   cancel   { ref }                                             the NFT returns to the wallet's receive address
//   buy      { ref }                                             the listing is read twice (Nexus, and the chain, proven
//                                                                against the transaction id) and the buy is checked against both
//   migrate  { legacyRef, priceLovelace, confirmRoyaltyAboveCap? }   a legacy listing's NFT goes straight into a Gero listing (mainnet only)
//
// Answers { success: true, result: { txCbor, txId, summary } } or { success: false, error,
// errorCode, ...details }, with `sendResponse` called exactly once on every path.
//
// On success the worker grants the market signing allowance (marketAllowance.ts) for that
// transaction id with the hits `findMarketTouch` finds in the VERIFIED transaction, the same
// reasons WalletBg.signTx will compute when the page asks to sign, so only these bytes can be
// signed, once. A buy touches no listing of the wallet and grants nothing (it would only empty
// another flow's slot). Nexus pool collateral a build lent is marked, as for the legacy rescue.
//
// Software wallets (password, PassKey, Google) and the hardware wallets in
// NFT_MARKET_HARDWARE_WALLET_TYPES (empty until each device has signed a real market
// transaction). Cardano on a network with a reviewed deployment list (mainnet's is empty in
// phase 1); migrate also needs mainnet, where the legacy contracts are.
//
// Error codes (`errorCode`; a Nexus 422's own code is passed through as it is):
//   INVALID_REQUEST             the body is not what the kind takes
//   WALLET_UNSUPPORTED          no wallet, not Cardano, a type that may not sign, or keys not loaded
//   NETWORK_UNSUPPORTED         no deployment on this network (or migrate off mainnet)
//   WALLET_CHANGED              the logged wallet changed while something was awaited
//   NFT_NOT_FOUND               list: the wallet does not hold exactly this one NFT at one of its key addresses
//   PRICE_TOO_LOW               the price is under MIN_LIST_PRICE
//   SELLER_SHARE_TOO_LOW        price - fee - royalties would be under MIN_SELLER_SHARE
//   ROYALTIES_UNREADABLE        the collection's royalty terms could not be read (never listed without them)
//   ROYALTIES_MALFORMED         the terms contradict themselves
//   ROYALTY_CONFIRMATION_REQUIRED  above ROYALTY_RATE_CAP; details: effectiveRoyaltyLovelace, effectiveRoyaltyRate, royaltyRate
//   LISTING_NOT_FOUND           reprice/cancel: not among the wallet's own listings; buy: Nexus or the chain has no such listing
//   LISTING_UNREADABLE          the listing (or the legacy lookup) could not be read or did not read back whole
//   OWN_LISTING                 buy: the listing is the wallet's own
//   NOT_OWNED                   migrate: the legacy item is under another owner
//   OFFER_NOT_MOVABLE           migrate: an offer holds no NFT
//   BUILD_FAILED                Nexus could not build, with no code, or anything unexpected
//   VERIFY_FAILED               the built transaction is not what was asked for; `error` is the MarketVerifyError rule

import { Cardano, Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import type { Keys } from '@/models/types';
import { Network } from '@/models/types';
import { getErrorMessage } from '@/shared/utils/errorHandler';
import { debugLog } from '@/utils/debug';
import { SENDER, TARGET } from '@/chrome/config';
import { forEachAsset } from '@/api/nexusInputSelection';
import { legacyRef, type LegacyListingItem } from '@/api/legacy-listings-api';
import {
  nexusErrorCode,
  walletUtxosToNexusInputs,
  type NftMarketBuildResponse,
  type NftMarketBuyBuildRequest,
  type NftMarketCancelBuildRequest,
  type NftMarketListBuildRequest,
  type NftMarketMigrateBuildRequest,
  type NftMarketRepriceBuildRequest,
} from '@/api/nexus-tx-api';
import type { ListingDto, ListingRef, RoyaltyInfo } from '@/api/nft-market-api';
import { ownKeys } from '@/chrome/cip113PrepareTransfer';
import { keyAddressUtxos } from '@/chrome/legacyCancelPrepare';
import {
  CIP68_USER_TOKEN_LABEL,
  MAX_LIST_PRICE,
  MIN_LIST_PRICE,
  MIN_SELLER_SHARE,
  NFT_UNIT_PATTERN as UNIT,
  POLICY_ID_HEX_LENGTH as POLICY_HEX_LENGTH,
  type NftMarketDeployment,
} from '@/utils/nftMarketDeployments';
import { canUseNftMarketWallet } from '@/utils/nftMarketGate';
import { listingSplit } from './listingDatum';
import { ListingUtxoError, type ListingChainUtxo } from './listingChainUtxo';
import { findMarketTouch } from './marketGuard';
import { reviveOwnListings, type OwnListing } from './ownListings';
import { computeRoyalties, protocolParameter, royaltyMinUtxoFor, royaltyOutputMinUtxo } from './royalties';
import { verifyBuy, type BuySummary } from './verifyBuy';
import {
  MarketVerifyError,
  cip68Label,
  newestDeployment,
  verifyCancel,
  verifyList,
  verifyReprice,
  type CancelSummary,
  type ListIntent,
  type ListSummary,
  type MarketVerifyContext,
  type RepriceSummary,
} from './verifyListing';
import { verifyMigrate, type MigrateSummary } from './verifyMigrate';

// Moved to royalties.ts so the pages that preview a listing can read it without the worker's handlers.
export { royaltyOutputMinUtxo };

export type MarketAction = 'list' | 'reprice' | 'cancel' | 'buy' | 'migrate';

/** Most UTxOs offered to one build: what Nexus's legacy cancel takes, the same candidate-selection limit. */
export const MARKET_MAX_FEE_INPUTS = 50;

const UTXO_REF = /^[0-9a-f]{64}#\d{1,5}$/;
/** A canonical lovelace amount: no sign, no exponent, no leading zero. */
const PRICE_TEXT = /^(0|[1-9][0-9]{0,16})$/;

export type MarketPrepareErrorCode = string;

export class MarketPrepareError extends Error {
  constructor(
    readonly code: MarketPrepareErrorCode,
    message: string,
    /** Extra string fields for the reply (what a confirmation would cost). */
    readonly details: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = 'MarketPrepareError';
  }
}

export interface MarketBuilders {
  list: (request: NftMarketListBuildRequest, network: string) => Promise<NftMarketBuildResponse>;
  reprice: (request: NftMarketRepriceBuildRequest, network: string) => Promise<NftMarketBuildResponse>;
  cancel: (request: NftMarketCancelBuildRequest, network: string) => Promise<NftMarketBuildResponse>;
  buy: (request: NftMarketBuyBuildRequest, network: string) => Promise<NftMarketBuildResponse>;
  migrate: (request: NftMarketMigrateBuildRequest, network: string) => Promise<NftMarketBuildResponse>;
}

/** The logged-in wallet, as far as the handlers need it. */
export interface MarketHandlerWallet {
  id: number;
  chain: string;
  network: string;
  type: string;
  /** The account's receive address: where proceeds, returned NFTs, bought NFTs and change go. */
  baseAddress: string;
}

export interface MarketHandlerState {
  /** The wallet's spendable UTxOs (the listed and programmable ones are not among them). */
  utxos?: readonly Cardano.Utxo[] | null;
  keys?: Partial<Keys> | null;
  /** The UTxO kept aside as dApp collateral; not offered as a fee input. */
  collateral?: Cardano.Utxo | null;
  /** `walletStore.listedListings`: the wallet's own verified listings. */
  listedListings?: readonly OwnListing[] | null;
  /** `NetworkStore.state.epochParams.coinsPerUtxoByte`, as the store holds it. */
  coinsPerUtxoByte?: unknown;
}

export interface MarketHandlerDeps {
  /** Resolves once the worker has restored the wallet (background.ts `booted`). */
  booted: () => Promise<unknown>;
  getWallet: () => MarketHandlerWallet | null | undefined;
  getState: () => MarketHandlerState;
  /** Every deployment of the network, newest first (`networks.resolveNftMarketDeployments`). Empty: unsupported. */
  deployments: (chain: string, network: string) => readonly NftMarketDeployment[];
  build: MarketBuilders;
  /** `nftMarketApi.listing`: Nexus's row for one listing. */
  lookupListing: (ref: ListingRef, network: string) => Promise<ListingDto>;
  /** `fetchListingUtxoProven`: the same listing as the chain has it, proven against its transaction id. */
  lookupChainUtxo: (ref: ListingRef, network: string) => Promise<ListingChainUtxo>;
  /** `fetchLegacyListings`: the legacy UTxOs of these owners still unspent. */
  lookupLegacy: (ownerPkhs: string[], network: string) => Promise<LegacyListingItem[]>;
  /** `nftMarketApi.royalties`: a policy's royalty terms. */
  royalties: (policyId: string, network: string) => Promise<RoyaltyInfo>;
  /** Records the Nexus pool collateral a build lent, so a failed co-signature of it is fatal when signing. */
  markNexusLent: (ref: string) => void;
  /** `grantMarketSignAllowance`: the one signature a verified market transaction may get. */
  grantAllowance: (walletId: number, txId: string, hits: readonly string[]) => void;
  /**
   * `rememberVerifiedListing`: the listing output a verified list, reprice or migrate creates and the
   * datum owner the verifier checked, so NOTIFY_WATCH_LISTINGS (listingWatch.ts) can register it for the
   * sale alert from the worker's own verification and not from anything a page says.
   */
  rememberListing?: (walletId: number, txId: string, outputIndex: number, ownerPkh: string) => void;
}

/** What the list sheet shows the seller about the royalties that were not written into the datum. */
export interface RoyaltyNotes {
  /** Entries left out for being under min-UTxO or beyond the count limit. */
  dropped: { address: string; lovelace: string }[];
  /** Recipients with no usable address. */
  invalidRecipients: number;
}

export type MarketSummary =
  | (ListSummary & RoyaltyNotes)
  | RepriceSummary
  | CancelSummary
  | BuySummary
  | (MigrateSummary & RoyaltyNotes);

export interface MarketPrepared {
  /** The CBOR exactly as Nexus built it: sign and submit these bytes, never a re-encoding. */
  txCbor: string;
  txId: string;
  summary: MarketSummary;
  /** What the verified transaction touches (`findMarketTouch`); what the allowance covers. */
  hits: string[];
  sponsoredCollateralRef?: string;
  /** A list, reprice or migrate: the listing output it creates and the datum owner, as verified. */
  listing?: { outputIndex: number; ownerPkh: string };
}

// ---------------------------------------------------------------------------------------------
// The handler
// ---------------------------------------------------------------------------------------------

/**
 * The handler of MessageTypes.NFT_MARKET_PREPARE_<kind> (background.ts registers it on the
 * extension-pages channel; senderTrust.ts refuses every other sender). It answers
 * `{ success: true, result: { txCbor, txId, summary } }` or `{ success: false, error, errorCode }`
 * and calls `sendResponse` exactly once on every path.
 */
export function marketPrepareHandler(kind: MarketAction, deps: MarketHandlerDeps) {
  return async (request: { id?: unknown; data?: unknown }, sendResponse: (response: unknown) => void): Promise<void> => {
    let data: Record<string, unknown>;
    try {
      await deps.booted();
      const wallet = deps.getWallet();
      if (!wallet) throw new MarketPrepareError('WALLET_UNSUPPORTED', 'Wallet instance not available');
      const prepared = await prepareMarket(kind, request.data, deps, wallet);
      // Checked again, with nothing awaited since: the wallet may have switched while Nexus was building.
      assertWalletUnchanged(deps, wallet);
      // OX Agent: Authorization prevented by granting the one signature only for the exact verified transaction id and what it touches
      if (prepared.hits.length > 0) deps.grantAllowance(wallet.id, prepared.txId, prepared.hits);
      // A failed co-signature of Nexus pool collateral is then fatal in SIGN_TX, as for DUST.
      if (prepared.sponsoredCollateralRef) deps.markNexusLent(prepared.sponsoredCollateralRef);
      // The listing a sale alert may watch. Best effort: losing it only costs the alert, never the transaction.
      if (prepared.listing) {
        try {
          deps.rememberListing?.(wallet.id, prepared.txId, prepared.listing.outputIndex, prepared.listing.ownerPkh);
        } catch (e) {
          debugLog('NFT market prepare: the listing could not be remembered for the sale alert:', getErrorMessage(e));
        }
      }
      data = { success: true, result: { txCbor: prepared.txCbor, txId: prepared.txId, summary: prepared.summary } };
    } catch (error) {
      const known = error instanceof MarketPrepareError ? error : null;
      const code = known?.code ?? 'BUILD_FAILED';
      debugLog('NFT market prepare refused:', kind, code);
      // The message is ours and fixed, whatever failed: what Nexus or a library said is never
      // echoed back. `details` come first so no detail key can overwrite the three below.
      data = {
        ...(known?.details ?? {}),
        success: false,
        error: known ? known.message : 'The transaction could not be prepared',
        errorCode: code,
      };
    }
    // Once, and outside the try: a reply that throws must not be answered with a second one.
    try {
      sendResponse({ id: request.id, data, target: TARGET, sender: SENDER.extension });
    } catch (error) {
      debugLog('NFT market prepare could not reply:', getErrorMessage(error));
    }
  };
}

/** Build, verify and (in the handler) allow one market transaction. Throws MarketPrepareError. */
export async function prepareMarket(
  kind: MarketAction,
  request: unknown,
  deps: MarketHandlerDeps,
  wallet: MarketHandlerWallet,
): Promise<MarketPrepared> {
  const session = openSession(kind, deps, wallet);
  switch (kind) {
    case 'list': return prepareList(session, request);
    case 'reprice': return prepareReprice(session, request);
    case 'cancel': return prepareCancel(session, request);
    case 'buy': return prepareBuy(session, request);
    case 'migrate': return prepareMigrate(session, request);
    default: throw new MarketPrepareError('INVALID_REQUEST', 'Unknown market action');
  }
}

// ---------------------------------------------------------------------------------------------
// The session: everything the worker knows about the logged account when the request arrives
// ---------------------------------------------------------------------------------------------

interface Session {
  deps: MarketHandlerDeps;
  wallet: MarketHandlerWallet;
  network: string;
  networkId: Cardano.NetworkId;
  deployments: readonly NftMarketDeployment[];
  /** The deployment new listings go to. */
  newest: NftMarketDeployment;
  own: { addresses: Set<string>; keyHashes: Set<string> };
  /** The payment key hashes of the wallet's own addresses. */
  paymentKeys: ReadonlySet<string>;
  /**
   * The wallet's payment and change key hashes (the key set's own entries, even one without an
   * address yet): who may own a legacy listing, and the only hashes sent to a lookup. Never the
   * stake key.
   */
  ownerKeys: ReadonlySet<string>;
  /** The account's receive address (the record's, never the request's). */
  baseAddress: string;
  /** The account's stake KEY hash (56 hex, lower case): the stake part of every listing it makes. */
  stakeKeyHash: string;
  /**
   * The wallet's UTxOs at key addresses: never a script UTxO (a listing, a programmable base) and
   * never the reserved dApp collateral. What Nexus is offered and what the verifier calls the
   * wallet's own are this one set, so a transaction that spends the reserved UTxO is refused.
   */
  keyUtxos: Cardano.Utxo[];
  /** The wallet's own verified listings by `txHash#index`, bigints revived. */
  ownListings: Map<string, OwnListing>;
  coinsPerUtxoByte: bigint | undefined;
}

function openSession(kind: MarketAction, deps: MarketHandlerDeps, wallet: MarketHandlerWallet): Session {
  // The same predicate the pages read to decide whether to show the market's actions at all.
  if (!canUseNftMarketWallet(wallet.chain, wallet.type)) {
    throw new MarketPrepareError('WALLET_UNSUPPORTED', 'The market is not available for this wallet');
  }
  const deployments = deps.deployments(wallet.chain, wallet.network);
  if (!Array.isArray(deployments) || deployments.length === 0) {
    throw new MarketPrepareError('NETWORK_UNSUPPORTED', `The market is not available on ${wallet.network}`);
  }
  // The legacy contracts exist on mainnet only.
  if (kind === 'migrate' && wallet.network !== Network.MAINNET) {
    throw new MarketPrepareError('NETWORK_UNSUPPORTED', 'Moving a listing is available on mainnet only');
  }

  const state = deps.getState() ?? {};
  // The addresses and key hashes of THIS account, from its key set: never account 0, never a request.
  const own = ownKeys(state.keys);
  // OX Agent: Authorization prevented by requiring the receive address, where every output goes, to be one of the wallet's own key addresses
  if (!own.addresses.has(wallet.baseAddress)) {
    throw new MarketPrepareError('WALLET_UNSUPPORTED', "The wallet's receive address is not among its keys");
  }
  const stakeKeyHash = stakeKeyHashOf(wallet.baseAddress);
  // OX Agent: Authorization prevented by requiring the stake key listings sit under to be the account's own key
  if (!stakeKeyHash || !own.keyHashes.has(stakeKeyHash)) {
    throw new MarketPrepareError('WALLET_UNSUPPORTED', "The wallet's stake key is not among its keys");
  }
  const paymentKeys = new Set<string>();
  for (const address of own.addresses) {
    const hash = paymentKeyHashOf(address);
    if (hash) paymentKeys.add(hash);
  }
  return {
    deps,
    wallet,
    network: wallet.network,
    networkId: wallet.network === Network.MAINNET ? Cardano.NetworkId.Mainnet : Cardano.NetworkId.Testnet,
    deployments,
    newest: newestDeployment(deployments),
    own,
    paymentKeys,
    ownerKeys: ownerKeyHashes(state.keys),
    baseAddress: wallet.baseAddress,
    stakeKeyHash,
    keyUtxos: withoutReserved(keyAddressUtxos(state.utxos, own.addresses), state.collateral),
    ownListings: new Map(reviveOwnListings(state.listedListings).map((listing) => [listing.ref, listing])),
    coinsPerUtxoByte: protocolParameter(state.coinsPerUtxoByte),
  };
}

/** The key hashes of the key set's payment and change entries (lower case), never its stake or other keys. */
function ownerKeyHashes(keys: Partial<Keys> | null | undefined): Set<string> {
  const hashes = new Set<string>();
  for (const kind of ['payment', 'change'] as const) {
    for (const key of keys?.[kind] ?? []) {
      if (typeof key?.cred === 'string' && /^[0-9a-f]{56}$/.test(key.cred)) hashes.add(key.cred);
    }
  }
  return hashes;
}

/** `utxos` without the UTxO the wallet keeps aside as dApp collateral (matched by out-ref). */
function withoutReserved(utxos: Cardano.Utxo[], reserved: Cardano.Utxo | null | undefined): Cardano.Utxo[] {
  const txId = reserved?.[0]?.txId;
  if (!txId) return utxos;
  const index = reserved?.[0]?.index;
  return utxos.filter((utxo) => !(utxo[0].txId === txId && utxo[0].index === index));
}

/** Throws WALLET_CHANGED unless the logged wallet is still the one the request started with. */
function assertWalletUnchanged(deps: MarketHandlerDeps, wallet: MarketHandlerWallet): void {
  const current = deps.getWallet();
  if (current?.id !== wallet.id || current.chain !== wallet.chain || current.network !== wallet.network) {
    throw new MarketPrepareError('WALLET_CHANGED', 'The wallet changed while the transaction was being prepared');
  }
}

const unchanged = (s: Session) => assertWalletUnchanged(s.deps, s.wallet);

/** The stake KEY hash of a base address, lower case, or null for any other shape. */
function stakeKeyHashOf(address: string): string | null {
  try {
    const stake = Cardano.Address.fromBech32(address).asBase()?.getStakeCredential();
    return stake?.type === Cardano.CredentialType.KeyHash ? String(stake.hash).toLowerCase() : null;
  } catch {
    return null;
  }
}

/** The payment KEY hash of a base or enterprise address, lower case, or null (a script, a pointer, unreadable). */
function paymentKeyHashOf(address: string): string | null {
  try {
    const parsed = Cardano.Address.fromBech32(address);
    const payment = (parsed.asBase() ?? parsed.asEnterprise())?.getPaymentCredential();
    return payment?.type === Cardano.CredentialType.KeyHash ? String(payment.hash).toLowerCase() : null;
  } catch {
    return null;
  }
}

/** The context every verifier gets. `sponsoredCollateralRef` only when Nexus named a well-formed one. */
function verifyContext(s: Session, sponsoredCollateralRef?: string): MarketVerifyContext {
  return {
    networkId: s.networkId,
    deployments: s.deployments,
    ownUtxos: s.keyUtxos,
    ownAddresses: s.own.addresses,
    ownKeyHashes: s.own.keyHashes,
    ownListings: s.ownListings,
    stakeKeyHash: s.stakeKeyHash,
    ...(sponsoredCollateralRef ? { sponsoredCollateralRef } : {}),
  };
}

/** The UTxOs a build may spend: the plain key UTxOs, the reserved collateral left out. */
function feeInputs(s: Session, requiredAssets?: ReadonlyMap<string, bigint>) {
  // The reserved collateral is already out of the set.
  return walletUtxosToNexusInputs(s.keyUtxos, null, true, { limit: MARKET_MAX_FEE_INPUTS, requiredAssets });
}

// ---------------------------------------------------------------------------------------------
// Build and verify
// ---------------------------------------------------------------------------------------------

interface Verified<S> {
  built: NftMarketBuildResponse;
  summary: S;
  sponsoredCollateralRef?: string;
}

/**
 * Ask Nexus (`build`), then hold what comes back to the verifier. A Nexus failure keeps its code;
 * a verifier refusal is VERIFY_FAILED with the rule as `error` and nothing else (what Nexus
 * built is never quoted back); a wallet that changed while Nexus worked is WALLET_CHANGED.
 */
async function buildAndVerify<S>(
  s: Session,
  build: () => Promise<NftMarketBuildResponse>,
  verify: (built: NftMarketBuildResponse, ctx: MarketVerifyContext) => S,
): Promise<Verified<S>> {
  let built: NftMarketBuildResponse;
  try {
    built = await build();
  } catch (e) {
    // Nexus's code is passed through; its message never is (it is text from outside the wallet).
    throw new MarketPrepareError(nexusErrorCode(e) ?? 'BUILD_FAILED', 'The transaction could not be built');
  }
  unchanged(s);
  if (typeof built?.tx_cbor !== 'string' || typeof built?.tx_hash !== 'string') {
    throw new MarketPrepareError('BUILD_FAILED', 'Nexus returned no transaction');
  }
  const sponsoredCollateralRef = typeof built.sponsoredCollateralRef === 'string' && UTXO_REF.test(built.sponsoredCollateralRef)
    ? built.sponsoredCollateralRef
    : undefined;
  try {
    // OX Agent: Authorization prevented by verifying the built transaction against the user's intent and the wallet's own keys before it can be signed
    const summary = verify(built, verifyContext(s, sponsoredCollateralRef));
    return { built, summary, ...(sponsoredCollateralRef ? { sponsoredCollateralRef } : {}) };
  } catch (e) {
    if (e instanceof MarketVerifyError) {
      debugLog('NFT market prepare: transaction refused:', e.rule, e.message);
      throw new MarketPrepareError('VERIFY_FAILED', e.rule);
    }
    debugLog('NFT market prepare: unexpected verifier failure:', e);
    throw new MarketPrepareError('VERIFY_FAILED', 'UNEXPECTED');
  }
}

/** Package a verified transaction: the hits are what the signing guard will find in these very bytes. */
function finish(
  s: Session,
  verified: Verified<MarketSummary>,
  listing?: { outputIndex: number; ownerPkh: string },
): MarketPrepared {
  const tx = Serialization.Transaction.fromCbor(HexBlob(verified.built.tx_cbor)).toCore();
  const hits = findMarketTouch(tx, s.deployments, new Set(s.ownListings.keys()));
  const summary = verified.summary;
  // The verified summary names the lent collateral only when the transaction's collateral really is that UTxO.
  const sponsoredCollateralRef = (summary as { sponsoredCollateralRef?: string }).sponsoredCollateralRef;
  return {
    txCbor: verified.built.tx_cbor,
    txId: summary.txId,
    summary,
    hits,
    ...(sponsoredCollateralRef ? { sponsoredCollateralRef } : {}),
    ...(listing ? { listing } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// Reading the request
// ---------------------------------------------------------------------------------------------

function readRecord(request: unknown): Record<string, unknown> {
  if (typeof request !== 'object' || request === null || Array.isArray(request)) {
    throw new MarketPrepareError('INVALID_REQUEST', 'The request is not an object');
  }
  return request as Record<string, unknown>;
}

function readUnit(raw: unknown): string {
  const unit = typeof raw === 'string' ? raw.toLowerCase() : '';
  if (!UNIT.test(unit)) throw new MarketPrepareError('INVALID_REQUEST', 'The NFT is not a policy id and an asset name');
  return unit;
}

/** A price in lovelace, as canonical decimal text (a bigint does not cross the message channel). */
function readPrice(raw: unknown): bigint {
  if (typeof raw !== 'string' || !PRICE_TEXT.test(raw)) {
    throw new MarketPrepareError('INVALID_REQUEST', 'The price is not an amount of lovelace');
  }
  const price = BigInt(raw);
  if (price > MAX_LIST_PRICE) throw new MarketPrepareError('INVALID_REQUEST', 'The price is above the ADA supply');
  return price;
}

function readRef(raw: unknown): { ref: string; listingRef: ListingRef } {
  if (typeof raw !== 'string' || !UTXO_REF.test(raw)) {
    throw new MarketPrepareError('INVALID_REQUEST', 'The listing is not a transaction hash and an output index');
  }
  const [txHash, index] = raw.split('#');
  return { ref: raw, listingRef: { txHash, outputIndex: Number(index) } };
}

function checkPrice(price: bigint): void {
  if (price < MIN_LIST_PRICE) {
    throw new MarketPrepareError('PRICE_TOO_LOW', `The price is under the minimum of ${MIN_LIST_PRICE} lovelace`);
  }
}

/** The seller must keep at least MIN_SELLER_SHARE of the price after the market fee and the royalties. */
function checkSellerShare(price: bigint, deployment: NftMarketDeployment, royalties: readonly { lovelace: bigint }[]): void {
  if (listingSplit(price, royalties, deployment).sellerShare < MIN_SELLER_SHARE) {
    throw new MarketPrepareError('SELLER_SHARE_TOO_LOW', 'After the fee and royalties the seller would receive too little');
  }
}

/** Only an NFT is listed, and for CIP-68 only its (222) user token (never the reference token). */
function checkListableUnit(unit: string): void {
  const label = cip68Label(unit.slice(POLICY_HEX_LENGTH));
  if (label !== null && label !== CIP68_USER_TOKEN_LABEL) {
    debugLog('NFT market prepare: a CIP-68 token with label', label, 'is not listable');
    throw new MarketPrepareError('VERIFY_FAILED', 'NFT');
  }
}

// ---------------------------------------------------------------------------------------------
// Royalties
// ---------------------------------------------------------------------------------------------

/** `part / whole` as a decimal fraction with six digits, computed exactly (no float meets lovelace). */
function fractionText(part: bigint, whole: bigint): string {
  const micro = (part * 1_000_000n) / whole;
  return `${micro / 1_000_000n}.${(micro % 1_000_000n).toString().padStart(6, '0')}`;
}

interface ChosenRoyalties extends RoyaltyNotes {
  royalties: { address: string; lovelace: bigint }[];
}

/**
 * The royalties of a new listing, from the NFT's OWN policy only: read, computed (royalties.ts),
 * and held to what the seller must still receive. Above the cap nothing is built until the
 * seller has confirmed, and the refusal carries what it would cost so the page can show it.
 */
async function chooseRoyalties(s: Session, unit: string, price: bigint, confirmAboveCap: boolean): Promise<ChosenRoyalties> {
  let info: RoyaltyInfo;
  try {
    info = await s.deps.royalties(unit.slice(0, POLICY_HEX_LENGTH), s.network);
  } catch (e) {
    // Never a listing without its royalty terms: the creators would be paid nothing, for good.
    throw new MarketPrepareError(nexusErrorCode(e) ?? 'ROYALTIES_UNREADABLE', "The collection's royalty terms could not be read");
  }
  unchanged(s);

  // Capped at the reviewed ceiling, as verifyBuy does (the same threshold the list sheet previews with).
  const minUtxo = royaltyMinUtxoFor(s.coinsPerUtxoByte);
  let computed: ReturnType<typeof computeRoyalties>;
  let preview: ReturnType<typeof computeRoyalties> | null = null;
  try {
    computed = computeRoyalties(price, info, { confirmAboveCap, minUtxo });
    if (computed.needsConfirmation) preview = computeRoyalties(price, info, { confirmAboveCap: true, minUtxo });
  } catch (e) {
    debugLog('NFT market prepare: royalty computation failed:', e);
    throw new MarketPrepareError('ROYALTIES_MALFORMED', "The collection's royalty terms could not be understood");
  }
  if (computed.malformed || preview?.malformed) {
    throw new MarketPrepareError('ROYALTIES_MALFORMED', "The collection's royalty terms could not be understood");
  }
  if (computed.needsConfirmation && preview) {
    const effective = preview.royalties.reduce((sum, royalty) => sum + royalty.lovelace, 0n);
    throw new MarketPrepareError('ROYALTY_CONFIRMATION_REQUIRED', 'The royalties are above the usual limit and need the seller\'s confirmation', {
      effectiveRoyaltyLovelace: effective.toString(),
      effectiveRoyaltyRate: fractionText(effective, price),
      royaltyRate: preview.rate.toFixed(6),
    });
  }

  checkSellerShare(price, s.newest, computed.royalties);
  return {
    royalties: computed.royalties,
    dropped: computed.dropped.map((entry) => ({ address: entry.address, lovelace: entry.lovelace.toString() })),
    invalidRecipients: computed.invalidRecipients,
  };
}

const royaltyRequest = (royalties: ChosenRoyalties) =>
  royalties.royalties.map((royalty) => ({ address: royalty.address, lovelace: royalty.lovelace.toString() }));

const notes = (royalties: ChosenRoyalties): RoyaltyNotes => ({ dropped: royalties.dropped, invalidRecipients: royalties.invalidRecipients });

// ---------------------------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------------------------

/**
 * The UTxO that holds `unit` once, at one of the wallet's own key addresses, and the payment key
 * of that address: the key that will have to sign a cancel, so the listing's `owner`.
 */
function findNft(s: Session, unit: string): { ownerPkh: string } {
  let holders = 0;
  let total = 0n;
  let holder: Cardano.Utxo | undefined;
  for (const utxo of s.keyUtxos) {
    let held = 0n;
    forEachAsset(utxo[1], (u, quantity) => {
      if (u.toLowerCase() === unit) held += quantity;
    });
    if (held > 0n) {
      holders++;
      total += held;
      holder = utxo;
    }
  }
  if (!holder || holders !== 1 || total !== 1n) {
    throw new MarketPrepareError('NFT_NOT_FOUND', 'The wallet does not hold exactly one of this NFT');
  }
  const address = String(holder[1].address);
  const ownerPkh = paymentKeyHashOf(address);
  // OX Agent: Authorization prevented by requiring the NFT to sit at one of the wallet's own key addresses, so the owner is a key of this account
  if (!s.own.addresses.has(address) || !ownerPkh || !s.paymentKeys.has(ownerPkh)) {
    throw new MarketPrepareError('NFT_NOT_FOUND', "The NFT is not held at one of the wallet's own key addresses");
  }
  return { ownerPkh };
}

async function prepareList(s: Session, request: unknown): Promise<MarketPrepared> {
  const body = readRecord(request);
  const unit = readUnit(body['unit']);
  const price = readPrice(body['priceLovelace']);
  const confirmAboveCap = body['confirmRoyaltyAboveCap'] === true;
  checkPrice(price);
  checkListableUnit(unit);
  const { ownerPkh } = findNft(s, unit);
  const royalties = await chooseRoyalties(s, unit, price, confirmAboveCap);

  const intent: ListIntent = {
    unit,
    price,
    royalties: royalties.royalties,
    ownerPkh,
    sellerAddress: s.baseAddress,
    stakeCredential: s.stakeKeyHash,
  };
  const verified = await buildAndVerify(
    s,
    () => s.deps.build.list({
      unit,
      priceLovelace: price.toString(),
      ownerPkh,
      sellerAddress: s.baseAddress,
      stakeCredential: s.stakeKeyHash,
      buyerPkh: null,
      royalties: royaltyRequest(royalties),
      // The NFT's own UTxO is always among the candidates, in a wallet of any size.
      feeInputs: feeInputs(s, new Map([[unit, 1n]])),
      changeAddress: s.baseAddress,
    }, s.network),
    (built, ctx) => ({ ...verifyList(built.tx_cbor, built.tx_hash, intent, ctx), ...notes(royalties) }),
  );
  // verifyList checked the listing's datum names `ownerPkh` as owner, so the summary's output index and this key go together.
  return finish(s, verified, { outputIndex: verified.summary.listingOutputIndex, ownerPkh });
}

// ---------------------------------------------------------------------------------------------
// Reprice and cancel
// ---------------------------------------------------------------------------------------------

/** One of the wallet's own verified listings. Anything else (sold, never the wallet's) is "this listing changed". */
function ownListing(s: Session, ref: string): OwnListing {
  // OX Agent: Authorization prevented by acting only on a listing the wallet's own store verified as the wallet's
  const listing = s.ownListings.get(ref);
  if (!listing) throw new MarketPrepareError('LISTING_NOT_FOUND', 'This listing is not one of the wallet\'s own, or it has changed');
  return listing;
}

async function prepareReprice(s: Session, request: unknown): Promise<MarketPrepared> {
  const body = readRecord(request);
  const { ref, listingRef } = readRef(body['ref']);
  const price = readPrice(body['priceLovelace']);
  checkPrice(price);
  const listing = ownListing(s, ref);
  // The royalties stay as they are (R4), so the new price must still leave the seller their share.
  const deployment = s.deployments.find((d) => d.version === listing.deploymentVersion);
  if (!deployment) throw new MarketPrepareError('VERIFY_FAILED', 'LISTING');
  checkSellerShare(price, deployment, listing.datum.royalties);

  const verified = await buildAndVerify(
    s,
    () => s.deps.build.reprice({
      listingRef,
      priceLovelace: price.toString(),
      feeInputs: feeInputs(s),
      changeAddress: s.baseAddress,
      allowSponsoredCollateral: true,
    }, s.network),
    (built, ctx) => verifyReprice(built.tx_cbor, built.tx_hash, { ref, price }, ctx),
  );
  // verifyReprice refuses a datum whose owner is not the old listing's, so the new output keeps that owner.
  return finish(s, verified, { outputIndex: verified.summary.listingOutputIndex, ownerPkh: listing.datum.owner.toLowerCase() });
}

async function prepareCancel(s: Session, request: unknown): Promise<MarketPrepared> {
  const body = readRecord(request);
  const { ref, listingRef } = readRef(body['ref']);
  ownListing(s, ref);

  const verified = await buildAndVerify(
    s,
    () => s.deps.build.cancel({
      listingRef,
      returnAddress: s.baseAddress,
      feeInputs: feeInputs(s),
      changeAddress: s.baseAddress,
      allowSponsoredCollateral: true,
    }, s.network),
    (built, ctx) => verifyCancel(built.tx_cbor, built.tx_hash, { ref, returnAddress: s.baseAddress }, ctx),
  );
  return finish(s, verified);
}

// ---------------------------------------------------------------------------------------------
// Buy
// ---------------------------------------------------------------------------------------------

/** Whether a listing row names the wallet as its owner or its seller, whatever the store has recognised yet. */
function isOwnRow(s: Session, row: ListingDto): boolean {
  return s.own.keyHashes.has(String(row.ownerPkh).toLowerCase()) || s.own.addresses.has(String(row.sellerAddress));
}

async function prepareBuy(s: Session, request: unknown): Promise<MarketPrepared> {
  const body = readRecord(request);
  const { ref, listingRef } = readRef(body['ref']);
  // The wallet's own listing is cancelled, not bought; refused before anything is read.
  if (s.ownListings.has(ref)) throw new MarketPrepareError('OWN_LISTING', 'This is your own listing');

  let row: ListingDto;
  try {
    row = await s.deps.lookupListing(listingRef, s.network);
  } catch (e) {
    throw new MarketPrepareError(nexusErrorCode(e) ?? 'LISTING_UNREADABLE', 'The listing could not be read');
  }
  unchanged(s);
  if (!row || `${row.txHash}#${row.outputIndex}` !== ref) {
    throw new MarketPrepareError('LISTING_UNREADABLE', 'The listing that came back is not the one asked for');
  }
  if (isOwnRow(s, row)) throw new MarketPrepareError('OWN_LISTING', 'This is your own listing');

  // The listing as the chain has it, proven against its transaction id, from a source other
  // than Nexus: the datum Nexus supplied must be the one on chain (ruling P28, P30).
  let chainUtxo: ListingChainUtxo;
  try {
    chainUtxo = await s.deps.lookupChainUtxo(listingRef, s.network);
  } catch (e) {
    if (e instanceof ListingUtxoError && e.code === 'NOT_FOUND') {
      throw new MarketPrepareError('LISTING_NOT_FOUND', 'The listing was not found on chain');
    }
    throw new MarketPrepareError('LISTING_UNREADABLE', 'The listing could not be confirmed on chain');
  }
  unchanged(s);

  const verified = await buildAndVerify(
    s,
    () => s.deps.build.buy({
      listingRef,
      buyerAddress: s.baseAddress,
      feeInputs: feeInputs(s),
      changeAddress: s.baseAddress,
      allowSponsoredCollateral: true,
    }, s.network),
    (built, ctx) => verifyBuy(
      built.tx_cbor,
      built.tx_hash,
      { listing: row, buyerAddress: s.baseAddress, chainUtxo },
      { ...ctx, ...(s.coinsPerUtxoByte !== undefined ? { coinsPerUtxoByte: s.coinsPerUtxoByte } : {}) },
    ),
  );
  return finish(s, verified);
}

// ---------------------------------------------------------------------------------------------
// Migrate
// ---------------------------------------------------------------------------------------------

/**
 * The wallet's legacy UTxOs by `txHash#index`: what the lookup returns for the wallet's payment
 * and change key hashes (never its stake key), minus anything whose owner is not one of them
 * (the lookup is asked about the wallet's keys, so another owner in its answer is a fault, not
 * an item to move). Those are kept apart so
 * a ref among them is refused as not the wallet's rather than as gone.
 */
async function lookUpOwnItems(s: Session): Promise<{ items: Map<string, LegacyListingItem>; foreign: Set<string> }> {
  let listed: LegacyListingItem[];
  try {
    listed = await s.deps.lookupLegacy([...s.ownerKeys], s.network);
  } catch (e) {
    throw new MarketPrepareError(nexusErrorCode(e) ?? 'LISTING_UNREADABLE', "The wallet's listings could not be looked up");
  }
  unchanged(s);
  const items = new Map<string, LegacyListingItem>();
  const foreign = new Set<string>();
  for (const item of Array.isArray(listed) ? listed : []) {
    if (!item || typeof item !== 'object') continue;
    if (s.ownerKeys.has(item.ownerPkh)) items.set(legacyRef(item), item);
    else foreign.add(legacyRef(item));
  }
  return { items, foreign };
}

async function prepareMigrate(s: Session, request: unknown): Promise<MarketPrepared> {
  const body = readRecord(request);
  const { ref, listingRef } = readRef(body['legacyRef']);
  const price = readPrice(body['priceLovelace']);
  const confirmAboveCap = body['confirmRoyaltyAboveCap'] === true;
  checkPrice(price);

  const { items, foreign } = await lookUpOwnItems(s);
  // OX Agent: Authorization prevented by looking the item up under the wallet's own key hashes and refusing one whose owner is not among them
  if (foreign.has(ref)) throw new MarketPrepareError('NOT_OWNED', 'This listing does not belong to this wallet');
  // Asked about the wallet's own keys, the lookup returns every one of their UTxOs still unspent:
  // a ref it no longer returns was spent since the list was read (sold, or cancelled elsewhere).
  const item = items.get(ref);
  if (!item) throw new MarketPrepareError('LISTING_NOT_FOUND', 'This item is no longer locked');
  if (item.kind !== 'listing') throw new MarketPrepareError('OFFER_NOT_MOVABLE', 'An offer holds no NFT, so there is nothing to list');

  // Exactly one NFT, and only a user token: the unit comes from the lookup, never from the page.
  const [asset] = item.assets;
  const unit = typeof asset?.unit === 'string' ? asset.unit.toLowerCase() : '';
  if (item.assets.length !== 1 || !/^[0-9]{1,18}$/.test(String(asset.quantity)) || BigInt(asset.quantity) !== 1n || !UNIT.test(unit)) {
    throw new MarketPrepareError('VERIFY_FAILED', 'NFT');
  }
  checkListableUnit(unit);

  // The legacy owner signs the cancel half; the new listing is owned by that key when it is one
  // of the account's payment keys, else by the account's receive key.
  const ownerPkh = s.paymentKeys.has(item.ownerPkh) ? item.ownerPkh : paymentKeyHashOf(s.baseAddress);
  if (!ownerPkh) throw new MarketPrepareError('WALLET_UNSUPPORTED', "The wallet's receive address has no payment key");

  const royalties = await chooseRoyalties(s, unit, price, confirmAboveCap);
  const intent: ListIntent = {
    unit,
    price,
    royalties: royalties.royalties,
    ownerPkh,
    sellerAddress: s.baseAddress,
    stakeCredential: s.stakeKeyHash,
  };
  const verified = await buildAndVerify(
    s,
    () => s.deps.build.migrate({
      legacyRef: listingRef,
      priceLovelace: price.toString(),
      ownerPkh,
      sellerAddress: s.baseAddress,
      stakeCredential: s.stakeKeyHash,
      royalties: royaltyRequest(royalties),
      feeInputs: feeInputs(s),
      changeAddress: s.baseAddress,
      allowSponsoredCollateral: true,
    }, s.network),
    (built, ctx) => ({
      ...verifyMigrate(built.tx_cbor, built.tx_hash, { legacyRef: ref, list: intent }, { ...ctx, items }),
      ...notes(royalties),
    }),
  );
  return finish(s, verified, { outputIndex: verified.summary.listingOutputIndex, ownerPkh });
}
