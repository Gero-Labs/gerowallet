// Private (shielded) swap legs on ledger 9: STUB.
//
// A parallel change replaces this file with the real builders. Until then the
// swap screens show no Public/Private choice (they read
// PRIVATE_SWAP_SUPPORTED) and nothing calls the functions below. The
// signatures are the contract the swap flow will call once they exist.
//
// Why a separate path: the wallet's makeIntent and sealed balancer refuse
// shielded legs. A private leg is a Zswap offer that must be proven (about
// 40 s per input and 22 s per output in WASM), and NIGHT is always public, so
// only a shielded token can be the private side.

/** Whether this build can make and take offers with a private (shielded) leg. */
export const PRIVATE_SWAP_SUPPORTED = false;

/** One side of a private-capable offer. */
export interface PrivateSwapLeg9 {
  /** Raw 32-byte token type, lower-case hex. */
  readonly tokenType: string;
  /** Base units, decimal string. */
  readonly amount: string;
  /** `true` for a shielded (private) leg; NIGHT is always public. */
  readonly shielded: boolean;
}

export interface BuildPrivateSwapOffer9Args {
  /** The SDK network id (`preprod`, `mainnet`, …). */
  readonly sdkNetworkId: string;
  /** What the maker gives. */
  readonly give: PrivateSwapLeg9;
  /** What the maker asks for in return. */
  readonly want: PrivateSwapLeg9;
  /** The offer's expiry. */
  readonly ttl: Date;
  /** The maker's Zswap secret key seed. Caller wipes after. */
  readonly zswapSecretKeySeed: Uint8Array;
  /** The maker's NightExternal secret key, for a public leg. Caller wipes after. */
  readonly unshieldedSecretKey: Uint8Array;
}

export interface BuildPrivateSwapOffer9Result {
  /** Sealed (`signature / proof / binding`) transaction bytes, hex: the MIP-0005 payload. */
  readonly txHex: string;
}

export interface TakePrivateSwapOffer9Args {
  readonly sdkNetworkId: string;
  /** The maker's sealed offer, hex. */
  readonly offerTxHex: string;
  /** The taker's Zswap secret key seed. Caller wipes after. */
  readonly zswapSecretKeySeed: Uint8Array;
  /** The taker's NightExternal secret key, for a public leg. Caller wipes after. */
  readonly unshieldedSecretKey: Uint8Array;
  /** The taker's DUST secret seed: the taker pays the fee. Caller wipes after. */
  readonly dustSecretSeed: Uint8Array;
}

export interface TakePrivateSwapOffer9Result {
  /** The merged, sealed transaction, hex, ready for submit-proven. */
  readonly txHex: string;
}

const NOT_SUPPORTED = 'Private swaps are not supported in this version';

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
