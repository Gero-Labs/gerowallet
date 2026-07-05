// Cross-device signing — QR pairing payload (pure wire contract).
//
// The desktop renders this as a QR in Remote Signing settings; the phone scans
// it, verifies the embedded wallet-control proof OUT OF BAND (the pubKey + nonce
// are read straight off the glass, so a malicious relay cannot substitute them),
// pins the desktop, then replies with a signed PAIR_CONFIRM echoing the nonce.
//
// Versioned by the `v` tag (independent of the frame signing-subject version in
// envelope.ts): a scanner MUST reject an unknown `v`. Pure: no chrome, no
// Date.now, no randomness — assembly of live values happens in the background.

import type { DeviceRegisterProof } from './protocol';

/** QR payload schema version. Bump on any breaking field change; scanners reject unknown. */
export const PAIRING_QR_VERSION = 'gero-xdev-pair/v1';

export interface PairingQrPayload {
  v: typeof PAIRING_QR_VERSION;
  deviceId: string; // the desktop's relay-auth deviceId (sha256(pubKey)[0:16])
  pubKey: string; // the desktop's relay-auth Ed25519 pubkey (hex) — OUT-OF-BAND load-bearing
  stake: string; // the desktop wallet's reward address (bech32)
  proof: DeviceRegisterProof; // desktop wallet-control proof; phone verifies vs its OWN stake
  nonce: string; // single-use nonce (hex), minted per render — OUT-OF-BAND load-bearing
  exp: number; // unix seconds; the phone rejects a stale QR
}

/** Assemble a payload from live values + a freshly minted (nonce, exp). */
export function buildPairingQrPayload(args: {
  deviceId: string;
  pubKey: string;
  stake: string;
  proof: DeviceRegisterProof;
  nonce: string;
  exp: number;
}): PairingQrPayload {
  return { v: PAIRING_QR_VERSION, ...args };
}

/**
 * Compact wire encoding for the QR (JSON). iOS parses the same string. Kept as a
 * single function so a future size-driven change (e.g. base64url(deflate(...)) if
 * the proof pushes past QR capacity at error-correction level M) stays in one place
 * and is mirrored on iOS by swapping only this encode/decode pair.
 */
export function encodePairingQr(p: PairingQrPayload): string {
  return JSON.stringify(p);
}

export function isPairingQrPayload(x: unknown): x is PairingQrPayload {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  const proof = o['proof'];
  if (!proof || typeof proof !== 'object') return false;
  const p = proof as Record<string, unknown>;
  return (
    o['v'] === PAIRING_QR_VERSION &&
    typeof o['deviceId'] === 'string' &&
    typeof o['pubKey'] === 'string' &&
    typeof o['stake'] === 'string' &&
    typeof o['nonce'] === 'string' &&
    typeof o['exp'] === 'number' &&
    Number.isFinite(o['exp']) &&
    typeof p['coseSign1'] === 'string' &&
    typeof p['coseKey'] === 'string' &&
    typeof p['stakeAddress'] === 'string'
  );
}

/** Parse an untrusted scanned string; null on bad JSON / wrong version / bad shape. */
export function parsePairingQr(raw: string): PairingQrPayload | null {
  try {
    const v: unknown = JSON.parse(raw);
    return isPairingQrPayload(v) ? v : null;
  } catch {
    return null;
  }
}
