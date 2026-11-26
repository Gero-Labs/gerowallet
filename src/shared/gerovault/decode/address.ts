import { Cardano } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { readBytes, readArray, readUint, toHex, type Bytes } from './cbor';
import { FieldRefusal } from './refusals';

/**
 * Addresses, reward accounts and credentials, read from their bytes (CIP-19) and rendered whole.
 *
 * An output may pay a base or an enterprise address, key or script locked: both are rendered with
 * their full bech32 text and their credentials, so a later rule can compare a change output's
 * payment AND stake credential with the vault's own (a vault script with someone else's stake key
 * is not change).
 *
 * Refused, with the reason:
 * - Byron (bootstrap) addresses (`address_byron_unsupported`). The payment part is a hash of an
 *   address root and attributes, not a key or script hash, and the network lives in those
 *   attributes behind a checksum this decoder does not verify. The rendering model (a payment
 *   credential and a stake credential) cannot describe one, so no credential rule could apply.
 * - Pointer addresses (`address_pointer_unsupported`). The stake part is a chain pointer to a
 *   certificate that the body does not carry, and since Conway it confers no stake rights at all:
 *   what the receiver's stake part means cannot be stated from the bytes.
 * - Reward accounts as outputs, header types 9 to 13 and bad lengths (`address_invalid`).
 */

export type NetworkId = 0 | 1;

export type CredentialKind = 'key' | 'script';

export interface CredentialView {
  kind: CredentialKind;
  /** blake2b-224 key or script hash, 56 lower-case hex characters. */
  hash: string;
}

export type AddressKind = 'base' | 'enterprise';

export interface AddressView {
  /** The complete bech32 address. Never shortened: a screen chunks it, it never elides it. */
  bech32: string;
  /** The address bytes, lower-case hex. */
  hex: string;
  kind: AddressKind;
  networkId: NetworkId;
  payment: CredentialView;
  /** The stake credential of a base address; null for an enterprise address. */
  stake: CredentialView | null;
}

export interface RewardAccountView {
  /** The complete bech32 reward address (stake1… / stake_test1…). */
  bech32: string;
  hex: string;
  networkId: NetworkId;
  credential: CredentialView;
}

const HASH_LENGTH = 28;

function credential(kind: CredentialKind, bytes: Bytes): CredentialView {
  return { kind, hash: toHex(bytes) };
}

function bech32Of(bytes: Bytes, path: string): string {
  try {
    return Cardano.Address.fromBytes(HexBlob.fromBytes(bytes)).toBech32();
  } catch {
    throw new FieldRefusal('address_invalid', path, 'not_encodable');
  }
}

function checkNetwork(header: number, expected: NetworkId, path: string): NetworkId {
  const network = header & 0x0f;
  if (network !== expected) throw new FieldRefusal('network_mismatch', path, `network_${network}`);
  return network;
}

/** An output address (raw address bytes, not CBOR-wrapped): base or enterprise, on `expected`. */
export function decodeAddressBytes(bytes: Bytes, path: string, expected: NetworkId): AddressView {
  if (bytes.length === 0) throw new FieldRefusal('address_invalid', path, 'empty');
  const header = bytes[0];
  const type = header >> 4;
  if (type === 8) throw new FieldRefusal('address_byron_unsupported', path);
  if (type === 4 || type === 5) throw new FieldRefusal('address_pointer_unsupported', path);
  if (type === 14 || type === 15) throw new FieldRefusal('address_invalid', path, 'reward_account');
  if (type > 7) throw new FieldRefusal('address_invalid', path, `header_type_${type}`);
  const isBase = type <= 3;
  const wantLength = 1 + HASH_LENGTH * (isBase ? 2 : 1);
  if (bytes.length !== wantLength) throw new FieldRefusal('address_invalid', path, 'length');
  const networkId = checkNetwork(header, expected, path);
  const paymentIsScript = (type & 0x01) === 0x01;
  const stakeIsScript = (type & 0x02) === 0x02;
  return {
    bech32: bech32Of(bytes, path),
    hex: toHex(bytes),
    kind: isBase ? 'base' : 'enterprise',
    networkId,
    payment: credential(paymentIsScript ? 'script' : 'key', bytes.slice(1, 1 + HASH_LENGTH)),
    stake: isBase ? credential(stakeIsScript ? 'script' : 'key', bytes.slice(1 + HASH_LENGTH)) : null,
  };
}

/** An output's address field: a CBOR byte string holding the address. */
export function decodeAddress(item: Bytes, path: string, expected: NetworkId): AddressView {
  return decodeAddressBytes(readBytes(item, path), path, expected);
}

/** A reward account (CBOR byte string), on `expected`. */
export function decodeRewardAccount(item: Bytes, path: string, expected: NetworkId): RewardAccountView {
  return decodeRewardAccountBytes(readBytes(item, path), path, expected);
}

/** A reward account's raw bytes, as withdrawals key them, on `expected`. */
export function decodeRewardAccountBytes(bytes: Bytes, path: string, expected: NetworkId): RewardAccountView {
  if (bytes.length !== 1 + HASH_LENGTH) throw new FieldRefusal('address_invalid', path, 'length');
  const header = bytes[0];
  const type = header >> 4;
  if (type !== 14 && type !== 15) throw new FieldRefusal('address_invalid', path, 'not_reward_account');
  const networkId = checkNetwork(header, expected, path);
  return {
    bech32: bech32Of(bytes, path),
    hex: toHex(bytes),
    networkId,
    credential: credential(type === 15 ? 'script' : 'key', bytes.slice(1)),
  };
}

/** A ledger credential `[0, addr_keyhash] / [1, script_hash]`. */
export function decodeCredential(item: Bytes, path: string): CredentialView {
  const parts = readArray(item, path);
  if (parts.length !== 2) throw new FieldRefusal('field_malformed', path, 'credential_length');
  const tag = readUint(parts[0], path);
  if (tag !== 0n && tag !== 1n) throw new FieldRefusal('variant_unknown', path, `credential_${tag}`);
  return credential(tag === 0n ? 'key' : 'script', readBytes(parts[1], path, HASH_LENGTH));
}

/** A 28-byte hash (key hash, pool key hash), lower-case hex. */
export function decodeHash28(item: Bytes, path: string): string {
  return toHex(readBytes(item, path, HASH_LENGTH));
}

export function sameCredential(a: CredentialView, b: CredentialView): boolean {
  return a.kind === b.kind && a.hash === b.hash;
}
