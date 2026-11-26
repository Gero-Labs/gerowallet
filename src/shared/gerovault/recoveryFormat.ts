/**
 * The recovery package file (spec 6.8, GV-14): a versioned header, a key derived from the user's
 * passphrase by Argon2id, and XChaCha20-Poly1305 over the payload (`recoveryPayload.ts`). This
 * file is the envelope only; it never looks inside the payload.
 *
 * Format version 1, all integers big-endian:
 *
 *   offset  size  field
 *   0       8     magic 89 47 56 52 0d 0a 1a 0a ("\x89GVR\r\n\x1a\n")
 *   8       1     format version, 0x01
 *   9       4     Argon2id memory in KiB (65536, that is 64 MiB)
 *   13      4     Argon2id passes (3)
 *   17      4     Argon2id lanes (1)
 *   21      16    salt, random
 *   37      24    nonce, random
 *   61      16    passphrase check
 *   77      4     ciphertext length in bytes, the 16-byte tag included
 *   81      n     ciphertext, then the Poly1305 tag
 *
 * The 81 header bytes are the AEAD's associated data, so every header field is authenticated.
 * The header says nothing about the vault: not its network, not its identifier.
 *
 * The magic follows PNG's design: the high-bit first byte, CR LF, the DOS end-of-file byte and a
 * final LF catch a file damaged by a 7-bit or a text-mode transfer before any key is derived.
 *
 * Keys:
 *
 *   P      = UTF-8 of normalizeRecoveryPassphrase(passphrase)
 *   master = Argon2id v1.3 (P, salt, 64 MiB, 3 passes, 1 lane, 32-byte tag), no secret, no data
 *   key    = BLAKE2b-256 keyed by master over "gero-vault/recovery-package/v1|key"
 *   check  = BLAKE2b-128 keyed by master over "gero-vault/recovery-package/v1|check"
 *   ciphertext || tag = XChaCha20-Poly1305 (key, nonce, associated data = header, payload)
 *
 * The check tells a wrong passphrase from a damaged file. It gives an attacker nothing the tag
 * does not already give: each guess still costs one Argon2id derivation. A change to the salt or
 * the check itself reads as a wrong passphrase; any other change, as tampering. Either way the file
 * is refused.
 *
 * A version 1 reader accepts exactly Argon2id v1.3 at 64 MiB, 3 passes and 1 lane, and refuses any
 * other value before deriving: `KDF_TOO_WEAK` for less memory or fewer passes, `KDF_OUT_OF_RANGE`
 * for anything else. No version 1 file has other parameters; a change is a new format version
 * with its own exact values. The derivation runs with a 64 MiB memory cap. One lane is what
 * libsodium's `crypto_pwhash` computes, so every common implementation can open a package.
 *
 * Opening never throws and works on its own copy of the input. The checks run cheapest first, so
 * a file that is not a package, is truncated or has other parameters is refused before the
 * derivation runs.
 *
 * PROVISIONAL: the layout and the test vectors are not frozen until they are checked against the
 * other client.
 */
import { argon2idAsync } from '@noble/hashes/argon2.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { equalBytes } from '@noble/ciphers/utils.js';
import { GeroVaultError } from './errors';

export const RECOVERY_MAGIC: Uint8Array = Uint8Array.from([0x89, 0x47, 0x56, 0x52, 0x0d, 0x0a, 0x1a, 0x0a]);
export const RECOVERY_FORMAT_VERSION = 1;

export const RECOVERY_SALT_BYTES = 16;
export const RECOVERY_NONCE_BYTES = 24;
export const RECOVERY_CHECK_BYTES = 16;
export const RECOVERY_TAG_BYTES = 16;
export const RECOVERY_HEADER_BYTES = 81;
/** A whole package, header included, is at most 16 MiB. */
export const MAX_RECOVERY_FILE_BYTES = 16 * 1024 * 1024;
/** The largest payload a package can hold. */
export const MAX_RECOVERY_PAYLOAD_BYTES = MAX_RECOVERY_FILE_BYTES - RECOVERY_HEADER_BYTES - RECOVERY_TAG_BYTES;

export interface RecoveryKdfParams {
  /** Memory in KiB. */
  readonly memoryKiB: number;
  readonly passes: number;
  readonly lanes: number;
}

/** The only parameters of format version 1, written and read. */
export const RECOVERY_KDF: RecoveryKdfParams = Object.freeze({ memoryKiB: 65536, passes: 3, lanes: 1 });
/** The derivation's memory cap in bytes: exactly what 64 MiB needs. */
export const RECOVERY_KDF_MAXMEM = RECOVERY_KDF.memoryKiB * 1024;

const MASTER_BYTES = 32;
const KEY_BYTES = 32;
const KEY_TAG = new TextEncoder().encode('gero-vault/recovery-package/v1|key');
const CHECK_TAG = new TextEncoder().encode('gero-vault/recovery-package/v1|check');
const ARGON2_VERSION = 0x13;

const OFFSET = { version: 8, memory: 9, passes: 13, lanes: 17, salt: 21, nonce: 37, check: 61, length: 77 } as const;

// ---------------------------------------------------------------------------------------------
// Passphrases

/** Crockford's Base32 alphabet: digits and capitals without I, L, O and U. */
export const RECOVERY_PASSPHRASE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** A passphrase the writer accepts has at least this many code points once normalised. */
export const RECOVERY_PASSPHRASE_MIN_CODE_POINTS = 16;
const GENERATED_LENGTH = 16;

/** The Zs separators other than U+0020: U+00A0, U+1680, U+2000 to U+200A, U+202F, U+205F, U+3000. */
const OTHER_SPACES = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;
const EDGE_SPACE = /^[\u0020\u0009\u000A\u000D]+|[\u0020\u0009\u000A\u000D]+$/g;
/** The probe's step 2: fullwidth U+FF01 to U+FF5E. */
const FULLWIDTH = /[\uFF01-\uFF5E]/g;
/**
 * The probe's step 3: hyphens and dashes (U+002D, U+2010 to U+2015, U+2212, U+FE58, U+FE63), the soft
 * hyphen U+00AD, the invisible U+200B, U+200C, U+200D, U+2060 and U+FEFF, U+0020, U+0009, U+000A,
 * U+000D, U+2028, U+2029 and the other Zs separators.
 */
const PROBE_REMOVED = /[\u002D\u2010-\u2015\u2212\uFE58\uFE63\u00AD\u200B\u200C\u200D\u2060\uFEFF\u0020\u0009\u000A\u000D\u2028\u2029\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;
const ASCII_LOWER = /[a-z]/g;
/** The probe's step 5: 16 characters of the Crockford alphabet or O, I and L, uppercase ASCII only. */
const GENERATED = /^[0-9A-TV-Z]{16}$/;
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * A passphrase to offer by default: 16 characters drawn uniformly from Crockford's Base32 alphabet
 * with the platform's random generator (80 bits), shown in four groups of four, for example
 * `7KQ2-M9XD-4TRB-H8WN`. It is no word list, so it cannot be taken for seed words.
 */
export function generateRecoveryPassphrase(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(GENERATED_LENGTH));
  // 32 divides 256, so the low five bits of a uniform byte are uniform.
  const chars = Array.from(bytes, b => RECOVERY_PASSPHRASE_ALPHABET[b & 31]);
  bytes.fill(0);
  return [0, 4, 8, 12].map(i => chars.slice(i, i + 4).join('')).join('-');
}

/**
 * The one normalisation every client applies, writer and reader alike.
 *
 * First the generated-pattern probe, on the raw input before anything else:
 * 1. work on a copy;
 * 2. map the fullwidth forms U+FF01 to U+FF5E to U+0021 to U+007E;
 * 3. remove every U+002D, U+2010 to U+2015, U+2212, U+FE58, U+FE63, U+00AD, U+200B, U+200C, U+200D,
 *    U+2060, U+FEFF, U+0020, U+0009, U+000A, U+000D, U+2028, U+2029, and every other Zs separator
 *    (U+00A0, U+1680, U+2000 to U+200A, U+202F, U+205F, U+3000);
 * 4. map a to z to A to Z, and nothing else: no Unicode or locale case mapping, so U+017F (long s)
 *    and U+0131 (dotless i) stay as they are;
 * 5. the copy matches if it is exactly 16 characters, each from `0123456789ABCDEFGHJKMNPQRSTVWXYZ`
 *    or O, I or L;
 * 6. on a match, O becomes 0, and I and L become 1: that is the passphrase;
 * 7. on no match, the copy is discarded and the original goes on to the steps below.
 *
 * Then, for a passphrase that did not match: Unicode NFC; the Zs separators other than U+0020
 * become U+0020; leading and trailing U+0020, U+0009, U+000A and U+000D are trimmed.
 *
 * So a generated passphrase opens however it was copied (lowercase, without hyphens, with other
 * dashes, fullwidth, with a soft hyphen, a zero-width space or a trailing newline), and a user's own
 * passphrase that happens to match is folded the same way (`GoldenMapleTree7` becomes
 * `G01DENMAP1ETREE7`). Every other passphrase keeps its characters, hyphens and dashes included.
 */
export function normalizeRecoveryPassphrase(passphrase: string): string {
  const probe = passphrase
    .replace(FULLWIDTH, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(PROBE_REMOVED, '')
    .replace(ASCII_LOWER, c => String.fromCharCode(c.charCodeAt(0) - 0x20));
  if (GENERATED.test(probe)) return probe.replace(/O/g, '0').replace(/[IL]/g, '1');
  return passphrase.normalize('NFC').replace(OTHER_SPACES, ' ').replace(EDGE_SPACE, '');
}

/** Why the writer refuses a passphrase, or `undefined` when it accepts it. */
export function recoveryPassphraseProblem(passphrase: unknown): 'NOT_TEXT' | 'TOO_SHORT' | 'CONTROL_CHARACTER' | 'NOT_WELL_FORMED' | undefined {
  if (typeof passphrase !== 'string') return 'NOT_TEXT';
  if (LONE_SURROGATE.test(passphrase)) return 'NOT_WELL_FORMED';
  const normalised = normalizeRecoveryPassphrase(passphrase);
  if (CONTROL.test(normalised)) return 'CONTROL_CHARACTER';
  if (Array.from(normalised).length < RECOVERY_PASSPHRASE_MIN_CODE_POINTS) return 'TOO_SHORT';
  return undefined;
}

/** The KDF input for writing, or a `GeroVaultError('INVALID_PASSPHRASE')`. */
function passphraseForWriting(passphrase: unknown): Uint8Array {
  const problem = recoveryPassphraseProblem(passphrase);
  if (problem) throw new GeroVaultError('INVALID_PASSPHRASE', `The passphrase is refused: ${problem}`);
  return new TextEncoder().encode(normalizeRecoveryPassphrase(passphrase as string));
}

/** The KDF input for reading: any passphrase that is not empty once normalised. */
function passphraseForReading(passphrase: string): Uint8Array | undefined {
  const normalised = normalizeRecoveryPassphrase(passphrase);
  return normalised.length === 0 ? undefined : new TextEncoder().encode(normalised);
}

// ---------------------------------------------------------------------------------------------
// Header

export interface RecoveryHeader {
  readonly version: number;
  readonly kdf: RecoveryKdfParams;
  readonly salt: Uint8Array;
  readonly nonce: Uint8Array;
  readonly check: Uint8Array;
  readonly ciphertextLength: number;
}

export type RecoveryFileRefusalCode =
  /** The input is not readable bytes, or the passphrase is not a string. */
  | 'INVALID_INPUT'
  /** The file does not start with the magic. */
  | 'NOT_A_PACKAGE'
  /** A format version this client does not read. */
  | 'UNKNOWN_VERSION'
  /** The file ends before its header or its ciphertext does. */
  | 'TRUNCATED'
  | 'TOO_LARGE'
  /** Less memory or fewer passes than format version 1. */
  | 'KDF_TOO_WEAK'
  /** Any other parameters than format version 1's. */
  | 'KDF_OUT_OF_RANGE'
  | 'WRONG_PASSPHRASE'
  /** The passphrase is right but the header or the ciphertext was changed, or bytes follow it. */
  | 'TAMPERED';

export interface RecoveryFileRefusal {
  readonly ok: false;
  readonly code: RecoveryFileRefusalCode;
  /** For logs and tests; never shown as is. */
  readonly detail?: string;
}

export type ReadRecoveryHeaderResult = { readonly ok: true; readonly header: RecoveryHeader } | RecoveryFileRefusal;
export type OpenRecoveryFileResult =
  | { readonly ok: true; readonly header: RecoveryHeader; readonly payload: Uint8Array }
  | RecoveryFileRefusal;

/** Tests only: fixed random values, for the vectors. Not reachable from the library index. */
export interface SealOptions {
  readonly salt?: Uint8Array;
  readonly nonce?: Uint8Array;
}

function writeUint32(out: Uint8Array, offset: number, value: number): void {
  new DataView(out.buffer, out.byteOffset, out.byteLength).setUint32(offset, value, false);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false);
}

function encodeHeader(header: RecoveryHeader): Uint8Array {
  const out = new Uint8Array(RECOVERY_HEADER_BYTES);
  out.set(RECOVERY_MAGIC, 0);
  out[OFFSET.version] = header.version;
  writeUint32(out, OFFSET.memory, header.kdf.memoryKiB);
  writeUint32(out, OFFSET.passes, header.kdf.passes);
  writeUint32(out, OFFSET.lanes, header.kdf.lanes);
  out.set(header.salt, OFFSET.salt);
  out.set(header.nonce, OFFSET.nonce);
  out.set(header.check, OFFSET.check);
  writeUint32(out, OFFSET.length, header.ciphertextLength);
  return out;
}

async function deriveKeys(passphrase: Uint8Array, salt: Uint8Array): Promise<{ key: Uint8Array; check: Uint8Array }> {
  const master = await argon2idAsync(passphrase, salt, {
    m: RECOVERY_KDF.memoryKiB,
    t: RECOVERY_KDF.passes,
    p: RECOVERY_KDF.lanes,
    dkLen: MASTER_BYTES,
    version: ARGON2_VERSION,
    maxmem: RECOVERY_KDF_MAXMEM,
  });
  try {
    return {
      key: blake2b(KEY_TAG, { key: master, dkLen: KEY_BYTES }),
      check: blake2b(CHECK_TAG, { key: master, dkLen: RECOVERY_CHECK_BYTES }),
    };
  } finally {
    master.fill(0);
  }
}

function randomOrGiven(given: Uint8Array | undefined, length: number, what: string): Uint8Array {
  if (given === undefined) return crypto.getRandomValues(new Uint8Array(length));
  if (!(given instanceof Uint8Array) || given.length !== length) {
    throw new GeroVaultError('INVALID_PACKAGE', `A recovery package ${what} is ${length} bytes`);
  }
  return Uint8Array.from(given);
}

/**
 * Encrypts a payload into a format version 1 file. Throws `GeroVaultError`: `INVALID_PASSPHRASE`
 * for a passphrase the writer refuses, `INVALID_PACKAGE` for a payload over the size bound.
 * `exportRecoveryPackage` is the call to use: it also checks the contents and that the file opens.
 * `options` is for test vectors only; the library index does not export this function.
 */
export async function sealRecoveryFile(payload: Uint8Array, passphrase: string, options: SealOptions = {}): Promise<Uint8Array> {
  const secret = passphraseForWriting(passphrase);
  if (!(payload instanceof Uint8Array)) throw new GeroVaultError('INVALID_PACKAGE', 'The payload is bytes');
  if (payload.length > MAX_RECOVERY_PAYLOAD_BYTES) throw new GeroVaultError('INVALID_PACKAGE', 'The package is over the size bound');
  const ciphertextLength = payload.length + RECOVERY_TAG_BYTES;
  const salt = randomOrGiven(options.salt, RECOVERY_SALT_BYTES, 'salt');
  const nonce = randomOrGiven(options.nonce, RECOVERY_NONCE_BYTES, 'nonce');
  const { key, check } = await deriveKeys(secret, salt).finally(() => secret.fill(0));
  try {
    const header = encodeHeader({ version: RECOVERY_FORMAT_VERSION, kdf: RECOVERY_KDF, salt, nonce, check, ciphertextLength });
    const ciphertext = xchacha20poly1305(key, nonce, header).encrypt(payload);
    const out = new Uint8Array(RECOVERY_HEADER_BYTES + ciphertext.length);
    out.set(header, 0);
    out.set(ciphertext, RECOVERY_HEADER_BYTES);
    return out;
  } finally {
    key.fill(0);
  }
}

const refuse = (code: RecoveryFileRefusalCode, detail?: string): RecoveryFileRefusal =>
  Object.freeze({ ok: false, code, ...(detail ? { detail } : {}) });

function kdfRefusal(kdf: RecoveryKdfParams): RecoveryFileRefusal | undefined {
  if (kdf.memoryKiB < RECOVERY_KDF.memoryKiB || kdf.passes < RECOVERY_KDF.passes) {
    return refuse('KDF_TOO_WEAK', `memory ${kdf.memoryKiB} KiB, ${kdf.passes} passes`);
  }
  if (kdf.memoryKiB !== RECOVERY_KDF.memoryKiB || kdf.passes !== RECOVERY_KDF.passes || kdf.lanes !== RECOVERY_KDF.lanes) {
    return refuse('KDF_OUT_OF_RANGE', `memory ${kdf.memoryKiB} KiB, ${kdf.passes} passes, ${kdf.lanes} lanes`);
  }
  return undefined;
}

/**
 * A private copy of the input, so that nothing the caller does to its buffer later reaches a
 * result, and so that a Proxy or a forged typed array is refused rather than thrown on.
 */
function ownCopy(file: unknown): Uint8Array | RecoveryFileRefusal {
  try {
    if (!(file instanceof Uint8Array)) return refuse('INVALID_INPUT', 'not bytes');
    if (file.length > MAX_RECOVERY_FILE_BYTES) return refuse('TOO_LARGE');
    return new Uint8Array(file);
  } catch {
    return refuse('INVALID_INPUT', 'not readable bytes');
  }
}

function parseHeader(file: Uint8Array): ReadRecoveryHeaderResult {
  if (file.length === 0) return refuse('NOT_A_PACKAGE', 'empty');
  const magicSeen = Math.min(file.length, RECOVERY_MAGIC.length);
  if (!RECOVERY_MAGIC.subarray(0, magicSeen).every((b, i) => file[i] === b)) return refuse('NOT_A_PACKAGE');
  if (file.length <= OFFSET.version) return refuse('TRUNCATED', 'no version');
  const version = file[OFFSET.version];
  if (version !== RECOVERY_FORMAT_VERSION) return refuse('UNKNOWN_VERSION', String(version));
  if (file.length < RECOVERY_HEADER_BYTES) return refuse('TRUNCATED', 'header');
  const kdf = {
    memoryKiB: readUint32(file, OFFSET.memory),
    passes: readUint32(file, OFFSET.passes),
    lanes: readUint32(file, OFFSET.lanes),
  };
  const other = kdfRefusal(kdf);
  if (other) return other;
  const ciphertextLength = readUint32(file, OFFSET.length);
  if (ciphertextLength < RECOVERY_TAG_BYTES) return refuse('TAMPERED', 'ciphertext length');
  if (RECOVERY_HEADER_BYTES + ciphertextLength > MAX_RECOVERY_FILE_BYTES) return refuse('TOO_LARGE');
  const expected = RECOVERY_HEADER_BYTES + ciphertextLength;
  if (file.length < expected) return refuse('TRUNCATED', 'ciphertext');
  if (file.length > expected) return refuse('TAMPERED', 'trailing bytes');
  return {
    ok: true,
    header: Object.freeze({
      version,
      kdf: Object.freeze(kdf),
      salt: file.slice(OFFSET.salt, OFFSET.salt + RECOVERY_SALT_BYTES),
      nonce: file.slice(OFFSET.nonce, OFFSET.nonce + RECOVERY_NONCE_BYTES),
      check: file.slice(OFFSET.check, OFFSET.check + RECOVERY_CHECK_BYTES),
      ciphertextLength,
    }),
  };
}

/**
 * Reads and checks the header without the passphrase: whether the bytes are a package this client
 * reads, whole, with format version 1's parameters. Never throws.
 */
export function readRecoveryHeader(file: unknown): ReadRecoveryHeaderResult {
  const bytes = ownCopy(file);
  return bytes instanceof Uint8Array ? parseHeader(bytes) : bytes;
}

/**
 * Opens a package file with the passphrase and returns the payload bytes, authenticated but not
 * yet decoded (`openRecoveryPackage` decodes them). Accepts any passphrase that is not empty once
 * normalised, so an old package is never stranded by a later writer rule. Never throws and never
 * changes `file`.
 */
export async function openRecoveryFile(file: unknown, passphrase: unknown): Promise<OpenRecoveryFileResult> {
  if (typeof passphrase !== 'string') return refuse('INVALID_INPUT', 'passphrase');
  const bytes = ownCopy(file);
  if (!(bytes instanceof Uint8Array)) return bytes;
  const read = parseHeader(bytes);
  if (read.ok !== true) return read;
  const secret = passphraseForReading(passphrase);
  // No package was ever sealed under an empty passphrase, so there is no key to try.
  if (!secret) return refuse('WRONG_PASSPHRASE');
  let derived: { key: Uint8Array; check: Uint8Array };
  try {
    derived = await deriveKeys(secret, read.header.salt);
  } catch {
    return refuse('KDF_OUT_OF_RANGE', 'derivation failed');
  } finally {
    secret.fill(0);
  }
  try {
    if (!equalBytes(derived.check, read.header.check)) return refuse('WRONG_PASSPHRASE');
    let payload: Uint8Array;
    try {
      payload = xchacha20poly1305(derived.key, read.header.nonce, bytes.subarray(0, RECOVERY_HEADER_BYTES))
        .decrypt(bytes.subarray(RECOVERY_HEADER_BYTES));
    } catch {
      return refuse('TAMPERED', 'authentication failed');
    }
    return { ok: true, header: read.header, payload };
  } finally {
    derived.key.fill(0);
  }
}
