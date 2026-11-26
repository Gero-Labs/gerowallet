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
 *   P      = UTF-8 of the passphrase in Unicode NFC (RFC 8265 OpaqueString normalisation)
 *   master = Argon2id v1.3 (P, salt, memory, passes, lanes, 32-byte tag), no secret, no data
 *   key    = BLAKE2b-256 keyed by master over "gero-vault/recovery-package/v1|key"
 *   check  = BLAKE2b-128 keyed by master over "gero-vault/recovery-package/v1|check"
 *   ciphertext || tag = XChaCha20-Poly1305 (key, nonce, associated data = header, payload)
 *
 * The check tells a wrong passphrase from a damaged file. It gives an attacker nothing the tag
 * does not already give: each guess still costs one Argon2id derivation. A change to the salt, the
 * parameters or the check itself reads as a wrong passphrase; any other change, as tampering.
 * Either way the file is refused.
 *
 * The parameters are those of RFC 9106's second recommended option (64 MiB, 3 passes) with one
 * lane, which every common Argon2id implementation computes, libsodium's `crypto_pwhash`
 * included. A writer of this version always writes them. A reader refuses anything weaker, so a
 * crafted file cannot downgrade the derivation, and anything costlier than a bound, so a crafted
 * file cannot make a restore allocate gigabytes.
 *
 * Opening never throws. The checks run cheapest first, so a file that is not a package, is
 * truncated or has a weak header is refused before the derivation runs.
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

export interface RecoveryKdfParams {
  /** Memory in KiB. */
  readonly memoryKiB: number;
  readonly passes: number;
  readonly lanes: number;
}

/** What a writer of format version 1 always writes. */
export const RECOVERY_KDF: RecoveryKdfParams = Object.freeze({ memoryKiB: 65536, passes: 3, lanes: 1 });
/** The weakest parameters a reader accepts. */
export const RECOVERY_KDF_MIN: RecoveryKdfParams = RECOVERY_KDF;
/** The costliest parameters a reader accepts (256 MiB, 10 passes, one lane). */
export const RECOVERY_KDF_MAX: RecoveryKdfParams = Object.freeze({ memoryKiB: 262144, passes: 10, lanes: 1 });

const MASTER_BYTES = 32;
const KEY_BYTES = 32;
const KEY_TAG = new TextEncoder().encode('gero-vault/recovery-package/v1|key');
const CHECK_TAG = new TextEncoder().encode('gero-vault/recovery-package/v1|check');
const ARGON2_VERSION = 0x13;

const OFFSET = { version: 8, memory: 9, passes: 13, lanes: 17, salt: 21, nonce: 37, check: 61, length: 77 } as const;

export interface RecoveryHeader {
  readonly version: number;
  readonly kdf: RecoveryKdfParams;
  readonly salt: Uint8Array;
  readonly nonce: Uint8Array;
  readonly check: Uint8Array;
  readonly ciphertextLength: number;
}

export type RecoveryFileRefusalCode =
  /** The input is not bytes, or the passphrase is not a string. */
  | 'INVALID_INPUT'
  /** The file does not start with the magic. */
  | 'NOT_A_PACKAGE'
  /** A format version this client does not read. */
  | 'UNKNOWN_VERSION'
  /** The file ends before its header or its ciphertext does. */
  | 'TRUNCATED'
  | 'TOO_LARGE'
  /** Key derivation parameters below the format's minimum. */
  | 'KDF_TOO_WEAK'
  /** Key derivation parameters above the format's bounds, or lanes other than one. */
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

/** Tests only: fixed random values, for the vectors. */
export interface SealOptions {
  readonly salt?: Uint8Array;
  readonly nonce?: Uint8Array;
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * The passphrase bytes: UTF-8 of its NFC form. `undefined` for anything that cannot be a
 * passphrase: not a string, empty, or not well-formed Unicode (a lone surrogate would be replaced
 * on encoding, so two different strings would give one key).
 */
export function recoveryPassphraseBytes(passphrase: unknown): Uint8Array | undefined {
  if (typeof passphrase !== 'string' || LONE_SURROGATE.test(passphrase)) return undefined;
  const normalised = passphrase.normalize('NFC');
  return normalised.length === 0 ? undefined : new TextEncoder().encode(normalised);
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

async function deriveKeys(passphrase: Uint8Array, salt: Uint8Array, kdf: RecoveryKdfParams): Promise<{ key: Uint8Array; check: Uint8Array }> {
  const master = await argon2idAsync(passphrase, salt, {
    m: kdf.memoryKiB,
    t: kdf.passes,
    p: kdf.lanes,
    dkLen: MASTER_BYTES,
    version: ARGON2_VERSION,
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
 * Encrypts a payload into a format version 1 file. Throws `GeroVaultError` for a passphrase that
 * cannot be one (`INVALID_PASSPHRASE`) or a payload over the size bound (`INVALID_PACKAGE`).
 * `exportRecoveryPackage` is the call to use: it also checks the file opens.
 */
export async function sealRecoveryFile(payload: Uint8Array, passphrase: string, options: SealOptions = {}): Promise<Uint8Array> {
  const secret = recoveryPassphraseBytes(passphrase);
  if (!secret) throw new GeroVaultError('INVALID_PASSPHRASE', 'A passphrase is a non-empty, well-formed string');
  if (!(payload instanceof Uint8Array)) throw new GeroVaultError('INVALID_PACKAGE', 'The payload is bytes');
  const ciphertextLength = payload.length + RECOVERY_TAG_BYTES;
  if (RECOVERY_HEADER_BYTES + ciphertextLength > MAX_RECOVERY_FILE_BYTES) {
    throw new GeroVaultError('INVALID_PACKAGE', 'The package is over the size bound');
  }
  const salt = randomOrGiven(options.salt, RECOVERY_SALT_BYTES, 'salt');
  const nonce = randomOrGiven(options.nonce, RECOVERY_NONCE_BYTES, 'nonce');
  const { key, check } = await deriveKeys(secret, salt, RECOVERY_KDF).finally(() => secret.fill(0));
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
  if (kdf.memoryKiB < RECOVERY_KDF_MIN.memoryKiB || kdf.passes < RECOVERY_KDF_MIN.passes) {
    return refuse('KDF_TOO_WEAK', `memory ${kdf.memoryKiB} KiB, ${kdf.passes} passes`);
  }
  if (kdf.memoryKiB > RECOVERY_KDF_MAX.memoryKiB || kdf.passes > RECOVERY_KDF_MAX.passes
    || kdf.lanes < RECOVERY_KDF_MIN.lanes || kdf.lanes > RECOVERY_KDF_MAX.lanes) {
    return refuse('KDF_OUT_OF_RANGE', `memory ${kdf.memoryKiB} KiB, ${kdf.passes} passes, ${kdf.lanes} lanes`);
  }
  return undefined;
}

/**
 * Reads and checks the header without the passphrase: whether the bytes are a package this client
 * reads, whole, with acceptable parameters. Never throws.
 */
export function readRecoveryHeader(file: unknown): ReadRecoveryHeaderResult {
  if (!(file instanceof Uint8Array)) return refuse('INVALID_INPUT', 'not bytes');
  if (file.length === 0) return refuse('NOT_A_PACKAGE', 'empty');
  const magicSeen = Math.min(file.length, RECOVERY_MAGIC.length);
  if (!RECOVERY_MAGIC.subarray(0, magicSeen).every((b, i) => file[i] === b)) return refuse('NOT_A_PACKAGE');
  if (file.length <= OFFSET.version) return refuse('TRUNCATED', 'no version');
  const version = file[OFFSET.version];
  if (version !== RECOVERY_FORMAT_VERSION) return refuse('UNKNOWN_VERSION', String(version));
  if (file.length < RECOVERY_HEADER_BYTES) return refuse('TRUNCATED', 'header');
  if (file.length > MAX_RECOVERY_FILE_BYTES) return refuse('TOO_LARGE');
  const kdf = {
    memoryKiB: readUint32(file, OFFSET.memory),
    passes: readUint32(file, OFFSET.passes),
    lanes: readUint32(file, OFFSET.lanes),
  };
  const weak = kdfRefusal(kdf);
  if (weak) return weak;
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
 * Opens a package file with the passphrase and returns the payload bytes, authenticated but not
 * yet decoded (`openRecoveryPackage` decodes them). Never throws and never changes `file`.
 */
export async function openRecoveryFile(file: unknown, passphrase: unknown): Promise<OpenRecoveryFileResult> {
  if (typeof passphrase !== 'string') return refuse('INVALID_INPUT', 'passphrase');
  const read = readRecoveryHeader(file);
  if (read.ok !== true) return read;
  const bytes = file as Uint8Array;
  // No package was ever sealed under such a passphrase, so there is no key to try.
  const secret = recoveryPassphraseBytes(passphrase);
  if (!secret) return refuse('WRONG_PASSPHRASE');
  let derived: { key: Uint8Array; check: Uint8Array };
  try {
    derived = await deriveKeys(secret, read.header.salt, read.header.kdf);
  } catch {
    return refuse('KDF_OUT_OF_RANGE', 'derivation failed');
  } finally {
    secret.fill(0);
  }
  try {
    if (!equalBytes(derived.check, read.header.check)) return refuse('WRONG_PASSPHRASE');
    const header = bytes.slice(0, RECOVERY_HEADER_BYTES);
    const ciphertext = bytes.slice(RECOVERY_HEADER_BYTES);
    let payload: Uint8Array;
    try {
      payload = xchacha20poly1305(derived.key, read.header.nonce, header).decrypt(ciphertext);
    } catch {
      return refuse('TAMPERED', 'authentication failed');
    }
    return { ok: true, header: read.header, payload };
  } finally {
    derived.key.fill(0);
  }
}
