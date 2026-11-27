/**
 * CIP-0146 multisig registration under metadata label 1854.
 *
 * A registration is the transaction's auxiliary data: the native scripts array, and under label
 * 1854 a `MultiSigRegistration` whose `types` lists the CIP-1854 role of each script in the same
 * order (CIP-0146 "Specification"). `name`, `description`, `icon` and the `participants` details
 * are optional and may be CIP-83 encrypted; `types` never is.
 *
 * Anyone can publish a registration naming anyone's key hashes, so a decoded registration is a
 * candidate, never a vault (spec 4.0). `decodeRegistration` checks the shape only and never
 * throws; `rebuildFromRegistration` is the check that the scripts are the vault the participants'
 * own keys make, each participant's keys at one index of their own.
 */
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Ed25519KeyHashHex } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { CborError, CborItem, CborValue, bytesToHex, hexToBytes, readCbor } from './cbor';
import { CIP83_CHUNK, CIP83_DEFAULT_PASSPHRASE, cip83Decrypt, cip83Encrypt } from './cip83';
import { GeroVaultError } from './errors';
import { deriveParticipantKeyHashes, deriveVaultKey, vaultKeyHashes } from './keys';
import { DISCOVERY_GAP_LIMIT, ParticipantIndexHistory } from './indexAllocation';
import {
  ParsedVaultScript,
  buildVaultScripts,
  instantiateVaultScripts,
  parseVaultScript,
  vaultScript,
  vaultSpecWarnings,
} from './scripts';
import {
  MAX_VAULT_INDEX,
  ParticipantKeyHashes,
  ROLE,
  Role,
  RoleKeys,
  VaultPublicKeys,
  VaultScript,
  VaultScripts,
  VaultTemplate,
} from './types';

export const CIP146_LABEL = 1854n;

/** Ledger limit on a metadata text or byte string. */
const METADATA_STRING_BYTES = 64;
/** Bounds on untrusted input. A transaction is at most 16 KiB, so a real registration is smaller. */
export const MAX_REGISTRATION_BYTES = 16384;
const METADATA_LIMITS = { maxDepth: 16, maxItems: 4096 };
const SCRIPT_LIMITS = { maxDepth: 8, maxItems: 512 };
const MAX_SCRIPT_KEYS = 64;
/** Two sets of at most 20 owners and 20 backup holders, payment and stake keys each. */
export const MAX_PARTICIPANTS = 80;
/** An encrypted field longer than this many 64-character chunks is refused (4 KiB of base64). */
const MAX_CHUNKS = 64;

const KEY_HASH = /^[0-9a-f]{56}$/;
const SUPPORTED_TYPES: readonly number[] = [ROLE.PAYMENT, ROLE.STAKE];

// ---------------------------------------------------------------------------------------------
// Encoding

export interface ParticipantDescription {
  readonly name: string;
  readonly description?: string;
  readonly icon?: string;
}

export interface VaultDescription {
  readonly name?: string;
  readonly description?: string;
  /** CIP-0146: a URL to a non-animated image of at most 40 kB. */
  readonly icon?: string;
  /** Keyed by a key hash that appears in the vault's scripts (lowercase hex). */
  readonly participants?: Readonly<Record<string, ParticipantDescription>>;
}

export interface RegistrationEncryption {
  readonly method: 'basic';
  /** Defaults to CIP-83's public `cardano`, which hides nothing from anyone who looks. */
  readonly passphrase?: string;
  /** Tests only: a fixed 8-byte salt. */
  readonly salt?: Uint8Array;
}

/** JSON (no-conversions schema) of the value under label 1854. */
export type RegistrationJson = { readonly [key: string]: RegistrationJsonValue };
export type RegistrationJsonValue = string | number | readonly RegistrationJsonValue[] | RegistrationJson;

export interface EncodedRegistration {
  readonly label: bigint;
  /** The value to put under label 1854. */
  readonly metadatum: Cardano.Metadatum;
  readonly json: RegistrationJson;
  /** The auxiliary data native scripts, in `types` order. */
  readonly nativeScripts: readonly Cardano.NativeScript[];
  /** CIP-0146 `OffChainMultiSigRegistration`: the metadata map and the scripts array, CBOR hex. */
  readonly offChain: { readonly metadata: string; readonly native_scripts: string };
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

function describe(message: string): never {
  throw new GeroVaultError('INVALID_DESCRIPTION', message);
}

function textValue(value: unknown, what: string, encryption?: RegistrationEncryption): RegistrationJsonValue {
  if (typeof value !== 'string' || value.length === 0) describe(`${what} is a non-empty string`);
  if (!encryption) {
    if (utf8Length(value) > METADATA_STRING_BYTES) describe(`${what} is at most ${METADATA_STRING_BYTES} bytes unless encrypted`);
    return value;
  }
  const chunks = cip83Encrypt(value, encryption.passphrase ?? CIP83_DEFAULT_PASSPHRASE, encryption.salt);
  if (chunks.length > MAX_CHUNKS) describe(`${what} is too long`);
  return chunks;
}

function toMetadatum(value: RegistrationJsonValue): Cardano.Metadatum {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return BigInt(value);
  if (Array.isArray(value)) return value.map(toMetadatum);
  const map: Cardano.MetadatumMap = new Map();
  for (const [k, v] of Object.entries(value as RegistrationJson)) map.set(k, toMetadatum(v));
  return map;
}

function scriptKeyHashes(script: Cardano.NativeScript, out: Set<string>): void {
  if (script.kind === Cardano.NativeScriptKind.RequireSignature) out.add(script.keyHash);
  if ('scripts' in script) script.scripts.forEach(s => scriptKeyHashes(s, out));
}

/** The auxiliary data native scripts array of an encoded registration, for building the transaction. */
export function registrationScriptsCbor(scripts: readonly VaultScript[]): HexBlob {
  const writer = new Serialization.CborWriter();
  writer.writeStartArray(scripts.length);
  for (const s of scripts) writer.writeEncodedValue(hexToBytes(s.cbor));
  return writer.encodeAsHex();
}

/** Encodes a vault's registration. Throws `GeroVaultError('INVALID_DESCRIPTION')` for bad text. */
export function encodeRegistration(
  vault: Pick<VaultScripts, 'payment' | 'stake'>,
  description: VaultDescription = {},
  encryption?: RegistrationEncryption,
): EncodedRegistration {
  if (encryption && encryption.method !== 'basic') {
    throw new GeroVaultError('INVALID_PASSPHRASE', 'The only CIP-83 method is basic');
  }
  if (encryption?.passphrase !== undefined && (typeof encryption.passphrase !== 'string' || encryption.passphrase === '')) {
    throw new GeroVaultError('INVALID_PASSPHRASE', 'A passphrase is a non-empty string');
  }
  const json: Record<string, RegistrationJsonValue> = {};
  if (encryption) json['enc'] = encryption.method;
  json['types'] = [ROLE.PAYMENT, ROLE.STAKE];
  for (const field of ['name', 'description', 'icon'] as const) {
    if (description[field] !== undefined) json[field] = textValue(description[field], field, encryption);
  }
  const participants = description.participants ? Object.entries(description.participants) : [];
  if (participants.length > MAX_PARTICIPANTS) describe('Too many participants');
  if (participants.length > 0) {
    const inScripts = new Set<string>();
    scriptKeyHashes(vault.payment.script, inScripts);
    scriptKeyHashes(vault.stake.script, inScripts);
    const out: Record<string, RegistrationJsonValue> = {};
    for (const [keyHash, p] of participants.sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (!KEY_HASH.test(keyHash) || !inScripts.has(keyHash)) describe('A participant is keyed by a key hash of the vault');
      const entry: Record<string, RegistrationJsonValue> = { name: textValue(p?.name, 'A participant name', encryption) };
      if (p.description !== undefined) entry['description'] = textValue(p.description, 'A participant description', encryption);
      if (p.icon !== undefined) entry['icon'] = textValue(p.icon, 'A participant icon', encryption);
      out[keyHash] = entry;
    }
    json['participants'] = out;
  }
  const metadatum = toMetadatum(json);
  const nativeScripts = [vault.payment.script, vault.stake.script];
  return Object.freeze({
    label: CIP146_LABEL,
    metadatum,
    json: Object.freeze(json),
    nativeScripts: Object.freeze(nativeScripts),
    offChain: Object.freeze({
      metadata: Serialization.GeneralTransactionMetadata.fromCore(new Map([[CIP146_LABEL, metadatum]])).toCbor(),
      native_scripts: registrationScriptsCbor([vault.payment, vault.stake]),
    }),
  });
}

// ---------------------------------------------------------------------------------------------
// Decoding untrusted registrations

export type RegistrationRefusalCode =
  | 'MALFORMED_INPUT'
  | 'TOO_LARGE'
  | 'MALFORMED_CBOR'
  | 'INVALID_METADATA'
  | 'MISSING_LABEL'
  | 'NOT_A_MAP'
  | 'UNSUPPORTED_ENCRYPTION'
  | 'TYPES_INVALID'
  | 'NO_PAYMENT_SCRIPT'
  | 'TYPES_SCRIPTS_MISMATCH'
  | 'NO_SCRIPTS'
  | 'UNKNOWN_SCRIPT_KIND'
  | 'SCRIPT_INVALID'
  | 'SCRIPT_TOO_LARGE'
  | 'DUPLICATE_SCRIPT_KEY'
  | 'NON_CANONICAL_SCRIPT'
  | 'FIELD_INVALID'
  | 'PARTICIPANT_INVALID'
  | 'PARTICIPANT_NOT_IN_SCRIPT'
  | 'TOO_MANY_PARTICIPANTS';

export interface RegistrationRefusal {
  readonly ok: false;
  readonly code: RegistrationRefusalCode;
  /** For logs and tests; never shown as is. */
  readonly detail?: string;
}

/** An optional text field: clear, or CIP-83 chunks still to decrypt. Untrusted either way. */
export type RegistrationText =
  | { readonly kind: 'clear'; readonly text: string }
  | { readonly kind: 'encrypted'; readonly chunks: readonly string[] };

export interface DecodedParticipant {
  readonly name: RegistrationText;
  readonly description?: RegistrationText;
  readonly icon?: RegistrationText;
}

export interface DecodedRegistration {
  readonly encryption: 'none' | 'basic';
  /** The scripts in `types` order, each hashed over its published bytes. */
  readonly scripts: readonly VaultScript[];
  readonly payment: VaultScript;
  readonly stake?: VaultScript;
  readonly name?: RegistrationText;
  readonly description?: RegistrationText;
  readonly icon?: RegistrationText;
  readonly participants: Readonly<Record<string, DecodedParticipant>>;
}

export type DecodeRegistrationResult = { readonly ok: true; readonly registration: DecodedRegistration } | RegistrationRefusal;

/**
 * Where the registration came from:
 * - `metadata.cbor`: the transaction's whole metadata map (`{ label => metadatum }`) as CBOR hex,
 *   as in `OffChainMultiSigRegistration.metadata`. This is the strict path: duplicate keys,
 *   indefinite lengths and non-minimal heads are refused.
 * - `metadata.json`: the value under label 1854 in the no-conversions JSON schema, as indexers
 *   serve it. A JSON parser has already merged any duplicate keys, so prefer CBOR when available.
 * - `nativeScripts.cbor`: the auxiliary data native scripts array as CBOR hex; `nativeScripts.cbors`:
 *   one CBOR hex item per script, in auxiliary data order.
 */
export interface RegistrationInput {
  readonly metadata: { readonly cbor: string } | { readonly json: unknown };
  readonly nativeScripts: { readonly cbor: string } | { readonly cbors: readonly string[] };
}

class Refusal extends Error {
  constructor(readonly code: RegistrationRefusalCode, readonly detail?: string) {
    super(code);
  }
}

const refuse = (code: RegistrationRefusalCode, detail?: string): never => {
  throw new Refusal(code, detail);
};

/** Metadata after the ledger's own rules, independent of where it was read from. */
type Meta =
  | { readonly k: 'int'; readonly v: bigint }
  | { readonly k: 'text'; readonly v: string }
  | { readonly k: 'bytes' }
  | { readonly k: 'list'; readonly v: readonly Meta[] }
  | { readonly k: 'map'; readonly v: readonly (readonly [Meta, Meta])[] };

function metaFromCbor(value: CborValue): Meta {
  switch (value.type) {
    case 'int':
      return { k: 'int', v: value.value };
    case 'bytes':
      if (value.value.length > METADATA_STRING_BYTES) refuse('INVALID_METADATA', 'byte string over 64 bytes');
      return { k: 'bytes' };
    case 'text':
      if (utf8Length(value.value) > METADATA_STRING_BYTES) refuse('INVALID_METADATA', 'text over 64 bytes');
      return { k: 'text', v: value.value };
    case 'array':
      return { k: 'list', v: value.value.map(i => metaFromCbor(i.value)) };
    case 'map':
      return { k: 'map', v: value.value.map(([a, b]) => [metaFromCbor(a.value), metaFromCbor(b.value)] as const) };
  }
}

function metaFromJson(value: unknown, depth: number, budget: { items: number }): Meta {
  if (depth > METADATA_LIMITS.maxDepth) refuse('INVALID_METADATA', 'too deep');
  if (++budget.items > METADATA_LIMITS.maxItems) refuse('TOO_LARGE', 'too many items');
  if (typeof value === 'string') {
    if (utf8Length(value) > METADATA_STRING_BYTES) refuse('INVALID_METADATA', 'text over 64 bytes');
    return { k: 'text', v: value };
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) refuse('INVALID_METADATA', 'not an integer');
    return { k: 'int', v: BigInt(value) };
  }
  if (Array.isArray(value)) return { k: 'list', v: value.map(v => metaFromJson(v, depth + 1, budget)) };
  if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return {
      k: 'map',
      v: Object.keys(value).map(key => [
        metaFromJson(key, depth + 1, budget),
        metaFromJson((value as Record<string, unknown>)[key], depth + 1, budget),
      ] as const),
    };
  }
  return refuse('INVALID_METADATA', 'not a metadatum');
}

function readHex(hex: unknown, what: string): Uint8Array {
  if (typeof hex !== 'string') refuse('MALFORMED_INPUT', `${what} is not a string`);
  if ((hex as string).length > MAX_REGISTRATION_BYTES * 2) refuse('TOO_LARGE', what);
  return hexToBytes(hex) ?? refuse('MALFORMED_INPUT', `${what} is not hex`);
}

function cbor(bytes: Uint8Array, limits: typeof METADATA_LIMITS): CborItem {
  try {
    return readCbor(bytes, limits);
  } catch (e) {
    if (e instanceof CborError) {
      return refuse(e.reason === 'TOO_MANY_ITEMS' ? 'TOO_LARGE' : 'MALFORMED_CBOR', e.reason);
    }
    throw e;
  }
}

function labelValue(input: RegistrationInput['metadata']): Meta {
  if (input && 'cbor' in input) {
    const root = cbor(readHex(input.cbor, 'metadata'), METADATA_LIMITS);
    if (root.value.type !== 'map') return refuse('INVALID_METADATA', 'metadata is not a map');
    for (const [key, value] of root.value.value) {
      if (key.value.type !== 'int' || key.value.value < 0n) refuse('INVALID_METADATA', 'metadata label');
      if (key.value.type === 'int' && key.value.value === CIP146_LABEL) return metaFromCbor(value.value);
    }
    return refuse('MISSING_LABEL');
  }
  if (input && 'json' in input) {
    if (input.json === undefined) refuse('MISSING_LABEL');
    return metaFromJson(input.json, 0, { items: 0 });
  }
  return refuse('MALFORMED_INPUT', 'metadata');
}

const asInt = (m: Meta | undefined): number | undefined =>
  m?.k === 'int' && m.v >= 0n && m.v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(m.v) : undefined;

function scriptFromCbor(item: CborItem, depth: number, keys: Set<string>): Cardano.NativeScript {
  if (depth > SCRIPT_LIMITS.maxDepth) refuse('SCRIPT_TOO_LARGE', 'too deep');
  const v = item.value;
  if (v.type !== 'array' || v.value.length < 2) return refuse('SCRIPT_INVALID', 'not a native script');
  const [kindItem, ...rest] = v.value;
  if (kindItem.value.type !== 'int') return refuse('SCRIPT_INVALID', 'kind');
  const kind = kindItem.value.value;
  const native = Cardano.ScriptType.Native;
  const children = (list: CborItem): Cardano.NativeScript[] =>
    list.value.type === 'array'
      ? list.value.value.map(c => scriptFromCbor(c, depth + 1, keys))
      : refuse('SCRIPT_INVALID', 'sub-scripts');
  const uintArg = (arg: CborItem): number =>
    asInt(arg.value.type === 'int' ? { k: 'int', v: arg.value.value } : undefined) ?? refuse('SCRIPT_INVALID', 'integer');
  switch (kind) {
    case 0n: {
      const [hash] = rest;
      if (rest.length !== 1 || hash.value.type !== 'bytes' || hash.value.value.length !== 28) {
        return refuse('SCRIPT_INVALID', 'key hash');
      }
      const keyHash = Ed25519KeyHashHex(bytesToHex(hash.value.value));
      if (keys.has(keyHash)) refuse('DUPLICATE_SCRIPT_KEY');
      keys.add(keyHash);
      if (keys.size > MAX_SCRIPT_KEYS) refuse('SCRIPT_TOO_LARGE', 'too many keys');
      return { __type: native, kind: Cardano.NativeScriptKind.RequireSignature, keyHash };
    }
    case 1n:
    case 2n:
      if (rest.length !== 1) return refuse('SCRIPT_INVALID', 'all/any');
      return {
        __type: native,
        kind: kind === 1n ? Cardano.NativeScriptKind.RequireAllOf : Cardano.NativeScriptKind.RequireAnyOf,
        scripts: children(rest[0]),
      };
    case 3n: {
      if (rest.length !== 2) return refuse('SCRIPT_INVALID', 'at least');
      const required = uintArg(rest[0]);
      const scripts = children(rest[1]);
      if (required > scripts.length) refuse('SCRIPT_INVALID', 'threshold above the number of keys');
      return { __type: native, kind: Cardano.NativeScriptKind.RequireNOf, required, scripts };
    }
    case 4n:
    case 5n:
      if (rest.length !== 1) return refuse('SCRIPT_INVALID', 'time lock');
      return kind === 4n
        ? { __type: native, kind: Cardano.NativeScriptKind.RequireTimeAfter, slot: Cardano.Slot(uintArg(rest[0])) }
        : { __type: native, kind: Cardano.NativeScriptKind.RequireTimeBefore, slot: Cardano.Slot(uintArg(rest[0])) };
    default:
      return refuse('UNKNOWN_SCRIPT_KIND', String(kind));
  }
}

function decodeScript(bytes: Uint8Array, role: Role): VaultScript {
  const item = cbor(bytes, SCRIPT_LIMITS);
  const script = scriptFromCbor(item, 0, new Set());
  const hex = bytesToHex(bytes);
  let canonical: string;
  try {
    canonical = Serialization.NativeScript.fromCore(script).toCbor();
  } catch {
    return refuse('SCRIPT_INVALID', 'not serializable');
  }
  if (canonical !== hex) refuse('NON_CANONICAL_SCRIPT');
  return vaultScript(role, script);
}

function scriptItems(input: RegistrationInput['nativeScripts']): Uint8Array[] {
  if (input && 'cbor' in input) {
    const bytes = readHex(input.cbor, 'native scripts');
    const root = cbor(bytes, SCRIPT_LIMITS);
    if (root.value.type !== 'array') return refuse('SCRIPT_INVALID', 'not an array');
    return root.value.value.map(i => bytes.subarray(i.start, i.end));
  }
  if (input && 'cbors' in input && Array.isArray(input.cbors)) {
    if (input.cbors.length > SUPPORTED_TYPES.length) refuse('TYPES_SCRIPTS_MISMATCH');
    return input.cbors.map((h, i) => readHex(h, `native script ${i}`));
  }
  return refuse('MALFORMED_INPUT', 'native scripts');
}

function entries(map: Meta): Map<string, Meta> {
  const out = new Map<string, Meta>();
  if (map.k !== 'map') return out;
  for (const [key, value] of map.v) if (key.k === 'text') out.set(key.v, value);
  return out;
}

function text(value: Meta | undefined, encrypted: boolean, what: string): RegistrationText | undefined {
  if (value === undefined) return undefined;
  if (!encrypted) {
    if (value.k !== 'text' || value.v.length === 0) refuse('FIELD_INVALID', what);
    return { kind: 'clear', text: (value as { v: string }).v };
  }
  if (value.k !== 'list' || value.v.length === 0 || value.v.length > MAX_CHUNKS) refuse('FIELD_INVALID', what);
  const chunks = (value as { v: readonly Meta[] }).v.map(c =>
    c.k === 'text' && c.v.length > 0 && c.v.length <= CIP83_CHUNK ? c.v : refuse('FIELD_INVALID', what),
  );
  return { kind: 'encrypted', chunks: Object.freeze(chunks) };
}

function decodeTypes(value: Meta | undefined): Role[] {
  if (value?.k !== 'list' || value.v.length === 0) return refuse('TYPES_INVALID', 'types is not a non-empty list');
  const types = value.v.map(asInt);
  if (types.some(t => t === undefined || !SUPPORTED_TYPES.includes(t)) || new Set(types).size !== types.length) {
    refuse('TYPES_INVALID', 'types are distinct roles 0 and 2');
  }
  if (!types.includes(ROLE.PAYMENT)) refuse('NO_PAYMENT_SCRIPT');
  return types as Role[];
}

function decodeParticipants(value: Meta | undefined, encrypted: boolean, keys: Set<string>): Record<string, DecodedParticipant> {
  const out: Record<string, DecodedParticipant> = {};
  if (value === undefined) return out;
  if (value.k !== 'map') return refuse('PARTICIPANT_INVALID', 'participants is not a map');
  if (value.v.length > MAX_PARTICIPANTS) refuse('TOO_MANY_PARTICIPANTS');
  for (const [key, details] of value.v) {
    if (key.k !== 'text' || !KEY_HASH.test(key.v)) refuse('PARTICIPANT_INVALID', 'participant key');
    const keyHash = (key as { v: string }).v;
    if (!keys.has(keyHash)) refuse('PARTICIPANT_NOT_IN_SCRIPT');
    if (details.k !== 'map') refuse('PARTICIPANT_INVALID', 'participant details');
    const fields = entries(details);
    const name = text(fields.get('name'), encrypted, 'participant name') ?? refuse('PARTICIPANT_INVALID', 'name required');
    const participant: { -readonly [K in keyof DecodedParticipant]: DecodedParticipant[K] } = { name };
    const description = text(fields.get('description'), encrypted, 'participant description');
    const icon = text(fields.get('icon'), encrypted, 'participant icon');
    if (description) participant.description = description;
    if (icon) participant.icon = icon;
    out[keyHash] = Object.freeze(participant);
  }
  return out;
}

function decode(input: RegistrationInput): DecodedRegistration {
  const root = labelValue(input?.metadata);
  if (root.k !== 'map') refuse('NOT_A_MAP');
  const fields = entries(root);
  const enc = fields.get('enc');
  if (enc !== undefined && (enc.k !== 'text' || enc.v !== 'basic')) refuse('UNSUPPORTED_ENCRYPTION');
  const encrypted = enc !== undefined;
  const types = decodeTypes(fields.get('types'));
  const items = scriptItems(input?.nativeScripts);
  if (items.length === 0) refuse('NO_SCRIPTS');
  if (items.length !== types.length) refuse('TYPES_SCRIPTS_MISMATCH');
  const scripts = items.map((bytes, i) => decodeScript(bytes, types[i]));
  const keys = new Set<string>();
  scripts.forEach(s => scriptKeyHashes(s.script, keys));
  const registration: { -readonly [K in keyof DecodedRegistration]: DecodedRegistration[K] } = {
    encryption: encrypted ? 'basic' : 'none',
    scripts: Object.freeze(scripts),
    payment: scripts.find(s => s.role === ROLE.PAYMENT),
    participants: Object.freeze(decodeParticipants(fields.get('participants'), encrypted, keys)),
  };
  const stake = scripts.find(s => s.role === ROLE.STAKE);
  if (stake) registration.stake = stake;
  for (const field of ['name', 'description', 'icon'] as const) {
    const value = text(fields.get(field), encrypted, field);
    if (value) registration[field] = value;
  }
  return Object.freeze(registration);
}

/** Decodes an untrusted registration. Never throws: a malformed one is a typed refusal. */
export function decodeRegistration(input: RegistrationInput): DecodeRegistrationResult {
  try {
    return { ok: true, registration: decode(input) };
  } catch (e) {
    if (e instanceof Refusal) return { ok: false, code: e.code, ...(e.detail ? { detail: e.detail } : {}) };
    return { ok: false, code: 'MALFORMED_INPUT', detail: 'unexpected input' };
  }
}

// ---------------------------------------------------------------------------------------------
// Decrypting the optional fields

export interface DecryptedParticipant {
  readonly name: string;
  readonly description?: string;
  readonly icon?: string;
}

export interface DecryptedFields {
  readonly name?: string;
  readonly description?: string;
  readonly icon?: string;
  readonly participants: Readonly<Record<string, DecryptedParticipant>>;
}

export type DecryptFieldsResult = { readonly ok: true; readonly fields: DecryptedFields } | { readonly ok: false; readonly code: 'DECRYPTION_FAILED' };

/**
 * The optional fields in clear. Each encrypted field is decrypted with `passphrase` (CIP-83's
 * default when omitted). A field that does not decrypt fails the whole call. The text is still
 * untrusted: it names whatever its publisher chose.
 */
export function decryptRegistrationFields(registration: DecodedRegistration, passphrase: string = CIP83_DEFAULT_PASSPHRASE): DecryptFieldsResult {
  try {
    const open = (field: RegistrationText | undefined): string | undefined => {
      if (!field) return undefined;
      if (field.kind === 'clear') return field.text;
      const clear = cip83Decrypt(field.chunks, passphrase);
      if (clear === undefined) throw new Refusal('FIELD_INVALID');
      return clear;
    };
    const participants: Record<string, DecryptedParticipant> = {};
    for (const [key, p] of Object.entries(registration.participants ?? {})) {
      const entry: { -readonly [K in keyof DecryptedParticipant]: DecryptedParticipant[K] } = { name: open(p.name) };
      const description = open(p.description);
      const icon = open(p.icon);
      if (description !== undefined) entry.description = description;
      if (icon !== undefined) entry.icon = icon;
      participants[key] = Object.freeze(entry);
    }
    const fields: { -readonly [K in keyof DecryptedFields]: DecryptedFields[K] } = { participants: Object.freeze(participants) };
    for (const field of ['name', 'description', 'icon'] as const) {
      const value = open(registration[field]);
      if (value !== undefined) fields[field] = value;
    }
    return { ok: true, fields: Object.freeze(fields) };
  } catch {
    return { ok: false, code: 'DECRYPTION_FAILED' };
  }
}

// ---------------------------------------------------------------------------------------------
// Rebuilding the vault from a registration and the participants' keys

/**
 * One participant to find in a registration:
 * - `vaultKeys`: the vault keys a Gero cosigner sent, matched by hash, no index involved;
 * - `external`: an external wallet's role keys, scanned at indexes 0 to `EXTERNAL_SCAN_MAX`;
 * - `own`: this wallet's own role keys, scanned from 0 until `DISCOVERY_GAP_LIMIT` consecutive
 *   indexes that are neither on chain nor held in its history.
 */
export type RebuildParticipant =
  | { readonly kind: 'vaultKeys'; readonly keys: VaultPublicKeys }
  | { readonly kind: 'external'; readonly roleKeys: RoleKeys }
  | {
      readonly kind: 'own';
      readonly roleKeys: RoleKeys;
      readonly history: Pick<ParticipantIndexHistory, 'onChain' | 'held'>;
    };

/** How far an external wallet's keys are scanned. */
export const EXTERNAL_SCAN_MAX = 100;

export type RebuildRefusalCode =
  | 'INVALID_OPTIONS'
  | 'STAKE_SCRIPT_MISSING'
  | 'UNKNOWN_TEMPLATE'
  | 'TEMPLATE_MISMATCH'
  | 'FOREIGN_KEY'
  | 'PARTICIPANT_NOT_IN_VAULT'
  | 'PARTICIPANT_INCOMPLETE'
  | 'ROLE_INDEX_MISMATCH'
  | 'DUPLICATE_PARTICIPANT'
  | 'OUTSIDE_POLICY'
  | 'INVALID_VAULT'
  | 'SCRIPT_MISMATCH';

export type RebuildResult =
  | {
      readonly ok: true;
      readonly vault: VaultScripts;
      /** For each owner slot in payment script order, the position of its participant in the input. */
      readonly owners: readonly number[];
      /** The same for backup slots. */
      readonly backups: readonly number[];
      /**
       * Each input participant's own vault index, where it was found (`undefined` for vault keys,
       * which carry none). Indexes may differ between participants.
       */
      readonly indexes: readonly (number | undefined)[];
      /** The key order is the one `buildVaultScripts` writes (sorted by bytes). */
      readonly canonicalOrder: boolean;
    }
  | { readonly ok: false; readonly code: RebuildRefusalCode; /** Position of the participant at fault. */ readonly participant?: number };

/** Bounds the ledger accepts but this wallet does not create (threshold 1, more than 20 owners). */
const POLICY_CODES: ReadonlySet<string> = new Set(['THRESHOLD_TOO_LOW', 'TOO_FEW_OWNERS', 'TOO_MANY_OWNERS']);

const backupsOf = (p: ParsedVaultScript): readonly Ed25519KeyHashHex[] => (p.kind === 'backup' ? p.backups : []);

function templateOf(payment: ParsedVaultScript, stake: ParsedVaultScript): VaultTemplate | undefined {
  if (payment.kind !== stake.kind || payment.threshold !== stake.threshold || payment.owners.length !== stake.owners.length) {
    return undefined;
  }
  if (payment.kind === 'standard') return { kind: 'standard', threshold: payment.threshold };
  if (stake.kind !== 'backup' || payment.backupThreshold !== stake.backupThreshold
    || payment.backupAfterSlot !== stake.backupAfterSlot || payment.backups.length !== stake.backups.length) {
    return undefined;
  }
  return {
    kind: 'backup',
    threshold: payment.threshold,
    backupThreshold: payment.backupThreshold,
    backupAfterSlot: payment.backupAfterSlot,
  };
}

type Located = { readonly keys: ParticipantKeyHashes; readonly index?: number };

/** Finds one participant's keys in the scripts; a refusal code when they are not both there. */
async function locate(
  p: RebuildParticipant,
  paymentKeys: ReadonlySet<string>,
  stakeKeys: ReadonlySet<string>,
): Promise<Located | RebuildRefusalCode> {
  if (p?.kind === 'vaultKeys') {
    const keys = await vaultKeyHashes(p.keys);
    const inPayment = paymentKeys.has(keys.payment);
    const inStake = stakeKeys.has(keys.stake);
    if (inPayment && inStake) return { keys };
    return inPayment || inStake ? 'PARTICIPANT_INCOMPLETE' : 'PARTICIPANT_NOT_IN_VAULT';
  }
  if (p?.kind !== 'external' && p?.kind !== 'own') return 'INVALID_OPTIONS';
  let quiet: (i: number) => boolean = () => false;
  if (p.kind === 'own') {
    const onChain = new Set(p.history?.onChain ?? []);
    const held = new Set((p.history?.held ?? []).map(h => h?.index));
    quiet = i => !onChain.has(i) && !held.has(i);
  }
  let paymentAt: number | undefined;
  let stakeAt: number | undefined;
  let run = 0;
  for (let i = 0; i <= MAX_VAULT_INDEX; i++) {
    if (p.kind === 'external' && i > EXTERNAL_SCAN_MAX) break;
    const [payment, stake] = await Promise.all([deriveVaultKey(p.roleKeys.payment, i), deriveVaultKey(p.roleKeys.stake, i)]);
    if (paymentAt === undefined && paymentKeys.has(payment.keyHash)) paymentAt = i;
    if (stakeAt === undefined && stakeKeys.has(stake.keyHash)) stakeAt = i;
    if (paymentAt !== undefined && stakeAt !== undefined) break;
    if (p.kind === 'own') {
      run = quiet(i) ? run + 1 : 0;
      if (run >= DISCOVERY_GAP_LIMIT) break;
    }
  }
  if (paymentAt === undefined && stakeAt === undefined) return 'PARTICIPANT_NOT_IN_VAULT';
  if (paymentAt === undefined || stakeAt === undefined) return 'PARTICIPANT_INCOMPLETE';
  if (paymentAt !== stakeAt) return 'ROLE_INDEX_MISMATCH';
  return { keys: await deriveParticipantKeyHashes(p.roleKeys, paymentAt), index: paymentAt };
}

/**
 * Rebuilds a registered vault from its participants' keys (the wallet's own among them), each
 * participant found on their own (CIP-0146 discovery): a participant's payment key must be in
 * the payment script and their stake key in the stake script, at one index of theirs, while
 * different participants may sit at different indexes. Every key hash of both scripts must belong
 * to exactly one participant, and a participant is an owner or a backup holder in both scripts.
 * The scripts are then instantiated again in the registration's key order and must hash the same.
 * Never throws.
 */
export async function rebuildFromRegistration(
  registration: DecodedRegistration,
  participants: readonly RebuildParticipant[],
): Promise<RebuildResult> {
  try {
    if (!Array.isArray(participants) || participants.length === 0) return { ok: false, code: 'INVALID_OPTIONS' };
    if (!registration?.payment) return { ok: false, code: 'UNKNOWN_TEMPLATE' };
    if (!registration.stake) return { ok: false, code: 'STAKE_SCRIPT_MISSING' };
    const payment = parseVaultScript(registration.payment.script);
    const stake = parseVaultScript(registration.stake.script);
    if (!payment || !stake) return { ok: false, code: 'UNKNOWN_TEMPLATE' };
    const template = templateOf(payment, stake);
    if (!template) return { ok: false, code: 'TEMPLATE_MISMATCH' };

    const paymentKeys = new Set<string>([...payment.owners, ...backupsOf(payment)]);
    const stakeKeys = new Set<string>([...stake.owners, ...backupsOf(stake)]);
    const located: Located[] = [];
    for (let i = 0; i < participants.length; i++) {
      const found = await locate(participants[i], paymentKeys, stakeKeys);
      if (typeof found === 'string') return { ok: false, code: found, participant: i };
      located.push(found);
    }
    return assemble(registration, payment, stake, template, located);
  } catch {
    return { ok: false, code: 'INVALID_VAULT' };
  }
}

function assemble(
  registration: DecodedRegistration,
  payment: ParsedVaultScript,
  stake: ParsedVaultScript,
  template: VaultTemplate,
  located: readonly Located[],
): RebuildResult {
  const byPayment = new Map<string, number>();
  const byStake = new Map<string, number>();
  for (let i = 0; i < located.length; i++) {
    if (byPayment.has(located[i].keys.payment) || byStake.has(located[i].keys.stake)) {
      return { ok: false, code: 'DUPLICATE_PARTICIPANT', participant: i };
    }
    byPayment.set(located[i].keys.payment, i);
    byStake.set(located[i].keys.stake, i);
  }
  const slots = (hashes: readonly string[], lookup: ReadonlyMap<string, number>) => hashes.map(h => lookup.get(h));
  const owners = slots(payment.owners, byPayment);
  const backups = slots(backupsOf(payment), byPayment);
  const stakeOwners = slots(stake.owners, byStake);
  const stakeBackups = slots(backupsOf(stake), byStake);
  if ([...owners, ...backups, ...stakeOwners, ...stakeBackups].some(i => i === undefined)) {
    return { ok: false, code: 'FOREIGN_KEY' };
  }
  const sameSet = (a: readonly number[], b: readonly number[]) =>
    a.length === b.length && [...a].sort((x, y) => x - y).join() === [...b].sort((x, y) => x - y).join();
  if (!sameSet(owners, stakeOwners) || !sameSet(backups, stakeBackups)) return { ok: false, code: 'TEMPLATE_MISMATCH' };

  const spec = { template, owners: owners.map(i => located[i].keys), backups: backups.map(i => located[i].keys) };
  // A vault someone else registered is rebuilt with its warnings, which the result carries for
  // the caller to show; the bounds still apply.
  const options = { acknowledged: vaultSpecWarnings(spec) };
  let vault: VaultScripts;
  try {
    vault = instantiateVaultScripts(spec, {
      payment: { owners: payment.owners, backups: backupsOf(payment) },
      stake: { owners: stake.owners, backups: backupsOf(stake) },
    }, options);
  } catch (e) {
    if (e instanceof GeroVaultError) {
      return { ok: false, code: POLICY_CODES.has(e.code) ? 'OUTSIDE_POLICY' : 'INVALID_VAULT' };
    }
    throw e;
  }
  if (vault.payment.hash !== registration.payment.hash || vault.stake.hash !== registration.stake.hash) {
    return { ok: false, code: 'SCRIPT_MISMATCH' };
  }
  const canonical = buildVaultScripts(spec, options);
  return {
    ok: true,
    vault,
    owners: Object.freeze(owners),
    backups: Object.freeze(backups),
    indexes: Object.freeze(located.map(l => l.index)),
    canonicalOrder: canonical.payment.hash === vault.payment.hash && canonical.stake.hash === vault.stake.hash,
  };
}

/**
 * Registrations are discovery hints: the same scripts can be registered any number of times, by
 * anyone. This keeps one registration per pair of script hashes, the first in the order given
 * (CIP-0146 discovery keeps the oldest, so pass them oldest first).
 */
export function dedupeRegistrations(registrations: readonly DecodedRegistration[]): DecodedRegistration[] {
  const seen = new Set<string>();
  const out: DecodedRegistration[] = [];
  for (const r of Array.isArray(registrations) ? registrations : []) {
    if (!r?.payment) continue;
    const key = `${r.payment.hash}|${r.stake?.hash ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}
