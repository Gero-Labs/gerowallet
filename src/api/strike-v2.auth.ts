// Strike Finance v2 API — Ed25519 Auth Header Builder
// Signature message format: {METHOD}:{PATH}:{TIMESTAMP}:{NONCE}:{BODY_HASH}
// where BODY_HASH = hex(blake2b-256(body)) for POST/DELETE with body, empty string otherwise.
// Timestamp is Unix time in seconds.

import { ed25519 } from '@noble/curves/ed25519';
import type { StrikeAuthHeaders } from './strike-v2.types';

// ---------------------------------------------------------------------------
// Hex utilities
// ---------------------------------------------------------------------------

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error(`Invalid hex string length: ${hex.length}`);
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Blake2b-256 body hash (lazy-loaded — WASM module)
// ---------------------------------------------------------------------------

async function computeBodyHash(body: string): Promise<string> {
  if (!body) return '';
  const blake2b = (await import('blake2b')).default;
  const bodyBytes = new TextEncoder().encode(body);
  const hash: Uint8Array = blake2b(32).update(bodyBytes).digest() as Uint8Array;
  return bytesToHex(hash);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build Strike v2 authentication headers for a single request.
 *
 * Signature message: {METHOD}:{PATH}:{TIMESTAMP}:{NONCE}:{BODY_HASH}
 *
 * @param method        HTTP method in uppercase, e.g. "GET", "POST", "DELETE"
 * @param path          Request path including leading slash, e.g. "/v2/order"
 * @param body          Serialised request body string (pass "" for GET / no-body requests)
 * @param privateKeyHex Ed25519 private key as a 64-char hex string (32 bytes)
 * @param publicKeyHex  Ed25519 public key as a 64-char hex string (32 bytes)
 */
export async function buildStrikeAuthHeaders(
  method: string,
  path: string,
  body: string,
  privateKeyHex: string,
  publicKeyHex: string,
): Promise<StrikeAuthHeaders> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID();
  const bodyHash = await computeBodyHash(body);

  // Canonical message per Strike v2 spec
  const message = `${method.toUpperCase()}:${path}:${timestamp}:${nonce}:${bodyHash}`;

  const privateKeyBytes = hexToBytes(privateKeyHex);
  const messageBytes = new TextEncoder().encode(message);
  const signatureBytes = ed25519.sign(messageBytes, privateKeyBytes);
  const signature = bytesToHex(signatureBytes);

  return {
    'X-API-Wallet-Public-Key': publicKeyHex,
    'X-API-Wallet-Signature': signature,
    'X-API-Wallet-Timestamp': timestamp,
    'X-API-Wallet-Nonce': nonce,
  };
}
