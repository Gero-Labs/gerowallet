/**
 * Derivation paths of Midnight vault keys: `m/1854'/2400'/n'/r'/i'`, secp256k1 BIP-32 from the
 * BIP-39 seed, every level hardened. A GeroVault convention, documented as such; not a Midnight
 * standard.
 *
 * - purpose `1854'`: GeroVault's multisig purpose, by analogy with CIP-1854;
 * - coin `2400'`: Midnight's coin type;
 * - network `n'`: `0'` mainnet, `1'` preprod, `2'` preview; `3'` is reserved;
 * - role `r'`: `0'` owner approval (Jubjub), `1'` owner upgrade (BIP-340), `2'` guardian (Jubjub),
 *   `3'` delegate (Jubjub); `4'` to `9'` are reserved;
 * - index `i'`: from 1, one counter per seed and network across roles, never reused
 *   (`indexCounter.ts`). An owner's approval and upgrade keys in one vault share `i`.
 *
 * The network level keeps a test vault's keys apart from a mainnet vault's: owner keys are public
 * in contract state. Every level is hardened because no extended key is ever shared.
 */
import { MidnightKeyError } from './errors';
import { MIDNIGHT_KEY_ROLES, MIDNIGHT_NETWORKS, MidnightKeyRole, MidnightNetwork } from './types';

export const MIDNIGHT_VAULT_PURPOSE = 1854;
export const MIDNIGHT_COIN_TYPE = 2400;
export const HARDENED = 0x80000000;
/** The first index a vault key uses: 0 is never allocated. */
export const FIRST_KEY_INDEX = 1;
/** The largest hardened index, 2^31 - 1. */
export const MAX_KEY_INDEX = 0x7fffffff;

export const NETWORK_LEVEL: Readonly<Record<MidnightNetwork, number>> = Object.freeze({ mainnet: 0, preprod: 1, preview: 2 });
/** Network levels held back for a future network: refused until assigned. */
export const RESERVED_NETWORK_LEVELS: readonly number[] = Object.freeze([3]);
export const ROLE_LEVEL: Readonly<Record<MidnightKeyRole, number>> = Object.freeze({ approval: 0, upgrade: 1, guardian: 2, delegate: 3 });
/** Role levels held back for future key types: refused until assigned. */
export const RESERVED_ROLE_LEVELS: readonly number[] = Object.freeze([4, 5, 6, 7, 8, 9]);

export function isMidnightNetwork(value: unknown): value is MidnightNetwork {
  return typeof value === 'string' && (MIDNIGHT_NETWORKS as readonly string[]).includes(value);
}

export function isMidnightKeyRole(value: unknown): value is MidnightKeyRole {
  return typeof value === 'string' && (MIDNIGHT_KEY_ROLES as readonly string[]).includes(value);
}

export function isMidnightKeyIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= FIRST_KEY_INDEX && value <= MAX_KEY_INDEX;
}

export function assertMidnightNetwork(value: unknown): asserts value is MidnightNetwork {
  if (!isMidnightNetwork(value)) throw new MidnightKeyError('INVALID_NETWORK', 'A Midnight network is mainnet, preprod or preview');
}

export function assertMidnightKeyRole(value: unknown): asserts value is MidnightKeyRole {
  if (!isMidnightKeyRole(value)) throw new MidnightKeyError('INVALID_ROLE', 'A key role is approval, upgrade, guardian or delegate');
}

export function assertMidnightKeyIndex(value: unknown): asserts value is number {
  if (!isMidnightKeyIndex(value)) throw new MidnightKeyError('INVALID_INDEX', `A vault key index is an integer from ${FIRST_KEY_INDEX} to ${MAX_KEY_INDEX}`);
}

/** The network a network level names. Throws `RESERVED_NETWORK` for `3`, `INVALID_NETWORK` for anything else unknown. */
export function networkFromLevel(level: number): MidnightNetwork {
  const network = MIDNIGHT_NETWORKS.find(n => NETWORK_LEVEL[n] === level);
  if (network) return network;
  if (RESERVED_NETWORK_LEVELS.includes(level)) throw new MidnightKeyError('RESERVED_NETWORK', `Network level ${level}' is reserved`);
  throw new MidnightKeyError('INVALID_NETWORK', 'Unknown network level');
}

/** The role a role level names. Throws `RESERVED_ROLE` for `4` to `9`, `INVALID_ROLE` for anything else unknown. */
export function roleFromLevel(level: number): MidnightKeyRole {
  const role = MIDNIGHT_KEY_ROLES.find(r => ROLE_LEVEL[r] === level);
  if (role) return role;
  if (RESERVED_ROLE_LEVELS.includes(level)) throw new MidnightKeyError('RESERVED_ROLE', `Role level ${level}' is reserved`);
  throw new MidnightKeyError('INVALID_ROLE', 'Unknown role level');
}

/** The path as hardened BIP-32 indices: `[1854', 2400', n', r', i']`. */
export function midnightKeyPath(network: MidnightNetwork, role: MidnightKeyRole, index: number): readonly number[] {
  assertMidnightNetwork(network);
  assertMidnightKeyRole(role);
  assertMidnightKeyIndex(index);
  return Object.freeze([MIDNIGHT_VAULT_PURPOSE, MIDNIGHT_COIN_TYPE, NETWORK_LEVEL[network], ROLE_LEVEL[role], index].map(n => n + HARDENED));
}

/** The one notation for these paths: `m/1854'/2400'/n'/r'/i'`. */
export function formatMidnightKeyPath(network: MidnightNetwork, role: MidnightKeyRole, index: number): string {
  return ['m', ...midnightKeyPath(network, role, index).map(n => `${n - HARDENED}'`)].join('/');
}

const PATH_PATTERN = /^m\/1854'\/2400'\/(0|[1-9][0-9]{0,9})'\/(0|[1-9][0-9]{0,9})'\/(0|[1-9][0-9]{0,9})'$/;

/**
 * Parses exactly the notation `formatMidnightKeyPath` writes. Throws `INVALID_PATH` for any other
 * notation, `RESERVED_NETWORK` or `RESERVED_ROLE` for a reserved level, `INVALID_NETWORK` or
 * `INVALID_ROLE` for an unknown one, and `INVALID_INDEX` for index 0 or one above `2^31 - 1`.
 */
export function parseMidnightKeyPath(path: string): { readonly network: MidnightNetwork; readonly role: MidnightKeyRole; readonly index: number } {
  const match = typeof path === 'string' ? PATH_PATTERN.exec(path) : null;
  if (!match) throw new MidnightKeyError('INVALID_PATH', "A vault key path reads m/1854'/2400'/network'/role'/index'");
  const network = networkFromLevel(Number(match[1]));
  const role = roleFromLevel(Number(match[2]));
  const index = Number(match[3]);
  assertMidnightKeyIndex(index);
  return Object.freeze({ network, role, index });
}
