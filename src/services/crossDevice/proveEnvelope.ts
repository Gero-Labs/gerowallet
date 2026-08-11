// Cross-Device Proving (XDP) — Ed25519 message authentication envelope. R1.
//
// Same security-critical primitive as envelope.ts, for the proving frames. The
// subject is a pipe-joined string of explicit fields, NOT sorted-key JSON:
// Swift JSONEncoder and JS JSON.stringify diverge on number formatting, string
// escaping and whitespace, so a JSON-signed message will not verify across
// clients. Reuses the SAME device relay Ed25519 key as the signing bridge — XDP
// adds no new pairing, so the identity that signs SIGN_RESPONSE is the identity
// that signs PROVE_ACCEPT.
//
// Subjects (utf8, signed with the device relay Ed25519 key):
//   PROVE_INIT:   gero-xprove/v1|PROVE_INIT|<reqId>|<nonce>|<from>|<to>|<stakeAddress or empty>|<ephPub>|<ledgerVersion>|<byteLen>|<chunkCount>|<expiresAt>|<payloadDigest>
//   PROVE_ACCEPT: gero-xprove/v1|PROVE_ACCEPT|<reqId>|<nonce>|<from>|<to>|<ephPub>|<ledgerVersion>
//   PROVE_REJECT: gero-xprove/v1|PROVE_REJECT|<reqId>|<nonce>|<from>|<to>|<reason>
//   PROVE_STATUS: gero-xprove/v1|PROVE_STATUS|<reqId>|<nonce>|<from>|<to>|<state>
//   PROVE_RESULT: gero-xprove/v1|PROVE_RESULT|<reqId>|<nonce>|<from>|<to>|<byteLen>|<chunkCount>|<provenDigest>
//   PROVE_CANCEL: gero-xprove/v1|PROVE_CANCEL|<reqId>|<nonce>|<from>|<to>
//
// PROVE_CHUNK is NOT here: it is unsigned by design (proveProtocol.ts), bound
// instead by its AEAD AAD.
//
// Three conventions differ from gero-xdev/v1, each deliberately:
//   1. `to` is in EVERY subject (gero-xdev signs it only for PAIR_CONFIRM).
//      The frames carry ephemeral key material, so redirection must be
//      unforgeable, not merely detectable.
//   2. `reason` is SIGNED (gero-xdev leaves SignResponse.reason advisory),
//      because it drives the cloud-proving downgrade decision.
//   3. The digests are over PLAINTEXT payloads, never ciphertext — hashing
//      ciphertext would authenticate the envelope while leaving the plaintext
//      unbound, which is the only thing that actually matters here.
//
// Encodings: lowercase hex, Ed25519, blake2b-256 (32-byte), unix SECONDS as a
// decimal string. Pure module: no chrome, no WebSocket, no Date.now.

import * as ed25519 from '@noble/ed25519';
import { blake2b256Hex } from './envelope';
import { XPROVE_VERSION, bytesToHex, hexToBytes } from './proveSession';
import type {
  ProveAccept,
  ProveCancel,
  ProveInit,
  ProveReject,
  ProveResult,
  ProveStatus,
} from './proveProtocol';

export { XPROVE_VERSION };

type UnsignedInit = Omit<ProveInit, 'sig'>;
type UnsignedAccept = Omit<ProveAccept, 'sig'>;
type UnsignedReject = Omit<ProveReject, 'sig'>;
type UnsignedStatus = Omit<ProveStatus, 'sig'>;
type UnsignedResult = Omit<ProveResult, 'sig'>;
type UnsignedCancel = Omit<ProveCancel, 'sig'>;

/** Every signable XDP frame (PROVE_CHUNK is excluded — see the header). */
export type UnsignedProveMessage =
  | UnsignedInit
  | UnsignedAccept
  | UnsignedReject
  | UnsignedStatus
  | UnsignedResult
  | UnsignedCancel;

/**
 * blake2b-256 of a PLAINTEXT payload, lowercase hex. Shared with all clients.
 * Delegates to the signing bridge's implementation so the two protocols can
 * never disagree about what "blake2b-256 hex" means.
 */
export function provePayloadDigest(payload: Uint8Array): string {
  return blake2b256Hex(payload);
}

/**
 * Build the canonical pipe-joined signing subject. This exact string (utf8) is
 * what gets signed and verified, byte-for-byte identical on iOS.
 */
export function buildProveSubject(msg: UnsignedProveMessage): string {
  const head = [XPROVE_VERSION, msg.type, msg.reqId, msg.nonce, msg.from, msg.to];
  switch (msg.type) {
    case 'PROVE_INIT':
      return [
        ...head,
        msg.stakeAddress ?? '',
        msg.ephPub,
        msg.ledgerVersion,
        String(msg.byteLen),
        String(msg.chunkCount),
        String(msg.expiresAt),
        msg.payloadDigest,
      ].join('|');
    case 'PROVE_ACCEPT':
      return [...head, msg.ephPub, msg.ledgerVersion].join('|');
    case 'PROVE_REJECT':
      return [...head, msg.reason].join('|');
    case 'PROVE_STATUS':
      return [...head, msg.state].join('|');
    case 'PROVE_RESULT':
      return [...head, String(msg.byteLen), String(msg.chunkCount), msg.provenDigest].join('|');
    case 'PROVE_CANCEL':
      return head.join('|');
  }
}

/** Sign a frame (minus its `sig`), returning it with `sig` populated. */
export async function signProveMessage<T extends { sig: string }>(
  msg: Omit<T, 'sig'>,
  privKeyHex: string,
): Promise<T> {
  const subject = buildProveSubject(msg as unknown as UnsignedProveMessage);
  const sigBytes = await ed25519.signAsync(
    new TextEncoder().encode(subject),
    hexToBytes(privKeyHex),
  );
  return { ...(msg as object), sig: bytesToHex(sigBytes) } as T;
}

/**
 * Verify a frame's `sig` against a public key. Returns false (never throws) for
 * a wrong key, tampered field, or malformed signature, so callers can safely
 * drop unverified inbound frames.
 */
export async function verifyProveMessage(
  msg: { sig: string } & UnsignedProveMessage,
  pubKeyHex: string,
): Promise<boolean> {
  try {
    const subject = buildProveSubject(msg);
    return await ed25519.verifyAsync(
      hexToBytes(msg.sig),
      new TextEncoder().encode(subject),
      hexToBytes(pubKeyHex),
    );
  } catch {
    return false;
  }
}
