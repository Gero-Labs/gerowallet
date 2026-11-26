/**
 * CIP-1854 keys of a vault participant.
 *
 * Each participant contributes to a vault the payment key at `m/1854'/1815'/0'/0/i` and the
 * stake key at `.../2/i`, at their own index `i` (`indexAllocation.ts`). Between Gero wallets the
 * only thing exchanged is that vault's two public keys, raw Ed25519 without chain code and
 * without the index (`VaultPublicKeys`): a role or account xpub would let every past cosigner
 * derive all of the participant's future vault keys, find every later vault and register scripts
 * under them first.
 *
 * Extended keys are used only locally: the wallet derives its own vault keys from its own account
 * key, and derives an external wallet's vault keys from the role or account xpub that wallet gave
 * (CIP-1854 lets cosigners share either). Nothing here encodes an extended key for sharing.
 *
 * The derivation is the soft BIP32-Ed25519 derivation of `@cardano-sdk/crypto`, the same one
 * `serialization.ts` uses for CIP-1852 keys; this file adds no cryptography.
 */
import { Bip32PublicKey, Bip32PublicKeyHex, Ed25519KeyHashHex, Ed25519PublicKey, Ed25519PublicKeyHex, ready } from '@cardano-sdk/crypto';
import { bech32 } from 'bech32';
import { GeroVaultError } from './errors';
import { assertRole, assertVaultIndex } from './paths';
import {
  EncodedVaultPublicKeys,
  MultisigAccountPublicKey,
  ParticipantKeyHashes,
  ROLE,
  Role,
  RoleKeys,
  RolePublicKey,
  VaultKey,
  VaultPublicKeys,
} from './types';

/** CIP-5 prefixes of CIP-1854 keys. */
export const BECH32_PREFIX = {
  ACCOUNT_XVK: 'acct_shared_xvk',
  PAYMENT_XVK: 'addr_shared_xvk',
  STAKE_XVK: 'stake_shared_xvk',
  PAYMENT_VK: 'addr_shared_vk',
  STAKE_VK: 'stake_shared_vk',
  PAYMENT_VKH: 'addr_shared_vkh',
  STAKE_VKH: 'stake_shared_vkh',
} as const;

/** CIP-5 prefixes of CIP-1852 account keys, refused here because they are not multisig keys. */
const CIP1852_ACCOUNT_PREFIXES = new Set(['acct_xvk', 'xpub']);
const EXTENDED_PREFIXES = new Set<string>([BECH32_PREFIX.ACCOUNT_XVK, BECH32_PREFIX.PAYMENT_XVK, BECH32_PREFIX.STAKE_XVK]);

const BECH32_LIMIT = 1023;
const XPUB_BYTES = 64;
const VK_BYTES = 32;
const HEX_XPUB = /^[0-9a-f]{128}$/;

function toBech32(prefix: string, bytes: Uint8Array): string {
  return bech32.encode(prefix, bech32.toWords(bytes), BECH32_LIMIT);
}

function fromBech32(value: unknown): { prefix: string; bytes: Uint8Array } | undefined {
  if (typeof value !== 'string') return undefined;
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

function makeVaultKeys(payment: Ed25519PublicKeyHex, stake: Ed25519PublicKeyHex): VaultPublicKeys {
  if (payment === stake) throw new GeroVaultError('INVALID_VAULT_KEYS', 'The payment and stake keys are the same key');
  return Object.freeze({ level: 'vault', payment, stake }) as VaultPublicKeys;
}

/**
 * Wraps a CIP-1854 account-level key at `m/1854'/1815'/0'`, given as 128 hex characters (public
 * key and chain code) or as `acct_shared_xvk1...`: the wallet's own, or an external wallet's
 * input. A CIP-1852 account key (`acct_xvk`) is refused; a bare hex value cannot be told apart,
 * so the caller must derive it at 1854'.
 */
export function multisigAccountPublicKey(value: string): MultisigAccountPublicKey {
  let hex: string | undefined;
  if (typeof value === 'string' && HEX_XPUB.test(value.toLowerCase())) {
    hex = value.toLowerCase();
  } else {
    const decoded = fromBech32(value);
    if (decoded && CIP1852_ACCOUNT_PREFIXES.has(decoded.prefix)) {
      throw new GeroVaultError('INVALID_ACCOUNT_KEY', 'A CIP-1852 account key is not a CIP-1854 multisig account key');
    }
    if (decoded?.prefix === BECH32_PREFIX.ACCOUNT_XVK && decoded.bytes.length === XPUB_BYTES) hex = hexOf(decoded.bytes);
  }
  if (!hex) throw new GeroVaultError('INVALID_ACCOUNT_KEY', 'A multisig account key is a 64-byte extended public key');
  return Object.freeze({ level: 'account', hex: Bip32PublicKeyHex(hex) }) as MultisigAccountPublicKey;
}

/** Derives the two role-level keys (`m/1854'/1815'/0'/0` and `.../2`) of an account key. */
export async function deriveRoleKeys(account: MultisigAccountPublicKey): Promise<RoleKeys> {
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

function parseExternalRoleKey<R extends Role>(role: R, value: unknown): RolePublicKey<R> {
  const prefix = role === ROLE.PAYMENT ? BECH32_PREFIX.PAYMENT_XVK : BECH32_PREFIX.STAKE_XVK;
  const decoded = fromBech32(value);
  if (!decoded || decoded.prefix !== prefix || decoded.bytes.length !== XPUB_BYTES) {
    throw new GeroVaultError('INVALID_ROLE_KEY', `A ${role === ROLE.PAYMENT ? 'payment' : 'stake'} role key reads ${prefix}1...`);
  }
  return makeRoleKey(role, Bip32PublicKeyHex(hexOf(decoded.bytes)));
}

/**
 * Input from an external wallet only: its CIP-1854 account key (`acct_shared_xvk1...`) or its two
 * role keys (`addr_shared_xvk1...`, `stake_shared_xvk1...`). Returns the role keys to derive that
 * wallet's vault keys from, locally. A Gero cosigner sends `VaultPublicKeys` instead.
 */
export async function parseExternalCosignerKeys(
  input: { readonly account: string } | { readonly payment: string; readonly stake: string },
): Promise<RoleKeys> {
  if (input && 'account' in input) return deriveRoleKeys(multisigAccountPublicKey(input.account));
  const payment = parseExternalRoleKey(ROLE.PAYMENT, (input as { payment?: unknown })?.payment);
  const stake = parseExternalRoleKey(ROLE.STAKE, (input as { stake?: unknown })?.stake);
  if (payment.hex === stake.hex) throw new GeroVaultError('INVALID_ROLE_KEY', 'The payment and stake role keys are the same key');
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

/** One participant's two keys for a vault, both at the participant's own `index`. */
export async function deriveVaultPublicKeys(keys: RoleKeys, index: number): Promise<VaultPublicKeys> {
  if (keys?.payment?.role !== ROLE.PAYMENT || keys?.stake?.role !== ROLE.STAKE) {
    throw new GeroVaultError('INVALID_ROLE_KEY', 'The role keys are in the wrong slots');
  }
  const [payment, stake] = await Promise.all([deriveVaultKey(keys.payment, index), deriveVaultKey(keys.stake, index)]);
  return makeVaultKeys(payment.publicKey, stake.publicKey);
}

/** The key hashes of one participant's vault keys. */
export async function vaultKeyHashes(keys: VaultPublicKeys): Promise<ParticipantKeyHashes> {
  if (keys?.level !== 'vault') throw new GeroVaultError('INVALID_VAULT_KEYS', 'Expected a vault\'s public keys');
  await ready();
  return Object.freeze({
    payment: Ed25519PublicKey.fromHex(keys.payment).hash().hex(),
    stake: Ed25519PublicKey.fromHex(keys.stake).hash().hex(),
  });
}

/** The key hashes one participant contributes at their own `index`. */
export async function deriveParticipantKeyHashes(keys: RoleKeys, index: number): Promise<ParticipantKeyHashes> {
  return vaultKeyHashes(await deriveVaultPublicKeys(keys, index));
}

/** The form to give to cosigners: `addr_shared_vk1...` and `stake_shared_vk1...`. No index. */
export function encodeVaultPublicKeys(keys: VaultPublicKeys): EncodedVaultPublicKeys {
  if (keys?.level !== 'vault') throw new GeroVaultError('INVALID_VAULT_KEYS', 'Only a vault\'s public keys are shared');
  return Object.freeze({
    payment: toBech32(BECH32_PREFIX.PAYMENT_VK, bytesOf(keys.payment)),
    stake: toBech32(BECH32_PREFIX.STAKE_VK, bytesOf(keys.stake)),
  });
}

function parseVaultKey(prefix: string, value: unknown): Ed25519PublicKeyHex {
  const decoded = fromBech32(value);
  if (decoded && (EXTENDED_PREFIXES.has(decoded.prefix) || CIP1852_ACCOUNT_PREFIXES.has(decoded.prefix))) {
    throw new GeroVaultError('EXTENDED_KEY_NOT_ACCEPTED', 'A cosigner sends the vault\'s keys, not an extended key');
  }
  if (!decoded || decoded.prefix !== prefix || decoded.bytes.length !== VK_BYTES) {
    throw new GeroVaultError('INVALID_VAULT_KEYS', `A vault key reads ${prefix}1...`);
  }
  return Ed25519PublicKeyHex(hexOf(decoded.bytes));
}

/** Reads the vault keys a Gero cosigner sent. Extended keys of any level are refused. */
export function parseVaultPublicKeys(encoded: EncodedVaultPublicKeys): VaultPublicKeys {
  return makeVaultKeys(parseVaultKey(BECH32_PREFIX.PAYMENT_VK, encoded?.payment), parseVaultKey(BECH32_PREFIX.STAKE_VK, encoded?.stake));
}

/** Display form of a vault key hash: `addr_shared_vkh1...` or `stake_shared_vkh1...`. */
export function encodeVaultKeyHash(role: Role, keyHash: Ed25519KeyHashHex): string {
  assertRole(role);
  const hex = Ed25519KeyHashHex(keyHash);
  return toBech32(role === ROLE.PAYMENT ? BECH32_PREFIX.PAYMENT_VKH : BECH32_PREFIX.STAKE_VKH, bytesOf(hex));
}
