// Private (shielded) swap legs on ledger 9: STUB.
//
// The private-legs change replaces this file with the real builders (same
// exports, PRIVATE_SWAP_SUPPORTED true). Until then the swap screens show no
// Public/Private choice and nothing calls the functions below; their types are
// the contract the swap flow will call.
//
// Why a separate path: the wallet's makeIntent and sealed balancer refuse
// shielded legs. A private leg is a Zswap offer that must be proven (about
// 85 s for the maker and 75-90 s for the taker in WASM), and NIGHT is always
// public, so only a shielded token can be the private side.

import type { MidnightNetworkEndpoints } from './midnightConfig';
import type { MidnightUnshieldedUtxo } from './midnightTypes';
import type { WalletProvingRequest } from './midnightProvingTarget';

/** Whether this build can make and take offers with a private (shielded) leg. */
export const PRIVATE_SWAP_SUPPORTED = false;

/** One side of an offer. Strings, so it crosses Chrome messaging. NIGHT (`'00' x 32`) is always `unshielded`. */
export interface PrivateSwapLeg {
  readonly kind: 'shielded' | 'unshielded';
  /** Raw 32-byte token type, lower-case hex. */
  readonly type: string;
  /** Base units, decimal. */
  readonly value: string;
}

export interface PrivateSwapTerms {
  readonly gives: PrivateSwapLeg[];
  readonly wants: PrivateSwapLeg[];
}

/** The wallet's sync the public coins came from, as for buildConnectorIntent9. */
type SyncView = { readonly lastSync: number | null; readonly addresses: { readonly unshielded?: string | null } };

export interface BuildPrivateSwapOffer9Args {
  readonly sdkNetworkId: string;
  readonly endpoints: MidnightNetworkEndpoints;
  readonly terms: PrivateSwapTerms;
  /** Caller wipes after. */
  readonly zswapSecretKeySeed: Uint8Array;
  /** For a public leg the maker gives. Caller wipes after. */
  readonly unshieldedSecretKey: Uint8Array;
  readonly utxos: readonly MidnightUnshieldedUtxo[];
  readonly sync: SyncView;
  readonly proving: WalletProvingRequest;
  readonly ttl?: Date;
}

export interface BuildPrivateSwapOffer9Result {
  /** Sealed (`signature / proof / binding`) transaction, hex: the MIP-0005 payload. */
  readonly offerHex: string;
  readonly terms: PrivateSwapTerms;
  /** Epoch ms: the intent TTL, or an estimate from the Zswap root window for a fully shielded offer. */
  readonly expiresAt: number;
  readonly expiry: 'ttl' | 'root-window';
  /** The maker's private coins the offer spends: spending them elsewhere cancels it. */
  readonly nullifiers: string[];
  readonly proveDurationMs: number;
}

export interface TakePrivateSwapOffer9Args {
  readonly sdkNetworkId: string;
  readonly endpoints: MidnightNetworkEndpoints;
  /** The maker's sealed offer, hex. */
  readonly offerHex: string;
  /** What the user approved (describePrivateSwapOffer9's `taker`). */
  readonly approved: { readonly gives: PrivateSwapLeg[]; readonly receives: PrivateSwapLeg[] };
  /** Caller wipes after. */
  readonly zswapSecretKeySeed: Uint8Array;
  /** Caller wipes after. */
  readonly unshieldedSecretKey: Uint8Array;
  /** The taker pays the DUST fee. Caller wipes after. */
  readonly dustSecretSeed: Uint8Array;
  readonly utxos: readonly MidnightUnshieldedUtxo[];
  readonly sync: SyncView;
  readonly proving: WalletProvingRequest;
  readonly onDustSyncProgress?: (percent: number, detail: string) => void;
}

export interface TakePrivateSwapOffer9Result {
  /** The merged, sealed transaction, hex, ready for submit-proven. */
  readonly txHex: string;
  readonly gives: PrivateSwapLeg[];
  readonly receives: PrivateSwapLeg[];
  readonly dustSpends: number;
  readonly proveDurationMs: number;
}

export type PrivateSwapOfferPreview =
  | {
      ok: true;
      offer: PrivateSwapTerms;
      /** What the taker approves. */
      taker: { gives: PrivateSwapLeg[]; receives: PrivateSwapLeg[] };
      expiresAt?: number;
      expiry: 'ttl' | 'root-window' | 'unknown';
    }
  | { ok: false; code: string; reason: string };

const NOT_SUPPORTED = 'Private swaps are not supported in this version';

/** Pure preview of an offer with a private leg, for the take approval. Not supported yet. */
export function describePrivateSwapOffer9(offerHex: string, sdkNetworkId: string, opts: { now?: number; seenAt?: number } = {}): PrivateSwapOfferPreview {
  void offerHex; void sdkNetworkId; void opts;
  return { ok: false, code: 'unsupported', reason: NOT_SUPPORTED };
}

/** Build a sealed offer with a private leg. Not supported yet: always throws. */
export async function buildPrivateSwapOffer9(args: BuildPrivateSwapOffer9Args): Promise<BuildPrivateSwapOffer9Result> {
  void args;
  throw new Error(NOT_SUPPORTED);
}

/** Complete an offer with a private leg. Not supported yet: always throws. */
export async function takePrivateSwapOffer9(args: TakePrivateSwapOffer9Args): Promise<TakePrivateSwapOffer9Result> {
  void args;
  throw new Error(NOT_SUPPORTED);
}
