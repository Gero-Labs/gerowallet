// Direct peer-to-peer token swaps on Midnight: the maker seals an offer
// (makeIntent with payFees false), shares it as a MIP-0005 `swapoffer1…`
// string, and a taker completes it (balanceSealedTransaction) and pays the
// DUST fee. Public (unshielded) legs; private legs come from
// midnightPrivateSwap9.ts once it is supported.
//
// Pure: the build-time network gate, the offer lifetimes and the code → copy
// table. Used by the worker and the pages.

import { Network } from '@/models/types';

/**
 * Networks where this build offers the swap. A build-time gate: outside it the
 * routes redirect, the nav items and buttons are absent and the worker's
 * `MIDNIGHT_SWAP_*` handlers refuse. Mainnet joins after the preprod tests.
 */
export const MIDNIGHT_SWAP_NETWORKS: readonly string[] = [Network.PREPROD];

export function isMidnightSwapNetwork(network: string | null | undefined): boolean {
  return typeof network === 'string' && MIDNIGHT_SWAP_NETWORKS.includes(network);
}

/**
 * How long an offer can be taken, in minutes. 55 is the ceiling: the ledger
 * refuses an intent whose TTL is more than an hour past its block, and the
 * taker's wallet refuses one more than 56 minutes ahead
 * (midnightSealedBalancer9.ts).
 */
export const MIDNIGHT_SWAP_TTL_MINUTES = [10, 30, 55] as const;
export type MidnightSwapTtlMinutes = typeof MIDNIGHT_SWAP_TTL_MINUTES[number];
export const MIDNIGHT_SWAP_DEFAULT_TTL: MidnightSwapTtlMinutes = 30;

export function isMidnightSwapTtl(value: unknown): value is MidnightSwapTtlMinutes {
  return typeof value === 'number' && (MIDNIGHT_SWAP_TTL_MINUTES as readonly number[]).includes(value);
}

/** An offer closer to its expiry than this cannot be taken (the taker's proof would likely be wasted). */
export const MIDNIGHT_SWAP_MIN_TAKE_MS = 2 * 60_000;

/**
 * Longest offer string the wallet reads: a ledger transaction is at most 1 MiB,
 * and bech32m spends 1.6 characters per byte. Public offers are a few KB.
 */
export const MIDNIGHT_SWAP_MAX_OFFER_CHARS = 1_700_000;

/**
 * Longest offer string drawn as ONE QR code (alphanumeric mode, low error
 * correction). Beyond it the Share screen cycles an animated QR, the format
 * the wallet already uses for Keystone.
 */
export const MIDNIGHT_SWAP_SINGLE_QR_MAX_CHARS = 2_400;

/**
 * Every code a swap call can end with. The `OFFER_*` group and
 * `SWAP_NOT_ENABLED` are Nexus's; the rest are the wallet's own. Nexus text is
 * never shown: a code maps to copy, an unknown one to the general error.
 */
const CODES = {
  // Nexus (POST swap-offers).
  OFFER_INVALID: 'midnight.swap.error.invalid',
  OFFER_GIVE_ONLY: 'midnight.swap.error.giveOnly',
  OFFER_EXPIRED: 'midnight.swap.error.expired',
  OFFER_WRONG_NETWORK: 'midnight.swap.error.wrongNetwork',
  OFFER_TOO_LARGE: 'midnight.swap.error.tooLarge',
  SWAP_NOT_ENABLED: 'midnight.swap.error.notEnabled',
  // The wallet's own.
  /** Not a `swapoffer1…` string, a bad checksum, or bytes that are not a sealed ledger 9 transaction. */
  SWAP_OFFER_UNREADABLE: 'midnight.swap.error.invalid',
  /** The offer is for another Midnight network. */
  SWAP_OFFER_WRONG_NETWORK: 'midnight.swap.error.wrongNetwork',
  /** Has expired, or is about to (under two minutes left). */
  SWAP_OFFER_EXPIRED: 'midnight.swap.error.expired',
  /** Its expiry is further ahead than any offer the wallet takes. */
  SWAP_OFFER_TOO_LONG: 'midnight.swap.error.tooLong',
  /** Asks for or gives a private token, or leaves a fallible part open: not takeable here. */
  SWAP_OFFER_UNSUPPORTED: 'midnight.swap.error.unsupported',
  /** Asks for nothing in return. */
  SWAP_OFFER_GIVE_ONLY: 'midnight.swap.error.giveOnly',
  /** This wallet made it. */
  SWAP_OFFER_OWN: 'midnight.swap.error.own',
  /** The terms the page showed are not the offer's (it changed between review and take). */
  SWAP_OFFER_CHANGED: 'midnight.swap.error.changed',
  /** The offered coins were spent (taken by someone else, or withdrawn). */
  SWAP_OFFER_GONE: 'midnight.swap.error.gone',
  /** The wallet cannot cover what the offer asks for. */
  SWAP_INSUFFICIENT_FUNDS: 'midnight.swap.error.insufficient',
  /** No such offer of this wallet's to withdraw or show. */
  SWAP_OFFER_UNKNOWN: 'midnight.swap.error.unknown',
  /** The offer is no longer open, so there is nothing to withdraw. */
  SWAP_OFFER_NOT_OPEN: 'midnight.swap.error.notOpen',
  /** The swap is not offered on this network (MIDNIGHT_SWAP_NETWORKS) or the chain is not on ledger 9. */
  SWAP_UNAVAILABLE: 'midnight.swap.error.notEnabled',
} as const;

export type MidnightSwapCode = keyof typeof CODES;

export function isMidnightSwapCode(value: unknown): value is MidnightSwapCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CODES, value);
}

/** The `us.ts` key that says `code` to the user; `undefined` for anything else (the caller shows its general error). */
export function midnightSwapCopyKey(code: unknown): string | undefined {
  return isMidnightSwapCode(code) ? CODES[code] : undefined;
}

/** A refusal the worker answers with its code as `error`; the pages map it with {@link midnightSwapCopyKey}. */
export class MidnightSwapError extends Error {
  readonly code: MidnightSwapCode;

  constructor(code: MidnightSwapCode) {
    super(code);
    this.name = 'MidnightSwapError';
    this.code = code;
  }
}
