// The one Gero market transaction the wallet may sign: granted by a market prepare handler after
// the background verified Nexus's transaction against what the user asked for (verifyListing.ts
// and the other verifiers), consumed by the one signature WalletBg.signTx makes for it. The same
// design as the CIP-113 allowance (cip113Allowance.ts), in a slot of its own: a market
// transaction never spends a programmable UTxO, and neither grant may satisfy the other.
//
// Keyed on the transaction id (the hash of the body the user reviewed), never on the message:
// Gero's own flows and the dApp approval screens send the same SIGN_TX, so only an identical body
// can use it. The grant also names what the verification found the transaction to touch (the
// reasons `findMarketTouch` returns: `creates-listing:<ix>`, `spends-listing:<ref>`), and a
// signature is allowed only when everything the transaction touches is within it. One slot, held
// in the worker's memory: a new grant replaces it, a worker restart loses it (the user builds
// again), and it expires after NFT_MARKET_ALLOWANCE_TTL_MS. A wallet switch cannot use it either:
// it names the wallet it was granted for.
//
// Only WalletBg.signTx consumes it; the hardware refusal (hardwareSignRefusal) honours it without
// consuming it, because the device may still be declined. No dApp-facing refusal reads it.

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
