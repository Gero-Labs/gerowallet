// Cross-device signing bridge — Ed25519 message authentication envelope (pure).
//
// This is the security-critical primitive: every relay message carries a `sig`
// field which is an Ed25519 signature over the CANONICAL bytes of the message
// (all fields except `sig` itself). A message is trusted only if its `sig`
// verifies against the sender's registered device public key.
//
// Canonicalization must be identical on the signer and the verifier, so it is
// defined once here and used by both. We use deterministic JSON with sorted
// keys and the `sig` field stripped.
//
// Pure module: no chrome, no WebSocket, no Date.now. Uses the async
// @noble/ed25519 API (signAsync/verifyAsync), which hashes internally with an
// async SHA-512 and therefore needs no shim.

import * as ed25519 from '@noble/ed25519';

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error(`Invalid hex string length: ${hex.length}`);
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Deterministically serialize a message (minus its `sig` field) to bytes.
 * Keys are sorted so insertion order never affects the signed payload. Both the
 * signer and verifier MUST call this so their byte views agree.
 */
export function canonicalBytes(msgWithoutSig: Record<string, unknown>): Uint8Array {
  const sortedKeys = Object.keys(msgWithoutSig)
    .filter((k) => k !== 'sig')
    .sort();
  const canonical: Record<string, unknown> = {};
  for (const k of sortedKeys) {
    canonical[k] = msgWithoutSig[k];
  }
  const json = JSON.stringify(canonical);
  return new TextEncoder().encode(json);
}

/**
 * Sign a message with an Ed25519 private key, returning the message with its
 * `sig` field populated. The signature covers the canonical bytes of every
 * field except `sig`.
 */
export async function signMessage<T extends { sig: string }>(
  msg: Omit<T, 'sig'>,
  privKeyHex: string,
): Promise<T> {
  const payload = canonicalBytes(msg as Record<string, unknown>);
  const sigBytes = await ed25519.signAsync(payload, hexToBytes(privKeyHex));
  return { ...(msg as object), sig: bytesToHex(sigBytes) } as T;
}

/**
 * Verify a message's `sig` against a public key. Returns false (never throws)
 * for a wrong key, tampered field, or malformed signature, so callers can
 * safely drop unverified inbound messages.
 */
export async function verifyMessage(
  msg: { sig: string } & Record<string, unknown>,
  pubKeyHex: string,
): Promise<boolean> {
  try {
    const payload = canonicalBytes(msg);
    return await ed25519.verifyAsync(
      hexToBytes(msg.sig),
      payload,
      hexToBytes(pubKeyHex),
    );
  } catch {
    return false;
  }
}
