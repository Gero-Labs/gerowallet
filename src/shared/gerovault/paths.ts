/**
 * CIP-1854 derivation paths of a vault: account `m/1854'/1815'/0'`, role 0 (payment) and
 * role 2 (stake), index `y`. CIP-0146 limits registrations to account 0, so the account is not
 * a parameter here.
 */
import { GeroVaultError } from './errors';
import { CARDANO_COIN_TYPE, CIP146_ACCOUNT, CIP1854_PURPOSE, MAX_VAULT_INDEX, ROLE, Role } from './types';

const HARDENED = 0x80000000;
const harden = (n: number): number => n + HARDENED;

/** The account path as BIP32 indices: `[1854', 1815', 0']`. */
export const CIP1854_ACCOUNT_PATH: readonly number[] = Object.freeze([
  harden(CIP1854_PURPOSE),
  harden(CARDANO_COIN_TYPE),
  harden(CIP146_ACCOUNT),
]);

export function isRole(value: unknown): value is Role {
  return value === ROLE.PAYMENT || value === ROLE.STAKE;
}

export function isVaultIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_VAULT_INDEX;
}

export function assertRole(value: unknown): asserts value is Role {
  if (!isRole(value)) throw new GeroVaultError('INVALID_ROLE', 'A vault key role is 0 (payment) or 2 (stake)');
}

export function assertVaultIndex(value: unknown): asserts value is number {
  if (!isVaultIndex(value)) {
    throw new GeroVaultError('INVALID_INDEX', `A vault index is an integer from 0 to ${MAX_VAULT_INDEX}`);
  }
}

/** The role-level path as BIP32 indices: `[1854', 1815', 0', role]`. */
export function roleKeyPath(role: Role): readonly number[] {
  assertRole(role);
  return Object.freeze([...CIP1854_ACCOUNT_PATH, role]);
}

/**
 * The full path of a vault key as BIP32 indices, `[1854', 1815', 0', role, index]`: the form the
 * hardware signers take (Ledger `BIP32Path`, Trezor path arrays).
 */
export function vaultKeyPath(role: Role, index: number): readonly number[] {
  assertRole(role);
  assertVaultIndex(index);
  return Object.freeze([...CIP1854_ACCOUNT_PATH, role, index]);
}

function format(path: readonly number[]): string {
  return ['m', ...path.map(n => (n >= HARDENED ? `${n - HARDENED}'` : String(n)))].join('/');
}

/**
 * The one notation for vault paths everywhere (GV-15): `m/1854'/1815'/0'/0/y`.
 * Without an index it formats the role-level path, `m/1854'/1815'/0'/0`.
 */
export function formatVaultKeyPath(role: Role, index?: number): string {
  return format(index === undefined ? roleKeyPath(role) : vaultKeyPath(role, index));
}

const PATH_PATTERN = /^m\/1854'\/1815'\/0'\/(0|2)\/(0|[1-9][0-9]{0,9})$/;

/** Parses exactly the notation `formatVaultKeyPath` writes; anything else is refused. */
export function parseVaultKeyPath(path: string): { role: Role; index: number } {
  const match = typeof path === 'string' ? PATH_PATTERN.exec(path) : null;
  const role = match ? Number(match[1]) : NaN;
  const index = match ? Number(match[2]) : NaN;
  if (!match || !isRole(role) || !isVaultIndex(index)) {
    throw new GeroVaultError('INVALID_PATH', "A vault key path reads m/1854'/1815'/0'/role/index");
  }
  return { role, index };
}
