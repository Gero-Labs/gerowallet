/**
 * Shared types and constants of the Midnight vault key library. Pure data: no Vue, no storage,
 * no network, no WebAssembly, so the iOS host bundle can reuse it as it is.
 */

/** Midnight networks a vault key can belong to. */
export type MidnightNetwork = 'mainnet' | 'preprod' | 'preview';
export const MIDNIGHT_NETWORKS: readonly MidnightNetwork[] = Object.freeze(['mainnet', 'preprod', 'preview']);

/**
 * The key roles of the path's role level.
 * - `approval`: an owner's approval key (Jubjub), signs owner statements;
 * - `upgrade`: an owner's upgrade key (BIP-340), signs contract maintenance updates;
 * - `guardian`: a guardian's key (Jubjub), signs recovery statements;
 * - `delegate`: a delegate's key (Jubjub), signs its own payouts.
 */
export type MidnightKeyRole = 'approval' | 'upgrade' | 'guardian' | 'delegate';
export const MIDNIGHT_KEY_ROLES: readonly MidnightKeyRole[] = Object.freeze(['approval', 'upgrade', 'guardian', 'delegate']);

/** The participant roles a key card speaks for. An owner card carries an approval and an upgrade key. */
export type KeyCardRole = 'owner' | 'guardian' | 'delegate';
export const KEY_CARD_ROLES: readonly KeyCardRole[] = Object.freeze(['owner', 'guardian', 'delegate']);

/** The order of BLS12-381's scalar field: Compact's `Field`, and Jubjub's base field. */
export const FIELD_MODULUS = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;
/** `r_J`, the order of Jubjub's prime-order subgroup: the modulus of `JubjubScalar`. */
export const JUBJUB_SCALAR_MODULUS = 0xe7db4ea6533afa906673b0101343b00a6682093ccc81082d0970e5ed6f72cb7n;

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

/** A Jubjub point in affine coordinates, the runtime's `JubjubPoint` shape. Not checked by itself. */
export interface JubjubPoint {
  readonly x: bigint;
  readonly y: bigint;
}

/**
 * A Jubjub public key that passed point validation: both coordinates below the field modulus,
 * on the curve, in the prime-order subgroup and not the identity. Only `jubjub.ts` makes one.
 */
export type JubjubPublicKey = Brand<JubjubPoint, 'JubjubPublicKey'>;

/** A Jubjub secret scalar, `1 <= sk < r_J`. BigInts cannot be wiped: keep them short-lived. */
export type JubjubSecretKey = Brand<bigint, 'JubjubSecretKey'>;

/** An element of Compact's `Field`, `0 <= x < FIELD_MODULUS`: a statement digest or a commitment. */
export type FieldElement = Brand<bigint, 'FieldElement'>;

/** A Jubjub Schnorr signature, the runtime's `JubjubSchnorrSignature` shape. */
export interface JubjubSignature {
  readonly announcement: JubjubPoint;
  readonly response: bigint;
}

/** A BIP-340 x-only public key that lifts to a secp256k1 point, 64 lowercase hex characters. */
export type UpgradePublicKeyHex = Brand<string, 'UpgradePublicKeyHex'>;

/** A Jubjub key pair. */
export interface JubjubKeyPair {
  readonly secretKey: JubjubSecretKey;
  readonly publicKey: JubjubPublicKey;
}

/** The upgrade key pair: the 32-byte BIP-32 child key is itself the BIP-340 signing key. */
export interface UpgradeKeyPair {
  /** Secret. Wipe it (`fill(0)`) when done. */
  readonly secretKey: Uint8Array;
  readonly publicKey: UpgradePublicKeyHex;
}
