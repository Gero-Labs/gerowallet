// Strike Finance v2 API — Ed25519 Auth Header Builder
// Signature message format: {METHOD}:{PATH}:{TIMESTAMP}:{NONCE}:{BODY_HASH}
// where BODY_HASH = hex(sha256(bodyString)) — always computed, even for empty body.
// Timestamp is Unix time in seconds.
// Reference: Strike API Wallet Authentication TypeScript Example

import * as ed25519 from '@noble/ed25519';
import { sha512, sha256 } from '@noble/hashes/sha2.js';
import type { StrikeAuthHeaders } from './strike-v2.types';

// Required for @noble/ed25519 — set sha512 sync implementation
ed25519.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed25519.etc.concatBytes(...m));

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

  // Body hash: sha256 of body string (always computed, even for empty string)
  const bodyStr = body || '';
  const bodyHash = bytesToHex(sha256(bodyStr));

  // Canonical message per Strike v2 spec
  const message = `${method.toUpperCase()}:${path}:${timestamp}:${nonce}:${bodyHash}`;

  const privateKeyBytes = hexToBytes(privateKeyHex);
  const messageBytes = new TextEncoder().encode(message);
  const signatureBytes = await ed25519.signAsync(messageBytes, privateKeyBytes);
  const signature = bytesToHex(signatureBytes);

  return {
    'X-API-Wallet-Public-Key': publicKeyHex,
    'X-API-Wallet-Signature': signature,
    'X-API-Wallet-Timestamp': timestamp,
    'X-API-Wallet-Nonce': nonce,
  };
}

/**
 * Generate a new Ed25519 key pair for Strike API authentication.
 * Useful for initial account setup.
 */
export async function generateStrikeKeyPair(): Promise<{ privateKeyHex: string; publicKeyHex: string }> {
  const privateKey = ed25519.utils.randomSecretKey();
  const publicKey = await ed25519.getPublicKeyAsync(privateKey);
  return {
    privateKeyHex: bytesToHex(privateKey),
    publicKeyHex: bytesToHex(publicKey),
  };
}
