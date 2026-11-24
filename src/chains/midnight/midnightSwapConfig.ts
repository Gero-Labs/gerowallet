// Direct peer-to-peer token swaps on Midnight: the maker seals an offer
// (makeIntent with payFees false), shares it as a MIP-0005 `swapoffer1…`
// string, and a taker completes it (balanceSealedTransaction) and pays the
// DUST fee. Public (unshielded) legs through the connector builders; private
// (shielded) legs through midnightPrivateSwap9.ts (MIDNIGHT_SWAP_PRIVATE_LEGS).
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
 * Whether offers may have private (shielded) legs: the screens offer the
 * Public/Private choice and the MIDNIGHT_SWAP_* handlers make and take such
 * offers through midnightPrivateSwap9.ts. Off, an offer with a private leg is
 * refused as unsupported. Same networks as the swap itself.
 */
export const MIDNIGHT_SWAP_PRIVATE_LEGS = true;

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

/**
 * A fully private offer's estimated life, in minutes, as the maker's screen
 * states it before building: the root window less its margin
 * (midnightPrivateSwap9.ts PRIVATE_SWAP_ROOT_WINDOW_MS - PRIVATE_SWAP_EXPIRY_MARGIN_MS).
 */
export const MIDNIGHT_SWAP_PRIVATE_ESTIMATE_MINUTES = 55;

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
  /** An offer that gives private tokens is withdrawn by spending them, not from the swap screens. */
  SWAP_PRIVATE_NO_WITHDRAW: 'midnight.swap.error.privateNoWithdraw',
  /** The chosen prover cannot prove private legs (see canProvePrivateSwap): asked before anything is unlocked. */
  SWAP_PRIVATE_PROVER: 'midnight.swap.error.privateProver',
} as const;

/**
 * Whether `prover` (walletProverFor with kind `shielded`) can prove a swap's
 * private legs: a proof server, local or Arkhia, always; this computer or Gero
 * Prover only when the build has the hosted Zswap key set. Gero Cloud proves
 * only whole wallet-built sends, so never a swap.
 */
export function canProvePrivateSwap(prover: string, shieldedKeysHosted: boolean): boolean {
  if (prover === 'local' || prover === 'zkpaas') return true;
  return (prover === 'device' || prover === 'helper') && shieldedKeysHosted;
}

/**
 * The refusals of midnightPrivateSwap9.ts (`PrivateSwapRefusedError.code`,
 * the keys of its PRIVATE_SWAP_REFUSALS), as the worker answers them:
 * `SWAP_PRIVATE_<code>`. Kept here so the pages translate them without
 * loading the ledger; midnightSwapConfig.spec.ts holds the two lists equal.
 */
const PRIVATE_REFUSAL_KEYS = {
  request: 'midnight.swap.error.private.request',
  noPrivateLeg: 'midnight.swap.error.private.noPrivateLeg',
  shieldedNight: 'midnight.swap.error.private.shieldedNight',
  tooManyLegs: 'midnight.swap.error.private.tooManyLegs',
  sameToken: 'midnight.swap.error.private.sameToken',
  decode: 'midnight.swap.error.invalid',
  size: 'midnight.swap.error.private.size',
  giveOnly: 'midnight.swap.error.giveOnly',
  wantOnly: 'midnight.swap.error.private.wantOnly',
  fallible: 'midnight.swap.error.unsupported',
  contract: 'midnight.swap.error.private.contract',
  dust: 'midnight.swap.error.private.dust',
  transient: 'midnight.swap.error.unsupported',
  unknownKind: 'midnight.swap.error.unsupported',
  expiry: 'midnight.swap.error.private.expiry',
  terms: 'midnight.swap.error.changed',
  own: 'midnight.swap.error.own',
} as const;

export type MidnightPrivateSwapRefusal = keyof typeof PRIVATE_REFUSAL_KEYS;
export const MIDNIGHT_PRIVATE_SWAP_REFUSALS = Object.keys(PRIVATE_REFUSAL_KEYS) as MidnightPrivateSwapRefusal[];

export type MidnightSwapCode = keyof typeof CODES | `SWAP_PRIVATE_${MidnightPrivateSwapRefusal}`;

/** The swap code the worker answers for a private-swap refusal. */
export function privateSwapRefusalCode(refusal: MidnightPrivateSwapRefusal): MidnightSwapCode {
  return `SWAP_PRIVATE_${refusal}`;
}

function privateRefusalOf(value: string): MidnightPrivateSwapRefusal | undefined {
  if (!value.startsWith('SWAP_PRIVATE_')) return undefined;
  const refusal = value.slice('SWAP_PRIVATE_'.length);
  return Object.prototype.hasOwnProperty.call(PRIVATE_REFUSAL_KEYS, refusal) ? refusal as MidnightPrivateSwapRefusal : undefined;
}

export function isMidnightSwapCode(value: unknown): value is MidnightSwapCode {
  return typeof value === 'string' && (Object.prototype.hasOwnProperty.call(CODES, value) || !!privateRefusalOf(value));
}

/** The `us.ts` key that says `code` to the user; `undefined` for anything else (the caller shows its general error). */
export function midnightSwapCopyKey(code: unknown): string | undefined {
  if (typeof code !== 'string') return undefined;
  if (Object.prototype.hasOwnProperty.call(CODES, code)) return CODES[code as keyof typeof CODES];
  const refusal = privateRefusalOf(code);
  return refusal ? PRIVATE_REFUSAL_KEYS[refusal] : undefined;
}

/**
 * How long proving takes on this device, for the progress steps: about ten
 * seconds for a public swap's one DUST proof, about a minute for private legs
 * (Zswap spends and outputs; 75-110 s measured on preprod in WASM).
 */
export const MIDNIGHT_SWAP_PROVE_COPY = {
  public: 'midnight.swap.step.aboutSeconds',
  private: 'midnight.swap.step.aboutMinute',
} as const;

/** A refusal the worker answers with its code as `error`; the pages map it with {@link midnightSwapCopyKey}. */
export class MidnightSwapError extends Error {
  readonly code: MidnightSwapCode;

  constructor(code: MidnightSwapCode) {
    super(code);
    this.name = 'MidnightSwapError';
    this.code = code;
  }
}
