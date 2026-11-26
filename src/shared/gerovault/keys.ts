/**
 * CIP-1854 role keys. The wallet holds its account-level key `m/1854'/1815'/0'` and derives the
 * two role-level keys from it (`0'/0` payment, `0'/2` stake). Cosigners exchange the role-level
 * keys only (spec 4.0, GV-15): sharing the account key would also hand out every future role a
 * CIP adds under it. The derivation is the soft BIP32-Ed25519 derivation of `@cardano-sdk/crypto`,
 * the same one `serialization.ts` uses for CIP-1852 keys; this file adds no cryptography.
 */
import { Bip32PublicKey, Bip32PublicKeyHex, Ed25519KeyHashHex, ready } from '@cardano-sdk/crypto';
import { bech32 } from 'bech32';
import { GeroVaultError } from './errors';
import { assertRole, assertVaultIndex } from './paths';
import {
  EncodedSharedRoleKeys,
  MultisigAccountPublicKey,
  ParticipantKeyHashes,
  ROLE,
  Role,
  RolePublicKey,
  SharedRoleKeys,
  VaultKey,
} from './types';

/** CIP-5 prefixes of CIP-1854 keys. */
export const BECH32_PREFIX = {
  ACCOUNT_XVK: 'acct_shared_xvk',
  PAYMENT_XVK: 'addr_shared_xvk',
  STAKE_XVK: 'stake_shared_xvk',
  PAYMENT_VKH: 'addr_shared_vkh',
  STAKE_VKH: 'stake_shared_vkh',
} as const;

/** CIP-5 prefixes of CIP-1852 account keys, refused here because they are not multisig keys. */
const CIP1852_ACCOUNT_PREFIXES = new Set(['acct_xvk', 'xpub']);

const BECH32_LIMIT = 1023;
const XPUB_BYTES = 64;
const HEX_XPUB = /^[0-9a-f]{128}$/;

function toBech32(prefix: string, bytes: Uint8Array): string {
  return bech32.encode(prefix, bech32.toWords(bytes), BECH32_LIMIT);
}

function fromBech32(value: string): { prefix: string; bytes: Uint8Array } | undefined {
  try {
    const decoded = bech32.decode(value, BECH32_LIMIT);
    return { prefix: decoded.prefix, bytes: Uint8Array.from(bech32.fromWords(decoded.words)) };
  } catch {
    return undefined;
  }
}

function hexOf(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function bytesOf(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function makeRoleKey<R extends Role>(role: R, hex: Bip32PublicKeyHex): RolePublicKey<R> {
  return Object.freeze({ level: 'role', role, hex }) as RolePublicKey<R>;
}

/**
 * Wraps the wallet's own account-level key at `m/1854'/1815'/0'`, given as 128 hex characters
 * (public key and chain code) or as `acct_shared_xvk1...`. A CIP-1852 account key (`acct_xvk`)
 * is refused; a bare hex value cannot be told apart, so the caller must derive it at 1854'.
 */
export function multisigAccountPublicKey(value: string): MultisigAccountPublicKey {
  let hex: string | undefined;
  if (typeof value === 'string' && HEX_XPUB.test(value.toLowerCase())) {
    hex = value.toLowerCase();
  } else if (typeof value === 'string') {
    const decoded = fromBech32(value);
    if (decoded && CIP1852_ACCOUNT_PREFIXES.has(decoded.prefix)) {
      throw new GeroVaultError('INVALID_ACCOUNT_KEY', 'A CIP-1852 account key is not a CIP-1854 multisig account key');
    }
    if (decoded?.prefix === BECH32_PREFIX.ACCOUNT_XVK && decoded.bytes.length === XPUB_BYTES) hex = hexOf(decoded.bytes);
  }
  if (!hex) throw new GeroVaultError('INVALID_ACCOUNT_KEY', 'A multisig account key is a 64-byte extended public key');
  return Object.freeze({ level: 'account', hex: Bip32PublicKeyHex(hex) }) as MultisigAccountPublicKey;
}

/** Derives the two role-level keys a cosigner shares (`m/1854'/1815'/0'/0` and `.../2`). */
export async function deriveSharedRoleKeys(account: MultisigAccountPublicKey): Promise<SharedRoleKeys> {
  if (account?.level !== 'account') {
    throw new GeroVaultError('INVALID_ACCOUNT_KEY', 'Role keys are derived from the multisig account key');
  }
  await ready();
  const parent = Bip32PublicKey.fromHex(account.hex);
  return Object.freeze({
    payment: makeRoleKey(ROLE.PAYMENT, parent.derive([ROLE.PAYMENT]).hex()),
    stake: makeRoleKey(ROLE.STAKE, parent.derive([ROLE.STAKE]).hex()),
  });
}

/** The bech32 form to give to cosigners: `addr_shared_xvk1...` and `stake_shared_xvk1...`. */
export function encodeSharedRoleKeys(keys: SharedRoleKeys): EncodedSharedRoleKeys {
  if (keys?.payment?.level !== 'role' || keys.payment.role !== ROLE.PAYMENT
    || keys.stake?.level !== 'role' || keys.stake.role !== ROLE.STAKE) {
    throw new GeroVaultError('INVALID_ROLE_KEY', 'Only role-level keys are shared');
  }
  return Object.freeze({
    payment: toBech32(BECH32_PREFIX.PAYMENT_XVK, bytesOf(keys.payment.hex)),
    stake: toBech32(BECH32_PREFIX.STAKE_XVK, bytesOf(keys.stake.hex)),
  });
}

function parseRoleKey<R extends Role>(role: R, value: unknown): RolePublicKey<R> {
  const decoded = typeof value === 'string' ? fromBech32(value) : undefined;
  if (decoded?.prefix === BECH32_PREFIX.ACCOUNT_XVK || (decoded && CIP1852_ACCOUNT_PREFIXES.has(decoded.prefix))) {
    throw new GeroVaultError('ACCOUNT_KEY_NOT_SHAREABLE', 'An account key was shared where a role key belongs');
  }
  const prefix = role === ROLE.PAYMENT ? BECH32_PREFIX.PAYMENT_XVK : BECH32_PREFIX.STAKE_XVK;
  if (!decoded || decoded.prefix !== prefix || decoded.bytes.length !== XPUB_BYTES) {
    throw new GeroVaultError('INVALID_ROLE_KEY', `A ${role === ROLE.PAYMENT ? 'payment' : 'stake'} role key reads ${prefix}1...`);
  }
  return makeRoleKey(role, Bip32PublicKeyHex(hexOf(decoded.bytes)));
}

/** Reads a cosigner's shared keys. An account key in either slot is refused. */
export function parseSharedRoleKeys(encoded: EncodedSharedRoleKeys): SharedRoleKeys {
  const payment = parseRoleKey(ROLE.PAYMENT, encoded?.payment);
  const stake = parseRoleKey(ROLE.STAKE, encoded?.stake);
  if (payment.hex === stake.hex) {
    throw new GeroVaultError('INVALID_ROLE_KEY', 'The payment and stake role keys are the same key');
  }
  return Object.freeze({ payment, stake });
}

/** The key at `m/1854'/1815'/0'/role/index`, from that role's key. */
export async function deriveVaultKey(roleKey: RolePublicKey, index: number): Promise<VaultKey> {
  if (roleKey?.level !== 'role') throw new GeroVaultError('INVALID_ROLE_KEY', 'Vault keys are derived from a role key');
  assertRole(roleKey.role);
  assertVaultIndex(index);
  await ready();
  const raw = Bip32PublicKey.fromHex(roleKey.hex).derive([index]).toRawKey();
  return Object.freeze({ role: roleKey.role, index, publicKey: raw.hex(), keyHash: raw.hash().hex() });
}

/** The payment and stake key hashes one participant contributes to the vault at `index`. */
export async function deriveParticipantKeyHashes(keys: SharedRoleKeys, index: number): Promise<ParticipantKeyHashes> {
  const [payment, stake] = await Promise.all([deriveVaultKey(keys.payment, index), deriveVaultKey(keys.stake, index)]);
  if (payment.role !== ROLE.PAYMENT || stake.role !== ROLE.STAKE) {
    throw new GeroVaultError('INVALID_ROLE_KEY', 'The shared keys are in the wrong slots');
  }
  return Object.freeze({ payment: payment.keyHash, stake: stake.keyHash });
}

/** Display form of a vault key hash: `addr_shared_vkh1...` or `stake_shared_vkh1...`. */
export function encodeVaultKeyHash(role: Role, keyHash: Ed25519KeyHashHex): string {
  assertRole(role);
  const hex = Ed25519KeyHashHex(keyHash);
  return toBech32(role === ROLE.PAYMENT ? BECH32_PREFIX.PAYMENT_VKH : BECH32_PREFIX.STAKE_VKH, bytesOf(hex));
}
