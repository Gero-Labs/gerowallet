/**
 * Key cards: how a participant shares the public keys of one vault, and nothing else (never an
 * extended key, never the index).
 *
 * - Owner card: network, role `owner`, the approval key (Jubjub) and the upgrade key (BIP-340
 *   x-only), and two possession signatures: the approval key's Jubjub signature and the upgrade
 *   key's BIP-340 signature.
 * - Guardian card: network, role `guardian`, the guardian key (Jubjub), the 32-byte guardian salt
 *   (owners need both to compute the guardian's commitment) and the key's Jubjub signature.
 * - Delegate card: network, role `delegate`, the delegate key (Jubjub) and its Jubjub signature.
 * - Every card may carry a label. A label is a claim: it is not signed, and screens show it as a
 *   claim.
 *
 * What the possession signatures sign:
 *
 *   cardDigest = BLAKE2b-256( "gero-vault/v1|midnight|key-card|" || canonical CBOR of
 *                             { network, role, keys } )
 *
 * where `keys` is `{ approval, upgrade }` (owner), `{ key, salt }` (guardian) or `{ key }`
 * (delegate), as byte strings: a Jubjub key in its 64-byte encoding, the upgrade key's 32 bytes,
 * the salt's 32 bytes. The guardian's salt is signed with its key, so a relay cannot swap in a
 * salt the guardian could never match. The Jubjub signatures sign `LE2IP(cardDigest) mod p` (the
 * digest reduced into the field); the BIP-340 signature is the ledger's `signData` over the 32
 * digest bytes (BIP-340 over their SHA-256, `upgradeKey.ts`).
 *
 * The signatures prove whoever made the card holds every key on it. They catch typos and a card
 * where someone put another person's key next to their own; they cannot say whose card it is.
 * That binding is the code check and the verification ceremony.
 *
 * Two encodings carry the same fields:
 * - bech32m, for copying and QR: HRP `gvmn_owner`, `gvmn_guardian` or `gvmn_delegate`, with
 *   `_preprod` or `_preview` appended off mainnet; the data is the canonical CBOR of
 *   `{ version, network, role, <keys>, signatures, label? }` with byte strings; bech32's
 *   90-character limit does not apply;
 * - JSON (`.gvmkey.json`): `type` `gero-vault/v1|midnight-key-card`, `version` 1, and the same
 *   fields with lowercase hex. A Jubjub signature is `{ announcement, response }`: the announcement
 *   point's 64-byte encoding and the response as 32 bytes little-endian.
 *
 * `readKeyCard` never throws. It refuses, in this order: anything malformed, too large, of
 * another version or not in canonical form; a card for another network or another role than
 * expected; a label that fails the read rule; a Jubjub key that fails point validation (off the
 * curve, the identity, of small order, outside the prime-order subgroup) or an upgrade key that
 * does not lift; and any possession signature that does not verify.
 */
import { blake2b } from '@noble/hashes/blake2.js';
import { bech32m } from 'bech32';
import { encodeCanonicalCbor, CborWritableMap } from '../../canonicalCbor';
import { CborItem, readCbor } from '../../cbor';
import { readLabel, writeLabel } from '../../labels';
import { MidnightKeyError } from './errors';
import { concatBytes, fromHex, le2ip, le32, toHex, utf8Bytes, bytesEqual } from './bytes';
import { JubjubPointRefusal, checkJubjubPoint, decodeJubjubPoint, encodeJubjubPoint } from './jubjub';
import { jubjubSign, jubjubVerify } from './schnorr';
import { isUpgradePublicKey, signUpgrade, verifyUpgrade } from './upgradeKey';
import { isMidnightNetwork } from './paths';
import { guardianCommitment } from './guardian';
import type { DelegateKeys, GuardianKeys, OwnerKeys } from './derive';
import {
  FIELD_MODULUS,
  FieldElement,
  JUBJUB_SCALAR_MODULUS,
  JubjubPublicKey,
  JubjubSignature,
  KEY_CARD_ROLES,
  KeyCardRole,
  MidnightNetwork,
  UpgradePublicKeyHex,
} from './types';

export const KEY_CARD_TAG = 'gero-vault/v1|midnight|key-card|';
export const KEY_CARD_FILE_TYPE = 'gero-vault/v1|midnight-key-card';
export const KEY_CARD_VERSION = 1;
export const KEY_CARD_FILE_EXTENSION = '.gvmkey.json';
/** Largest JSON card read, in bytes of UTF-8. */
export const KEY_CARD_MAX_JSON_BYTES = 4096;
/** Longest bech32m card read, in characters. */
export const KEY_CARD_MAX_BECH32_LENGTH = 2048;
const HRP_PREFIX = 'gvmn_';

export interface OwnerKeyCard {
  readonly network: MidnightNetwork;
  readonly role: 'owner';
  readonly approvalKey: JubjubPublicKey;
  readonly upgradeKey: UpgradePublicKeyHex;
  readonly signatures: { readonly approval: JubjubSignature; /** 64 bytes, hex. */ readonly upgrade: string };
  readonly label?: string;
}

export interface GuardianKeyCard {
  readonly network: MidnightNetwork;
  readonly role: 'guardian';
  readonly key: JubjubPublicKey;
  /** The guardian salt, 32 bytes of lowercase hex. */
  readonly salt: string;
  readonly signatures: { readonly key: JubjubSignature };
  readonly label?: string;
}

export interface DelegateKeyCard {
  readonly network: MidnightNetwork;
  readonly role: 'delegate';
  readonly key: JubjubPublicKey;
  readonly signatures: { readonly key: JubjubSignature };
  readonly label?: string;
}

export type MidnightKeyCard = OwnerKeyCard | GuardianKeyCard | DelegateKeyCard;

export interface KeyCardSigningOptions {
  /** Shown to cosigners as a claim. Written by the label write rule (`../../labels`). */
  readonly label?: string;
  /** Hedging randomness of the Jubjub signature; fresh by default. Tests only. */
  readonly rand32?: Uint8Array;
  /** BIP-340 auxiliary randomness of the upgrade signature; fresh by default. Tests only. */
  readonly aux32?: Uint8Array;
}

// ---------------------------------------------------------------------------------------------
// What the signatures sign

type CardKeys =
  | { readonly role: 'owner'; readonly approval: JubjubPublicKey; readonly upgrade: string }
  | { readonly role: 'guardian'; readonly key: JubjubPublicKey; readonly salt: string }
  | { readonly role: 'delegate'; readonly key: JubjubPublicKey };

function signedKeys(k: CardKeys): CborWritableMap {
  if (k.role === 'owner') return { approval: encodeJubjubPoint(k.approval), upgrade: fromHex(k.upgrade, 32) as Uint8Array };
  if (k.role === 'guardian') return { key: encodeJubjubPoint(k.key), salt: fromHex(k.salt, 32) as Uint8Array };
  return { key: encodeJubjubPoint(k.key) };
}

function cardKeys(card: MidnightKeyCard): CardKeys {
  if (card.role === 'owner') return { role: 'owner', approval: card.approvalKey, upgrade: card.upgradeKey };
  if (card.role === 'guardian') return { role: 'guardian', key: card.key, salt: card.salt };
  return { role: 'delegate', key: card.key };
}

function digestOf(network: MidnightNetwork, k: CardKeys): Uint8Array {
  const content = encodeCanonicalCbor({ network, role: k.role, keys: signedKeys(k) });
  return blake2b(concatBytes(utf8Bytes(KEY_CARD_TAG), content), { dkLen: 32 });
}

/** The 32-byte digest a card's possession signatures sign, hex. */
export function keyCardDigest(card: MidnightKeyCard): string {
  return toHex(digestOf(card.network, cardKeys(card)));
}

const digestField = (digest: Uint8Array): FieldElement => (le2ip(digest) % FIELD_MODULUS) as FieldElement;

// ---------------------------------------------------------------------------------------------
// Making a card from this wallet's own keys

function labelOf(options?: KeyCardSigningOptions): { label?: string } {
  if (options?.label === undefined) return {};
  try {
    return { label: writeLabel(options.label) };
  } catch {
    throw new MidnightKeyError('INVALID_LABEL', 'A label must pass the label write rule');
  }
}

/** The owner card of this wallet's owner keys for one vault. */
export function ownerKeyCard(keys: OwnerKeys, options?: KeyCardSigningOptions): OwnerKeyCard {
  const k: CardKeys = { role: 'owner', approval: keys.approval.publicKey, upgrade: keys.upgrade.publicKey };
  const digest = digestOf(keys.network, k);
  return Object.freeze({
    network: keys.network,
    role: 'owner',
    approvalKey: keys.approval.publicKey,
    upgradeKey: keys.upgrade.publicKey,
    signatures: Object.freeze({
      approval: jubjubSign(keys.approval.secretKey, digestField(digest), options?.rand32),
      upgrade: signUpgrade(keys.upgrade.secretKey, digest, options?.aux32),
    }),
    ...labelOf(options),
  });
}

/** The guardian card of this wallet's guardian keys for one vault. */
export function guardianKeyCard(keys: GuardianKeys, options?: KeyCardSigningOptions): GuardianKeyCard {
  const salt = toHex(keys.salt);
  const digest = digestOf(keys.network, { role: 'guardian', key: keys.key.publicKey, salt });
  return Object.freeze({
    network: keys.network,
    role: 'guardian',
    key: keys.key.publicKey,
    salt,
    signatures: Object.freeze({ key: jubjubSign(keys.key.secretKey, digestField(digest), options?.rand32) }),
    ...labelOf(options),
  });
}

/** The delegate card of this wallet's delegate key for one vault. */
export function delegateKeyCard(keys: DelegateKeys, options?: KeyCardSigningOptions): DelegateKeyCard {
  const digest = digestOf(keys.network, { role: 'delegate', key: keys.key.publicKey });
  return Object.freeze({
    network: keys.network,
    role: 'delegate',
    key: keys.key.publicKey,
    signatures: Object.freeze({ key: jubjubSign(keys.key.secretKey, digestField(digest), options?.rand32) }),
    ...labelOf(options),
  });
}

/** The commitment a guardian card's key and salt give in the recovery config. */
export function guardianCardCommitment(card: GuardianKeyCard): FieldElement {
  return guardianCommitment(card.key, fromHex(card.salt, 32) as Uint8Array);
}

// ---------------------------------------------------------------------------------------------
// Encodings

/** The bech32m HRP of a card: `gvmn_<role>`, plus `_preprod` or `_preview` off mainnet. */
export function keyCardHrp(role: KeyCardRole, network: MidnightNetwork): string {
  if (!KEY_CARD_ROLES.includes(role)) throw new MidnightKeyError('INVALID_ROLE', 'A card role is owner, guardian or delegate');
  if (!isMidnightNetwork(network)) throw new MidnightKeyError('INVALID_NETWORK', 'A Midnight network is mainnet, preprod or preview');
  return `${HRP_PREFIX}${role}${network === 'mainnet' ? '' : `_${network}`}`;
}

const sigBytes = (s: JubjubSignature): CborWritableMap => ({ announcement: encodeJubjubPoint(s.announcement), response: le32(s.response) });
const sigHex = (s: JubjubSignature) => ({ announcement: toHex(encodeJubjubPoint(s.announcement)), response: toHex(le32(s.response)) });

function cardCbor(card: MidnightKeyCard): Uint8Array {
  const label = card.label === undefined ? {} : { label: card.label };
  const head = { version: KEY_CARD_VERSION, network: card.network, role: card.role };
  if (card.role === 'owner') {
    return encodeCanonicalCbor({
      ...head,
      approvalKey: encodeJubjubPoint(card.approvalKey),
      upgradeKey: fromHex(card.upgradeKey, 32) as Uint8Array,
      signatures: { approval: sigBytes(card.signatures.approval), upgrade: fromHex(card.signatures.upgrade, 64) as Uint8Array },
      ...label,
    });
  }
  if (card.role === 'guardian') {
    return encodeCanonicalCbor({
      ...head,
      key: encodeJubjubPoint(card.key),
      salt: fromHex(card.salt, 32) as Uint8Array,
      signatures: { key: sigBytes(card.signatures.key) },
      ...label,
    });
  }
  return encodeCanonicalCbor({ ...head, key: encodeJubjubPoint(card.key), signatures: { key: sigBytes(card.signatures.key) }, ...label });
}

/** The card as bech32m text, for copying and QR. */
export function keyCardToBech32(card: MidnightKeyCard): string {
  return bech32m.encode(keyCardHrp(card.role, card.network), bech32m.toWords(cardCbor(card)), KEY_CARD_MAX_BECH32_LENGTH);
}

function cardObject(card: MidnightKeyCard): Record<string, unknown> {
  const head = { type: KEY_CARD_FILE_TYPE, version: KEY_CARD_VERSION, network: card.network, role: card.role };
  const label = card.label === undefined ? {} : { label: card.label };
  if (card.role === 'owner') {
    return {
      ...head,
      approvalKey: toHex(encodeJubjubPoint(card.approvalKey)),
      upgradeKey: card.upgradeKey,
      signatures: { approval: sigHex(card.signatures.approval), upgrade: card.signatures.upgrade },
      ...label,
    };
  }
  if (card.role === 'guardian') {
    return { ...head, key: toHex(encodeJubjubPoint(card.key)), salt: card.salt, signatures: { key: sigHex(card.signatures.key) }, ...label };
  }
  return { ...head, key: toHex(encodeJubjubPoint(card.key)), signatures: { key: sigHex(card.signatures.key) }, ...label };
}

/** The card as the text of a `.gvmkey.json` file. */
export function keyCardToJson(card: MidnightKeyCard): string {
  return `${JSON.stringify(cardObject(card), null, 2)}\n`;
}

// ---------------------------------------------------------------------------------------------
// Reading a card someone else made

export type KeyCardRefusal =
  | 'MALFORMED'
  | 'TOO_LARGE'
  | 'UNSUPPORTED_VERSION'
  | 'NOT_CANONICAL'
  | 'WRONG_NETWORK'
  | 'WRONG_ROLE'
  | 'INVALID_LABEL'
  | 'INVALID_KEY'
  | 'INVALID_UPGRADE_KEY'
  | 'INVALID_SIGNATURE';

export interface KeyCardExpectation {
  /** The vault's network: a card for any other network is refused. */
  readonly network: MidnightNetwork;
  /** The role the card must speak for, when the screen asks for one. */
  readonly role?: KeyCardRole;
}

export type KeyCardReadResult =
  | { readonly ok: true; readonly card: MidnightKeyCard; readonly encoding: 'bech32m' | 'json' }
  | {
      readonly ok: false;
      readonly code: KeyCardRefusal;
      /** For `INVALID_KEY`: why point validation refused the key. */
      readonly point?: JubjubPointRefusal;
      /** For `INVALID_KEY` and `INVALID_SIGNATURE`: which key or signature. */
      readonly field?: 'approvalKey' | 'key' | 'approval' | 'upgrade';
    };

type Refusal = Extract<KeyCardReadResult, { ok: false }>;
const refuse = (code: KeyCardRefusal, extra: Omit<Refusal, 'ok' | 'code'> = {}): Refusal => ({ ok: false, code, ...extra });

class Refused extends Error {
  constructor(readonly refusal: Refusal) {
    super(refusal.code);
  }
}

const fail = (code: KeyCardRefusal, extra: Omit<Refusal, 'ok' | 'code'> = {}): never => {
  throw new Refused(refuse(code, extra));
};

const isPlainObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

function exactKeys(o: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  const keys = Object.keys(o);
  if (!required.every(k => Object.prototype.hasOwnProperty.call(o, k))) fail('MALFORMED');
  if (!keys.every(k => required.includes(k) || optional.includes(k))) fail('MALFORMED');
}

function hexField(v: unknown, bytes: number): string {
  if (!fromHex(v, bytes)) fail('MALFORMED');
  return v as string;
}

function signatureField(v: unknown, field: 'approval' | 'key'): JubjubSignature {
  if (!isPlainObject(v)) return fail('MALFORMED');
  exactKeys(v, ['announcement', 'response']);
  const announcementBytes = fromHex(v['announcement'], 64);
  const response = fromHex(v['response'], 32);
  if (!announcementBytes || !response) return fail('MALFORMED');
  const announcement = decodeJubjubPoint(announcementBytes);
  const s = le2ip(response);
  if (!announcement || s >= JUBJUB_SCALAR_MODULUS) return fail('INVALID_SIGNATURE', { field });
  return Object.freeze({ announcement, response: s });
}

function pointField(v: unknown, field: 'approvalKey' | 'key'): JubjubPublicKey {
  const p = decodeJubjubPoint(fromHex(v, 64) ?? new Uint8Array(0));
  if (!p) {
    if (fromHex(v, 64)) return fail('INVALID_KEY', { point: 'OUT_OF_RANGE', field });
    return fail('MALFORMED');
  }
  const checked = checkJubjubPoint(p);
  if (checked.ok === false) return fail('INVALID_KEY', { point: checked.code, field });
  return checked.key;
}

/**
 * Validates a card object in its JSON shape (hex strings) against the expectation; returns the
 * card. Throws `Refused` only.
 */
function validate(o: unknown, expect: KeyCardExpectation): MidnightKeyCard {
  if (!isPlainObject(o)) return fail('MALFORMED');
  if (o['type'] !== KEY_CARD_FILE_TYPE) return fail('MALFORMED');
  if (o['version'] !== KEY_CARD_VERSION) return fail(typeof o['version'] === 'number' ? 'UNSUPPORTED_VERSION' : 'MALFORMED');
  const network = o['network'];
  const role = o['role'];
  if (!isMidnightNetwork(network) || typeof role !== 'string' || !(KEY_CARD_ROLES as readonly string[]).includes(role)) return fail('MALFORMED');
  const base = ['type', 'version', 'network', 'role', 'signatures'];
  if (role === 'owner') exactKeys(o, [...base, 'approvalKey', 'upgradeKey'], ['label']);
  else if (role === 'guardian') exactKeys(o, [...base, 'key', 'salt'], ['label']);
  else exactKeys(o, [...base, 'key'], ['label']);
  const sigs = o['signatures'];
  if (!isPlainObject(sigs)) return fail('MALFORMED');
  exactKeys(sigs, role === 'owner' ? ['approval', 'upgrade'] : ['key']);
  // Shape first, so a malformed card is never reported as a wrong network.
  if (role === 'owner') {
    hexField(o['approvalKey'], 64);
    hexField(o['upgradeKey'], 32);
    hexField(sigs['upgrade'], 64);
  } else {
    hexField(o['key'], 64);
    if (role === 'guardian') hexField(o['salt'], 32);
  }

  if (network !== expect.network) return fail('WRONG_NETWORK');
  if (expect.role !== undefined && role !== expect.role) return fail('WRONG_ROLE');
  let label: { label?: string } = {};
  if (o['label'] !== undefined) {
    const read = readLabel(o['label']);
    if (read === undefined) return fail('INVALID_LABEL');
    label = { label: read };
  }

  if (role === 'owner') {
    const approvalKey = pointField(o['approvalKey'], 'approvalKey');
    if (!isUpgradePublicKey(o['upgradeKey'])) return fail('INVALID_UPGRADE_KEY');
    const upgradeKey = o['upgradeKey'];
    const approval = signatureField(sigs['approval'], 'approval');
    const upgrade = sigs['upgrade'] as string;
    const digest = digestOf(network, { role: 'owner', approval: approvalKey, upgrade: upgradeKey });
    if (!jubjubVerify(approvalKey, digestField(digest), approval)) return fail('INVALID_SIGNATURE', { field: 'approval' });
    if (!verifyUpgrade(upgradeKey, digest, upgrade)) return fail('INVALID_SIGNATURE', { field: 'upgrade' });
    return Object.freeze({ network, role, approvalKey, upgradeKey, signatures: Object.freeze({ approval, upgrade }), ...label });
  }
  const key = pointField(o['key'], 'key');
  const signature = signatureField(sigs['key'], 'key');
  if (role === 'guardian') {
    const salt = o['salt'] as string;
    const digest = digestOf(network, { role: 'guardian', key, salt });
    if (!jubjubVerify(key, digestField(digest), signature)) return fail('INVALID_SIGNATURE', { field: 'key' });
    return Object.freeze({ network, role, key, salt, signatures: Object.freeze({ key: signature }), ...label });
  }
  const digest = digestOf(network, { role: 'delegate', key });
  if (!jubjubVerify(key, digestField(digest), signature)) return fail('INVALID_SIGNATURE', { field: 'key' });
  return Object.freeze({ network, role: 'delegate', key, signatures: Object.freeze({ key: signature }), ...label });
}

/** The JSON shape of a CBOR item: maps with text keys, hex for byte strings. Throws `Refused`. */
function fromCbor(item: CborItem, depth = 0): unknown {
  const v = item.value;
  if (v.type === 'bytes') return toHex(v.value);
  if (v.type === 'text') return v.value;
  if (v.type === 'int') return v.value >= 0n && v.value <= 0xffffn ? Number(v.value) : fail('MALFORMED');
  if (v.type === 'map' && depth < 3) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of v.value) {
      if (k.value.type !== 'text' || k.value.value === '__proto__') return fail('MALFORMED');
      out[k.value.value] = fromCbor(val, depth + 1);
    }
    return out;
  }
  return fail('MALFORMED');
}

function readJson(text: string, expect: KeyCardExpectation): MidnightKeyCard {
  // A string never has fewer UTF-8 bytes than UTF-16 units, so the length alone settles long input.
  if (text.length > KEY_CARD_MAX_JSON_BYTES || utf8Bytes(text).length > KEY_CARD_MAX_JSON_BYTES) return fail('TOO_LARGE');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail('MALFORMED');
  }
  return validate(parsed, expect);
}

function readBech32(text: string, expect: KeyCardExpectation): MidnightKeyCard {
  if (text.length > KEY_CARD_MAX_BECH32_LENGTH) return fail('TOO_LARGE');
  const decoded = bech32m.decodeUnsafe(text, KEY_CARD_MAX_BECH32_LENGTH);
  const words = decoded ? bech32m.fromWordsUnsafe(decoded.words) : undefined;
  if (!decoded || !words) return fail('MALFORMED');
  const bytes = Uint8Array.from(words);
  let item: CborItem;
  try {
    item = readCbor(bytes, { maxDepth: 4, maxItems: 64 });
  } catch {
    return fail('MALFORMED');
  }
  const o = fromCbor(item);
  if (!isPlainObject(o)) return fail('MALFORMED');
  const network = o['network'];
  const role = o['role'];
  if (typeof role !== 'string' || !(KEY_CARD_ROLES as readonly string[]).includes(role) || !isMidnightNetwork(network)) return fail('MALFORMED');
  if (decoded.prefix !== keyCardHrp(role as KeyCardRole, network)) return fail('MALFORMED');
  const card = validate({ ...o, type: KEY_CARD_FILE_TYPE }, expect);
  if (!bytesEqual(cardCbor(card), bytes)) return fail('NOT_CANONICAL');
  return card;
}

/**
 * Reads a key card from its bech32m text (starting `gvmn_`, either case) or from the text of a
 * `.gvmkey.json` file, and runs every check. Never throws.
 */
export function readKeyCard(input: unknown, expect: KeyCardExpectation): KeyCardReadResult {
  try {
    if (!expect || !isMidnightNetwork(expect.network) || (expect.role !== undefined && !KEY_CARD_ROLES.includes(expect.role))) return refuse('MALFORMED');
    if (typeof input !== 'string') return refuse('MALFORMED');
    if (input.slice(0, HRP_PREFIX.length).toLowerCase() === HRP_PREFIX) return { ok: true, card: readBech32(input, expect), encoding: 'bech32m' };
    return { ok: true, card: readJson(input, expect), encoding: 'json' };
  } catch (e) {
    return e instanceof Refused ? e.refusal : refuse('MALFORMED');
  }
}
