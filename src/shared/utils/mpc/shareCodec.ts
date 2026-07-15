import { sha256 } from '@noble/hashes/sha2.js';
import { toB64url, fromB64url } from './base64url';
import { ShareRole, ShareDecodeError } from './types';

const PREFIX = 'gmpc1';

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Encode a raw Shamir share as a versioned, checksummed, role-tagged string. */
export function encodeShare(role: ShareRole, share: Uint8Array): string {
  const checksum = sha256(share).slice(0, 4);
  const roleHex = role.toString(16).padStart(2, '0');
  return `${PREFIX}.${roleHex}.${toB64url(share)}.${toB64url(checksum)}`;
}

/** Decode + integrity-check a share string. Throws ShareDecodeError on any mismatch. */
export function decodeShare(encoded: string): { role: ShareRole; share: Uint8Array } {
  const parts = encoded.split('.');
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new ShareDecodeError('invalid share format');
  }
  const role = parseInt(parts[1], 16) as ShareRole;
  if (!(role in ShareRole)) {
    throw new ShareDecodeError('invalid share role');
  }
  let share: Uint8Array;
  let checksum: Uint8Array;
  try {
    share = fromB64url(parts[2]);
    checksum = fromB64url(parts[3]);
  } catch {
    throw new ShareDecodeError('invalid share encoding');
  }
  if (!bytesEqual(checksum, sha256(share).slice(0, 4))) {
    throw new ShareDecodeError('share checksum mismatch (corrupted or altered)');
  }
  return { role, share };
}
