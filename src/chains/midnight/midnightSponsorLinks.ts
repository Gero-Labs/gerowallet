/**
 * Persisted "wallet A's fees are paid by wallet B" links, and the record of
 * which wallet actually paid for a given transaction.
 *
 * WHY PERSIST ANYTHING. Sponsorship is otherwise invisible: the sponsored
 * wallet shows an empty DUST battery and the paying wallet shows an unexplained
 * drain, on two screens that never mention each other. Storing the link lets
 * both sides say what is going on, and lets the send dialog pre-select the
 * choice the user already made instead of asking every time.
 *
 * Stored under their OWN storage keys, deliberately separate from
 * `midnightStore` — that store's `setActive` resets per-wallet chain state on
 * every wallet switch, which would wipe a link the moment the user looked at
 * the other side of it.
 *
 * A link is a PREFERENCE, never an authority. It records intent; it does not
 * mean the sponsor can still pay. Eligibility is re-resolved at send time by
 * `midnightSponsorEligibility` against live registration data, so a link to a
 * wallet that has since drained degrades to "not ready" in the picker rather
 * than producing a failing send.
 */

/** Storage key for the wallet→sponsor preferences. */
export const SPONSOR_LINK_KEY = 'midnightSponsorLinks';
/** Storage key for per-transaction attribution. */
export const SPONSORED_TX_KEY = 'midnightSponsoredTxs';

export interface SponsorLink {
  /** The wallet whose fees are being paid. */
  readonly walletId: number;
  /** The wallet paying them. */
  readonly sponsorWalletId: number;
  /** Name captured at link time, so the UI can render before wallets load. */
  readonly sponsorName: string;
  /** Network the link applies to — DUST is per-network. */
  readonly network: string;
  /** Epoch ms the link was made. */
  readonly at: number;
}

export type SponsorLinkMap = Record<string, SponsorLink>;

/**
 * Attribution for one transaction: which wallet paid its DUST fee.
 *
 * Kept even after a link is removed — transaction history is a record of what
 * happened, and must not change because a preference changed later.
 */
export interface SponsoredTx {
  readonly txHash: string;
  readonly sponsorWalletId: number;
  readonly sponsorName: string;
  readonly at: number;
  /**
   * The wallet that SENT — the one whose fee was covered. Needed so the
   * sponsor's own transaction details can say who it paid for, and so the
   * sponsored wallet can say the fee was "not charged to" it.
   */
  readonly sponsoredWalletId?: number;
  readonly sponsoredWalletName?: string;
  /** Human-readable amount of the send this fee paid for, e.g. "250.00 USDM". */
  readonly amountLabel?: string;
  /** Recipient of that send, for the sponsor-side summary. */
  readonly recipient?: string;
}

export type SponsoredTxMap = Record<string, SponsoredTx>;

// ─── links ─────────────────────────────────────────────────────────────────

/** Set (or replace) the sponsor for one wallet. */
export function withLink(map: SponsorLinkMap, link: SponsorLink): SponsorLinkMap {
  return { ...map, [String(link.walletId)]: link };
}

/** Remove a wallet's sponsor — "turn sponsorship off". */
export function withoutLink(map: SponsorLinkMap, walletId: number): SponsorLinkMap {
  const next = { ...map };
  delete next[String(walletId)];
  return next;
}

/**
 * Remove every link that mentions a wallet, in either role. Call when a wallet
 * is deleted, so a dangling link can't name a wallet that no longer exists.
 */
export function withoutWallet(map: SponsorLinkMap, walletId: number): SponsorLinkMap {
  const next: SponsorLinkMap = {};
  for (const [key, link] of Object.entries(map)) {
    if (link.walletId === walletId || link.sponsorWalletId === walletId) continue;
    next[key] = link;
  }
  return next;
}

/**
 * The sponsor configured for a wallet on a network, or null.
 * A link from another network never applies — a mainnet sponsor cannot pay a
 * preprod fee.
 */
export function linkFor(
  map: SponsorLinkMap,
  walletId: number,
  network: string,
): SponsorLink | null {
  const link = map[String(walletId)];
  if (!link) return null;
  if (link.network !== network) return null;
  return link;
}

/**
 * The wallets THIS wallet is paying for — the reciprocal view, for the badge on
 * the sponsor's own dashboard. Sorted by wallet id so rendering is stable.
 */
export function sponsoredByWallet(
  map: SponsorLinkMap,
  sponsorWalletId: number,
  network: string,
): SponsorLink[] {
  return Object.values(map)
    .filter((l) => l.sponsorWalletId === sponsorWalletId && l.network === network)
    .sort((a, b) => a.walletId - b.walletId);
}

// ─── transaction attribution ───────────────────────────────────────────────

export function withSponsoredTx(map: SponsoredTxMap, record: SponsoredTx): SponsoredTxMap {
  return { ...map, [record.txHash.toLowerCase()]: record };
}

/** Attribution for a transaction, or null when this wallet paid its own fee. */
export function sponsoredTxFor(map: SponsoredTxMap, txHash: string): SponsoredTx | null {
  if (!txHash) return null;
  return map[txHash.toLowerCase()] ?? null;
}

// ─── storage ───────────────────────────────────────────────────────────────

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local;
}

async function readMap<T>(key: string): Promise<Record<string, T>> {
  if (!hasChromeStorage()) return {};
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(key, (out) => {
        const value = out?.[key];
        resolve(value && typeof value === 'object' ? (value as Record<string, T>) : {});
      });
    } catch {
      resolve({});
    }
  });
}

async function writeMap(key: string, map: unknown): Promise<void> {
  if (!hasChromeStorage()) return;
  return new Promise((resolve) => {
    try {
      chrome.storage.local.set({ [key]: map }, () => resolve());
    } catch {
      resolve();
    }
  });
}

export function loadSponsorLinks(): Promise<SponsorLinkMap> {
  return readMap<SponsorLink>(SPONSOR_LINK_KEY);
}

export function loadSponsoredTxs(): Promise<SponsoredTxMap> {
  return readMap<SponsoredTx>(SPONSORED_TX_KEY);
}

/** Persist a wallet's sponsor choice. */
export async function saveSponsorLink(link: SponsorLink): Promise<void> {
  await writeMap(SPONSOR_LINK_KEY, withLink(await loadSponsorLinks(), link));
}

/** Turn sponsorship off for a wallet. */
export async function clearSponsorLink(walletId: number): Promise<void> {
  await writeMap(SPONSOR_LINK_KEY, withoutLink(await loadSponsorLinks(), walletId));
}

/** Record which wallet paid for a transaction, for the details screen. */
export async function recordSponsoredTx(record: SponsoredTx): Promise<void> {
  await writeMap(SPONSORED_TX_KEY, withSponsoredTx(await loadSponsoredTxs(), record));
}
