// The Gero market transactions the wallet may sign, in two forms. Both are keyed on the
// transaction id (the hash of the body the user reviewed), never on the message: Gero's own flows
// and the dApp approval screens send the same SIGN_TX, so only an identical body can use either.
// Each also names what the transaction touches (the reasons `findMarketTouch` returns:
// `creates-listing:<ix>`, `spends-listing:<ref>`), and a signature is allowed only when
// everything the transaction touches is within it. Both live in the worker's memory only and
// name the wallet they were made for.
//
//  1. The ALLOWANCE: granted by a market prepare handler after the background verified Nexus's
//     transaction against what the user asked for (verifyListing.ts and the other verifiers),
//     consumed by the one signature WalletBg.signTx makes for it. The same design as the CIP-113
//     allowance (cip113Allowance.ts), in a slot of its own: a market transaction never spends a
//     programmable UTxO, and neither grant may satisfy the other. One slot: a new grant replaces
//     it, a worker restart loses it (the user builds again), and it expires after
//     NFT_MARKET_ALLOWANCE_TTL_MS.
//
//  2. The dApp PASS: a dApp's own signing request (CIP-30, CIP-45, WalletConnect) is not
//     something Gero built or verified, but it is previewed at its approval screen (what it
//     creates or spends is shown), and the user's approval there is the consent. The worker saw
//     the request arrive, so it opens a pass for that exact transaction (from the CBOR the dApp
//     sent, never from anything a page says about it) and drops it when the request is answered.
//     The approval page then sends the dApp's CBOR as SIGN_TX and finds its pass. Passes are
//     many, not one slot: the side panel queues several requests. Bounded in number and in time.
//
// Only WalletBg.signTx consumes either; the hardware refusal (hardwareSignRefusal) honours them
// without consuming, because the device may still be declined. A page cannot create a pass: the
// only callers of grantDappMarketPass are the dApp signing entries in background.ts.

/**
 * What every market signing path reports once a transaction touching a Gero listing is refused.
 * Fixed English, thrown from the background (which has no i18n), so a page can map it back to
 * its own copy, as it does for the CIP-113 refusal.
 */
export const NFT_MARKET_SIGN_REFUSAL_MESSAGE = 'Gero cannot sign a market transaction that was not prepared and checked by this wallet';

/** How long a verified market transaction may wait for its signature. */
export const NFT_MARKET_ALLOWANCE_TTL_MS = 5 * 60_000;

interface Allowance {
  walletId: number;
  txId: string;
  /** What the verified transaction touches: the `findMarketTouch` reasons. */
  hits: ReadonlySet<string>;
  expiresAt: number;
}

let allowance: Allowance | null = null;

/** Allow `walletId` to sign `txId` once, touching exactly these market hits. Replaces any earlier grant. */
export function grantMarketSignAllowance(walletId: number, txId: string, hits: Iterable<string>, now = Date.now()): void {
  allowance = { walletId, txId, hits: new Set(hits), expiresAt: now + NFT_MARKET_ALLOWANCE_TTL_MS };
}

/** Whether signing `txId` with these market hits is allowed, without using it up. */
export function hasMarketSignAllowance(walletId: number, txId: string, hits: readonly string[], now = Date.now()): boolean {
  if (!allowance) return false;
  if (now >= allowance.expiresAt) {
    allowance = null;
    return false;
  }
  const granted = allowance.hits;
  return allowance.walletId === walletId
    && allowance.txId === txId
    && hits.length > 0
    && hits.every((hit) => granted.has(hit));
}

/** As hasMarketSignAllowance, and the allowance is gone afterwards whatever the answer. */
export function consumeMarketSignAllowance(walletId: number, txId: string, hits: readonly string[], now = Date.now()): boolean {
  const allowed = hasMarketSignAllowance(walletId, txId, hits, now);
  allowance = null;
  return allowed;
}

export function clearMarketSignAllowance(): void {
  allowance = null;
}

// ---------------------------------------------------------------------------------------------
// The dApp pass
// ---------------------------------------------------------------------------------------------

/** How long a dApp's signing request may stay open with its pass. */
export const DAPP_MARKET_PASS_TTL_MS = 10 * 60_000;

/** The most passes held at once: past it, the oldest is dropped. */
export const DAPP_MARKET_PASS_MAX = 16;

interface Pass {
  hits: ReadonlySet<string>;
  expiresAt: number;
}

// Insertion order is age order (a refreshed pass is re-inserted).
const passes = new Map<string, Pass>();

const passKey = (walletId: number, txId: string) => `${walletId}:${txId}`;

function pruneExpiredPasses(now: number): void {
  for (const [key, pass] of passes) if (now >= pass.expiresAt) passes.delete(key);
}

/**
 * Open a pass for a dApp's signing request: `walletId` may sign `txId` once, touching these
 * market hits, until it is consumed, dropped (the request was answered) or expires. A second
 * request for the same transaction refreshes it.
 */
export function grantDappMarketPass(walletId: number, txId: string, hits: Iterable<string>, now = Date.now()): void {
  pruneExpiredPasses(now);
  const key = passKey(walletId, txId);
  passes.delete(key);
  while (passes.size >= DAPP_MARKET_PASS_MAX) passes.delete(passes.keys().next().value as string);
  passes.set(key, { hits: new Set(hits), expiresAt: now + DAPP_MARKET_PASS_TTL_MS });
}

/** Whether signing `txId` with these market hits has a pass, without using it up. */
export function hasDappMarketPass(walletId: number, txId: string, hits: readonly string[], now = Date.now()): boolean {
  const key = passKey(walletId, txId);
  const pass = passes.get(key);
  if (!pass) return false;
  if (now >= pass.expiresAt) {
    passes.delete(key);
    return false;
  }
  return hits.length > 0 && hits.every((hit) => pass.hits.has(hit));
}

/** As hasDappMarketPass, and this transaction's pass is gone afterwards whatever the answer. */
export function consumeDappMarketPass(walletId: number, txId: string, hits: readonly string[], now = Date.now()): boolean {
  const allowed = hasDappMarketPass(walletId, txId, hits, now);
  passes.delete(passKey(walletId, txId));
  return allowed;
}

/** The request is answered (approved, rejected or timed out): its pass is no longer needed. */
export function dropDappMarketPass(walletId: number, txId: string): void {
  passes.delete(passKey(walletId, txId));
}

export function clearDappMarketPasses(): void {
  passes.clear();
}

// ---------------------------------------------------------------------------------------------
// Either
// ---------------------------------------------------------------------------------------------

/** Whether the allowance or a pass authorizes signing `txId` with these hits, using nothing up. */
export function hasMarketAuthorization(walletId: number, txId: string, hits: readonly string[], now = Date.now()): boolean {
  return hasMarketSignAllowance(walletId, txId, hits, now) || hasDappMarketPass(walletId, txId, hits, now);
}

/**
 * Use up whichever authorizes: the page flow's allowance if it matches, else the dApp pass. A
 * grant that does not match is left alone (a pass is never a reason to empty another flow's slot).
 */
export function consumeMarketAuthorization(walletId: number, txId: string, hits: readonly string[], now = Date.now()): boolean {
  if (hasMarketSignAllowance(walletId, txId, hits, now)) return consumeMarketSignAllowance(walletId, txId, hits, now);
  return consumeDappMarketPass(walletId, txId, hits, now);
}
