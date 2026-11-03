// NOTIFY_WATCH_LISTINGS: register a Gero market listing with gero-sync so the wallet gets an
// `nft_sold` push when it is bought (spec 8.1, watch-and-poll as for swap orders). Background only.
//
// The page that just listed, repriced or moved something sends this once the submit went through.
// A page is untrusted input to the worker (Ruling P18), so it supplies a hint at most and the
// worker decides every field of what goes to gero-sync:
//
//   wallet   always the LOGGED wallet. A `walletId` in the request is checked against it and a
//            mismatch is refused (the user switched wallets: the listing is not that wallet's).
//   listing  a ref (`txId#outputIndex`) the worker verified itself: prepare (marketPrepare.ts)
//            remembers every list, reprice and migrate it verified (the listing output's index and
//            the datum's owner, both from the verified transaction), or the ref is one of the
//            wallet's own verified listings (`walletStore.listedListings`, for a later
//            registration after the worker restarted). Any other ref is refused: a page cannot get
//            gero-sync to watch an arbitrary listing under this wallet.
//   owner    that listing's datum owner, which must also be a payment key of the logged account's
//            key set. A page-supplied `ownerPkh` is only compared to it, never used.
//   refs     one to LISTING_WATCH_MAX_REFS, each matching gero-sync's own shape, unique.
//
// Never fatal and never blocking: the answer is `{ success, result: { result: 'ok' | 'not_registered'
// | 'failed' } }`, a device with no push registration or a refusal by the server (a 422
// `limit_exceeded` on the wallet's pending watches included) is not an error the page shows.
// `sendResponse` is called exactly once on every path (CLAUDE.md, Chrome messaging).

import { Blockchain, type Keys } from '@/models/types';
import { SENDER, TARGET } from '@/chrome/config';
import type { WatchListingsInput, WatchListingsResult } from '@/services/notify/notifyRegistration';
import { debugLog } from '@/utils/debug';
import { ownListingIdentity, type OwnListing } from './ownListings';

/** gero-sync's own shape of a listing ref: a transaction hash, `#`, and an index without leading zeros of at most five digits. */
export const LISTING_WATCH_REF = /^[0-9a-f]{64}#(?:0|[1-9][0-9]{0,4})$/;

/** Most refs one request may carry: a list, reprice or migrate creates one listing output. */
export const LISTING_WATCH_MAX_REFS = 3;

/** How long a verified listing stays registrable: the signing grant's window plus the submit. */
export const REMEMBERED_LISTING_TTL_MS = 30 * 60_000;

/** The most verified listings held at once: past it, the oldest is dropped. */
export const REMEMBERED_LISTING_MAX = 32;

const TX_ID = /^[0-9a-f]{64}$/;
const KEY_HASH = /^[0-9a-f]{56}$/;
const KEY_HASH_ANY_CASE = /^[0-9a-fA-F]{56}$/;
const MAX_OUTPUT_INDEX = 99_999;

// ---------------------------------------------------------------------------------------------
// What the worker verified: the listing outputs of its own prepared transactions
// ---------------------------------------------------------------------------------------------

interface Remembered {
  ownerPkh: string;
  expiresAt: number;
}

// Insertion order is age order. In memory only: a worker restart forgets them, and the page's
// registration then falls back to the wallet's verified listings (or is refused, which is fine).
const remembered = new Map<string, Remembered>();

const rememberedKey = (walletId: number, ref: string) => `${walletId}:${ref}`;

function pruneExpired(now: number): void {
  for (const [key, entry] of remembered) if (now >= entry.expiresAt) remembered.delete(key);
}

/**
 * Remember that the worker verified a transaction creating the listing at `txId#outputIndex` for
 * `walletId`, with `ownerPkh` as the datum's owner. Called by the prepare handlers with what
 * `verifyList`, `verifyReprice` and `verifyMigrate` checked, never with anything a page said.
 * An entry that is not a transaction id, an output index or a key hash is dropped.
 */
export function rememberVerifiedListing(walletId: number, txId: string, outputIndex: number, ownerPkh: string, now = Date.now()): void {
  if (!Number.isSafeInteger(walletId) || typeof txId !== 'string' || !TX_ID.test(txId)) return;
  if (!Number.isSafeInteger(outputIndex) || outputIndex < 0 || outputIndex > MAX_OUTPUT_INDEX) return;
  if (typeof ownerPkh !== 'string' || !KEY_HASH_ANY_CASE.test(ownerPkh)) return;
  pruneExpired(now);
  const key = rememberedKey(walletId, `${txId}#${outputIndex}`);
  remembered.delete(key);
  while (remembered.size >= REMEMBERED_LISTING_MAX) remembered.delete(remembered.keys().next().value as string);
  remembered.set(key, { ownerPkh: ownerPkh.toLowerCase(), expiresAt: now + REMEMBERED_LISTING_TTL_MS });
}

/** Test seam, and the worker's reset: forget everything verified so far. */
export function forgetVerifiedListings(): void {
  remembered.clear();
}

function verifiedOwnerOf(walletId: number, ref: string, listed: readonly OwnListing[], now: number): string | null {
  const entry = remembered.get(rememberedKey(walletId, ref));
  if (entry && now < entry.expiresAt) return entry.ownerPkh;
  const own = listed.find((listing) => listing?.ref === ref);
  const owner = typeof own?.datum?.owner === 'string' ? own.datum.owner.toLowerCase() : '';
  return KEY_HASH.test(owner) ? owner : null;
}

// ---------------------------------------------------------------------------------------------
// The handler
// ---------------------------------------------------------------------------------------------

export interface ListingWatchWallet {
  id: number;
  chain: string;
  network: string;
  type: string;
}

export interface ListingWatchDeps {
  /** Resolves once the worker has restored the wallet (background.ts `booted`). */
  booted: () => Promise<unknown>;
  getWallet: () => ListingWatchWallet | null | undefined;
  getState: () => {
    /** The logged account's key set: the payment and change keys are who may own a listing. */
    keys?: Partial<Keys> | null;
    /** `walletStore.listedListings`: the wallet's own verified listings. */
    listedListings?: readonly OwnListing[] | null;
  };
  /** `notifyActions.watchListings`: the signed POST to gero-sync, never rejecting for a server refusal. */
  watch: (input: WatchListingsInput) => Promise<WatchListingsResult>;
}

class ListingWatchError extends Error {
  constructor(readonly code: 'INVALID_REQUEST' | 'WALLET_UNSUPPORTED' | 'WALLET_CHANGED' | 'NOT_VERIFIED' | 'OWNER', message: string) {
    super(message);
    this.name = 'ListingWatchError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The refs of a request: one to LISTING_WATCH_MAX_REFS well-formed, distinct ones. */
function readRefs(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > LISTING_WATCH_MAX_REFS) {
    throw new ListingWatchError('INVALID_REQUEST', 'The listing refs are not a short list');
  }
  const refs: string[] = [];
  for (const ref of raw) {
    if (typeof ref !== 'string' || !LISTING_WATCH_REF.test(ref) || refs.includes(ref)) {
      throw new ListingWatchError('INVALID_REQUEST', 'A listing ref is not a transaction hash and an output index');
    }
    refs.push(ref);
  }
  return refs;
}

async function register(request: unknown, deps: ListingWatchDeps): Promise<Record<string, unknown>> {
  await deps.booted();
  const wallet = deps.getWallet();
  if (!wallet || wallet.chain !== Blockchain.CARDANO) {
    throw new ListingWatchError('WALLET_UNSUPPORTED', 'Wallet instance not available');
  }
  if (!isRecord(request)) throw new ListingWatchError('INVALID_REQUEST', 'The request is not an object');

  // OX Agent: Authorization prevented by registering only for the logged wallet; a walletId the page names is refused, never used
  if (request['walletId'] !== undefined && request['walletId'] !== wallet.id) {
    throw new ListingWatchError('WALLET_CHANGED', 'The request names another wallet than the one logged in');
  }
  const named = request['ownerPkh'];
  if (named !== undefined && (typeof named !== 'string' || !KEY_HASH_ANY_CASE.test(named))) {
    throw new ListingWatchError('INVALID_REQUEST', 'The owner is not a key hash');
  }
  const refs = readRefs(request['listingRefs']);

  const state = deps.getState() ?? {};
  const listed = Array.isArray(state.listedListings) ? state.listedListings : [];
  const now = Date.now();
  // OX Agent: Authorization prevented by taking the owner only from a listing the worker verified itself (or one of the wallet's own verified listings)
  const owners = new Set<string>();
  for (const ref of refs) {
    const owner = verifiedOwnerOf(wallet.id, ref, listed, now);
    if (!owner) throw new ListingWatchError('NOT_VERIFIED', 'The listing is not one this wallet verified');
    owners.add(owner);
  }
  // One request carries one owner (gero-sync takes one `ownerPkh`), so a mix is not one wallet account's listing.
  if (owners.size !== 1) throw new ListingWatchError('OWNER', 'The listings have different owners');
  const [owner] = owners;
  // OX Agent: Authorization prevented by requiring the owner to be a payment key of the logged account's own key set
  if (!ownListingIdentity(state.keys).paymentKeyHashes.has(owner)) {
    throw new ListingWatchError('OWNER', 'The listing owner is not a key of this wallet');
  }
  if (typeof named === 'string' && named.toLowerCase() !== owner) {
    throw new ListingWatchError('OWNER', 'The owner is not the one the listing was verified with');
  }

  const result = await deps.watch({ walletId: wallet.id, ownerPkh: owner, listingRefs: refs });
  return { success: result.result !== 'failed', result };
}

/**
 * The handler of MessageTypes.NOTIFY_WATCH_LISTINGS (background.ts registers it on the
 * extension-pages channel; senderTrust.ts refuses every other sender). It answers
 * `{ success, result: { result } }` (plus `error` and `errorCode` for a refusal) and calls
 * `sendResponse` exactly once on every path.
 */
export function watchListingsHandler(deps: ListingWatchDeps) {
  return async (request: { id?: unknown; data?: unknown }, sendResponse: (response: unknown) => void): Promise<void> => {
    let data: Record<string, unknown>;
    try {
      data = await register(request.data, deps);
    } catch (error) {
      const known = error instanceof ListingWatchError ? error : null;
      debugLog('NFT market listing watch not registered:', known?.code ?? 'UNEXPECTED');
      // The text is ours and fixed: nothing the server or a library said is echoed back.
      data = {
        success: false,
        error: known ? known.message : 'The listing could not be registered',
        errorCode: known?.code ?? 'FAILED',
        result: { result: 'failed' },
      };
    }
    // Once, and outside the try: a reply that throws must not be answered with a second one.
    try {
      sendResponse({ id: request.id, data, target: TARGET, sender: SENDER.extension });
    } catch (error) {
      debugLog('NFT market listing watch could not reply:', error instanceof Error ? error.name : 'unknown');
    }
  };
}
