/**
 * The verification ceremony of a Midnight vault: before anyone funds it, each co-owner compares
 * the vault's keys and settings with every other co-owner outside the channel the setup used.
 *
 * The verification set is the canonical CBOR of
 *
 *   { protocol "gero-vault/v1", chain "midnight", network, build, buildHash,
 *     owners [[approval key, upgrade key], ...] in slot order, threshold, changeDelay,
 *     whitelistEnabled, whitelist [[recipient, scope], ...] in slot order,
 *     guardians [commitment, ...] in slot order, guardianThreshold, recoveryDelay, cooldown,
 *     expiryWindow }
 *
 * with keys, recipients and commitments as byte strings (a Jubjub key in its 64-byte encoding, a
 * commitment as 32 bytes little-endian) and scope as the contract's enum (0 quorum only, 1 any).
 * Labels are not in it. Nor is the contract address, which does not exist before the deploy is
 * built: each owner's import check binds the deployed state to the verified set instead. These
 * are the vault constructor's arguments, so the set is exactly what the deploy commits to.
 *
 * - The verification number, read out over a call: eight groups of five digits,
 *   `d = BLAKE2b-320( "gero-vault/v1|midnight-verification-number|" || set )`, by the Cardano
 *   verification number's digit routine (`digits.ts`). Digits, not words: nobody ever reads a list
 *   of words to another person, and the screen says these are not recovery words.
 * - The QR, scanned in person: `gero-vault/v1|MN-VERIFY|<network>|<build>|<digest>`, with the full
 *   `BLAKE2b-256( "gero-vault/v1|midnight-verification|" || set )` in lowercase hex.
 */
import { blake2b } from '@noble/hashes/blake2.js';
import { encodeCanonicalCbor } from '../../canonicalCbor';
import { MidnightKeyError } from './errors';
import { concatBytes, fromHex, le32, toHex, utf8Bytes } from './bytes';
import { digitGroups, GROUP_BYTES } from './digits';
import { checkJubjubPoint, encodeJubjubPoint } from './jubjub';
import { isUpgradePublicKey } from './upgradeKey';
import { isMidnightNetwork } from './paths';
import { FIELD_MODULUS, FieldElement, JubjubPoint, MidnightNetwork } from './types';

export const MIDNIGHT_VERIFICATION_PROTOCOL = 'gero-vault/v1';
export const MIDNIGHT_VERIFICATION_CHAIN = 'midnight';
export const MIDNIGHT_VERIFICATION_DIGEST_TAG = 'gero-vault/v1|midnight-verification|';
export const MIDNIGHT_VERIFICATION_NUMBER_TAG = 'gero-vault/v1|midnight-verification-number|';
export const MIDNIGHT_VERIFICATION_NUMBER_GROUPS = 8;
export const MIDNIGHT_VERIFICATION_QR_TYPE = 'MN-VERIFY';
export const OWNER_SLOTS = 5;
export const WHITELIST_SLOTS = 8;
export const GUARDIAN_SLOTS = 5;

/** A pinned build id, as the contract freeze names it (`gvmn-<profile>-<16 hex>`). */
const BUILD_ID = /^gvmn-(test|production)-[0-9a-f]{16}$/;
const HEX32 = /^[0-9a-f]{64}$/;
const QR_MAX_LENGTH = 256;

export type WhitelistScope = 'quorumOnly' | 'any';
const SCOPE_CODE: Readonly<Record<WhitelistScope, number>> = Object.freeze({ quorumOnly: 0, any: 1 });

export interface MidnightVerificationSet {
  readonly network: MidnightNetwork;
  /** The pinned build id. A test build is accepted on preprod only. */
  readonly build: string;
  /** The hash of the pinned build manifest, 32 bytes of lowercase hex. */
  readonly buildHash: string;
  /** In slot order, 1 to 5. */
  readonly owners: readonly { readonly approvalKey: JubjubPoint; /** x-only, hex. */ readonly upgradeKey: string }[];
  readonly threshold: number;
  /** Seconds. */
  readonly changeDelay: number;
  readonly whitelistEnabled: boolean;
  /** The used entries in slot order, at most 8. */
  readonly whitelist: readonly { /** The 32-byte user address, hex. */ readonly recipient: string; readonly scope: WhitelistScope }[];
  /** The guardian commitments of the used slots in slot order, at most 5. */
  readonly guardians: readonly FieldElement[];
  /** 0 with no guardians (recovery off), else a majority: `1 <= t <= n` and `2t > n`. */
  readonly guardianThreshold: number;
  /** Seconds. */
  readonly recoveryDelay: number;
  /** Seconds. */
  readonly cooldown: number;
  /** Seconds. */
  readonly expiryWindow: number;
}

const bad = (message: string): never => {
  throw new MidnightKeyError('INVALID_VERIFICATION_SET', message);
};

const isSeconds = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

function setBytes(set: MidnightVerificationSet): Uint8Array {
  if (!set || typeof set !== 'object') return bad('A verification set is an object');
  if (!isMidnightNetwork(set.network)) return bad('Unknown network');
  const build = BUILD_ID.exec(typeof set.build === 'string' ? set.build : '');
  if (!build) return bad('A build id reads gvmn-<profile>-<16 hex>');
  if (build[1] === 'test' && set.network !== 'preprod') return bad('A test build is for preprod only');
  if (typeof set.buildHash !== 'string' || !HEX32.test(set.buildHash)) return bad('A build hash is 32 bytes of lowercase hex');

  const owners = Array.isArray(set.owners) ? set.owners : bad('Owners are a list');
  if (owners.length < 1 || owners.length > OWNER_SLOTS) bad(`A vault has 1 to ${OWNER_SLOTS} owners`);
  const ownerWords = owners.map(o => {
    const approval = checkJubjubPoint(o?.approvalKey);
    if (approval.ok === false) return bad(`An owner approval key fails point validation: ${approval.code}`);
    if (!isUpgradePublicKey(o.upgradeKey)) return bad('An owner upgrade key is an x-only key that lifts');
    return [encodeJubjubPoint(approval.key), fromHex(o.upgradeKey, 32) as Uint8Array];
  });
  if (new Set(ownerWords.map(([a]) => toHex(a))).size !== owners.length) bad('An approval key appears twice');
  if (new Set(ownerWords.map(([, u]) => toHex(u))).size !== owners.length) bad('An upgrade key appears twice');
  if (!Number.isInteger(set.threshold) || set.threshold < 1 || set.threshold > owners.length) bad('The threshold is from 1 to the number of owners');
  if (!isSeconds(set.changeDelay)) bad('The change delay is whole seconds');

  if (typeof set.whitelistEnabled !== 'boolean') bad('The whitelist is on or off');
  const whitelist = Array.isArray(set.whitelist) ? set.whitelist : bad('The whitelist is a list');
  if (whitelist.length > WHITELIST_SLOTS) bad(`A whitelist has at most ${WHITELIST_SLOTS} entries`);
  const entries = whitelist.map(e => {
    const recipient = typeof e?.recipient === 'string' && HEX32.test(e.recipient) ? fromHex(e.recipient, 32) : undefined;
    if (!recipient) return bad('A whitelist recipient is a 32-byte address in lowercase hex');
    if (!Object.prototype.hasOwnProperty.call(SCOPE_CODE, e.scope)) return bad('A whitelist scope is quorumOnly or any');
    return [recipient, SCOPE_CODE[e.scope]] as const;
  });
  if (new Set(whitelist.map(e => e.recipient)).size !== whitelist.length) bad('A whitelist recipient appears twice');

  const guardians = Array.isArray(set.guardians) ? set.guardians : bad('Guardians are a list');
  if (guardians.length > GUARDIAN_SLOTS) bad(`A vault has at most ${GUARDIAN_SLOTS} guardians`);
  if (!guardians.every(c => typeof c === 'bigint' && c > 0n && c < FIELD_MODULUS)) bad('A guardian commitment is a non-zero field element');
  if (new Set(guardians.map(c => c.toString())).size !== guardians.length) bad('A guardian commitment appears twice');
  const t = set.guardianThreshold;
  const n = guardians.length;
  if (!Number.isInteger(t) || (n === 0 ? t !== 0 : t < 1 || t > n || 2 * t <= n)) bad('The guardian threshold is 0 without guardians, else a majority');
  for (const s of [set.recoveryDelay, set.cooldown, set.expiryWindow]) if (!isSeconds(s)) bad('Recovery times are whole seconds');

  return encodeCanonicalCbor({
    protocol: MIDNIGHT_VERIFICATION_PROTOCOL,
    chain: MIDNIGHT_VERIFICATION_CHAIN,
    network: set.network,
    build: set.build,
    buildHash: fromHex(set.buildHash, 32) as Uint8Array,
    owners: ownerWords,
    threshold: set.threshold,
    changeDelay: set.changeDelay,
    whitelistEnabled: set.whitelistEnabled,
    whitelist: entries.map(([r, s]) => [r, s]),
    guardians: guardians.map(c => le32(c)),
    guardianThreshold: t,
    recoveryDelay: set.recoveryDelay,
    cooldown: set.cooldown,
    expiryWindow: set.expiryWindow,
  });
}

/** The canonical CBOR of the set, hex. Throws `MidnightKeyError('INVALID_VERIFICATION_SET')`. */
export function verificationSetCbor(set: MidnightVerificationSet): string {
  return toHex(setBytes(set));
}

/** `BLAKE2b-256( "gero-vault/v1|midnight-verification|" || set )`, hex: the QR's value. */
export function verificationDigest(set: MidnightVerificationSet): string {
  return toHex(blake2b(concatBytes(utf8Bytes(MIDNIGHT_VERIFICATION_DIGEST_TAG), setBytes(set)), { dkLen: 32 }));
}

/** The verification number every co-owner reads out: 8 groups of 5 digits. */
export function verificationNumber(set: MidnightVerificationSet): readonly string[] {
  const d = blake2b(concatBytes(utf8Bytes(MIDNIGHT_VERIFICATION_NUMBER_TAG), setBytes(set)), { dkLen: GROUP_BYTES * MIDNIGHT_VERIFICATION_NUMBER_GROUPS });
  return digitGroups(d, MIDNIGHT_VERIFICATION_NUMBER_GROUPS);
}

/** `gero-vault/v1|MN-VERIFY|<network>|<build>|<verificationDigest>`. */
export function verificationQrPayload(set: MidnightVerificationSet): string {
  return [MIDNIGHT_VERIFICATION_PROTOCOL, MIDNIGHT_VERIFICATION_QR_TYPE, set.network, set.build, verificationDigest(set)].join('|');
}

export interface MidnightVerificationQr {
  readonly network: MidnightNetwork;
  readonly build: string;
  readonly verificationDigest: string;
}

/** Reads a scanned payload. Never throws. */
export function parseVerificationQr(payload: unknown): { readonly ok: true; readonly qr: MidnightVerificationQr } | { readonly ok: false; readonly code: 'MALFORMED_QR' } {
  const malformed = { ok: false, code: 'MALFORMED_QR' } as const;
  if (typeof payload !== 'string' || payload.length > QR_MAX_LENGTH) return malformed;
  const parts = payload.split('|');
  if (parts.length !== 5 || parts[0] !== MIDNIGHT_VERIFICATION_PROTOCOL || parts[1] !== MIDNIGHT_VERIFICATION_QR_TYPE) return malformed;
  const [, , network, build, digest] = parts;
  if (!isMidnightNetwork(network) || !BUILD_ID.test(build) || !HEX32.test(digest)) return malformed;
  return { ok: true, qr: Object.freeze({ network, build, verificationDigest: digest }) };
}

/**
 * Compares a scanned payload with this device's set. Only `MATCH` verifies the co-owner:
 * `OTHER_BUILD` is another network or build, `DIFFERENT_SET` the same build with other keys or
 * settings. Throws only for an invalid local set.
 */
export function compareVerificationQr(payload: unknown, set: MidnightVerificationSet): 'MATCH' | 'OTHER_BUILD' | 'DIFFERENT_SET' | 'MALFORMED_QR' {
  const digest = verificationDigest(set);
  const parsed = parseVerificationQr(payload);
  if (parsed.ok === false) return 'MALFORMED_QR';
  if (parsed.qr.network !== set.network || parsed.qr.build !== set.build) return 'OTHER_BUILD';
  return parsed.qr.verificationDigest === digest ? 'MATCH' : 'DIFFERENT_SET';
}
