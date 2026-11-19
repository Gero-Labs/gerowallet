// What a dApp may ask the wallet to sign through Wallet Standard `solana:signMessage`, and how
// the approval screen shows it. Pure: the worker checks the bytes before it opens a prompt and
// again before it signs.
//
// The danger is a message that is really a transaction. An ed25519 signature over a serialized
// transaction message is a valid signature of that transaction, so a dApp could pass one as a
// "message" and submit it with the signature it gets back. Anything that parses as a Solana
// transaction message (legacy or versioned) or a whole serialized transaction is refused.

/** Larger messages are refused: a login or proof text is far smaller. */
export const SOLANA_SIGN_MESSAGE_MAX_BYTES = 8 * 1024;

export type SolanaSignMessageRefusal = 'EMPTY' | 'TOO_LARGE' | 'LOOKS_LIKE_TRANSACTION';

const PUBKEY = 32;
const SIGNATURE = 64;

/** Reads a compact-u16 (shortvec) at `at`; null when malformed or past the end. */
function readShortVec(bytes: Uint8Array, at: number): { value: number; next: number } | null {
  let value = 0;
  for (let i = 0; i < 3; i++) {
    if (at + i >= bytes.length) return null;
    const byte = bytes[at + i];
    value |= (byte & 0x7f) << (7 * i);
    if ((byte & 0x80) === 0) return { value, next: at + i + 1 };
  }
  return null;
}

/** Skips a shortvec-prefixed array of `itemSize`-byte items; null when it runs past the end. */
function skipArray(bytes: Uint8Array, at: number, itemSize: number): number | null {
  const len = readShortVec(bytes, at);
  if (!len) return null;
  const end = len.next + len.value * itemSize;
  return end <= bytes.length ? end : null;
}

/**
 * Whether `bytes` from `start` parse, to the last byte, as a Solana transaction message:
 * an optional version prefix (0x80 | version, version 0 only), the 3-byte header with at
 * least one required signature, the account keys, a 32-byte blockhash, the instructions and,
 * for v0, the address table lookups.
 */
function parsesAsMessage(bytes: Uint8Array, start: number): boolean {
  let at = start;
  let versioned = false;
  if (at >= bytes.length) return false;
  if (bytes[at] & 0x80) {
    if ((bytes[at] & 0x7f) !== 0) return false;
    versioned = true;
    at += 1;
  }
  if (at + 3 > bytes.length) return false;
  const requiredSignatures = bytes[at];
  if (requiredSignatures < 1) return false;
  at += 3;
  const keys = readShortVec(bytes, at);
  if (!keys || keys.value < requiredSignatures) return false;
  at = keys.next + keys.value * PUBKEY;
  at += PUBKEY; // recent blockhash
  if (at > bytes.length) return false;
  const instructions = readShortVec(bytes, at);
  if (!instructions) return false;
  at = instructions.next;
  for (let i = 0; i < instructions.value; i++) {
    at += 1; // program id index
    const accounts = skipArray(bytes, at, 1);
    if (accounts === null) return false;
    const data = skipArray(bytes, accounts, 1);
    if (data === null) return false;
    at = data;
  }
  if (versioned) {
    const lookups = readShortVec(bytes, at);
    if (!lookups) return false;
    at = lookups.next;
    for (let i = 0; i < lookups.value; i++) {
      at += PUBKEY;
      const writable = skipArray(bytes, at, 1);
      if (writable === null) return false;
      const readonly = skipArray(bytes, writable, 1);
      if (readonly === null) return false;
      at = readonly;
    }
  }
  return at === bytes.length;
}

/** A transaction message, or a whole serialized transaction (signatures, then its message). */
export function looksLikeSolanaTransaction(bytes: Uint8Array): boolean {
  if (parsesAsMessage(bytes, 0)) return true;
  const signatures = readShortVec(bytes, 0);
  if (!signatures || signatures.value < 1) return false;
  const messageStart = signatures.next + signatures.value * SIGNATURE;
  return messageStart < bytes.length && parsesAsMessage(bytes, messageStart);
}

/** Why the wallet will not sign these bytes as a message, or null when it may ask the user. */
export function solanaSignMessageRefusal(bytes: Uint8Array): SolanaSignMessageRefusal | null {
  if (!bytes.length) return 'EMPTY';
  if (bytes.length > SOLANA_SIGN_MESSAGE_MAX_BYTES) return 'TOO_LARGE';
  if (looksLikeSolanaTransaction(bytes)) return 'LOOKS_LIKE_TRANSACTION';
  return null;
}

// Tab, line feed and carriage return are text; other control characters are not.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** How the approval screen shows the message: its text when it is readable UTF-8, else hex. */
export function describeSolanaMessage(bytes: Uint8Array): { kind: 'text'; text: string } | { kind: 'hex'; hex: string } {
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
    if (!CONTROL.test(text)) return { kind: 'text', text };
  } catch {
    // not UTF-8: shown as hex
  }
  return { kind: 'hex', hex: Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('') };
}
