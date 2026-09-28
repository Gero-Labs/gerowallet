// Cross-device signing bridge — session-bound DEVICE_REGISTER (pure).
//
// Relay contract §5 (Track A): the relay binds every DEVICE_REGISTER to the socket
// session and to the device's relay key. After each SUBSCRIBE it sends a
// DEVICE_CHALLENGE; the frame echoes that challenge and carries `sessionSig`, an
// Ed25519 signature by the relay key over the subject below. The wallet-control
// proof (registerProof.ts) is signed by the STAKE key over a `…|DEVICE_REGISTER|…`
// subject, so the two signatures cannot be confused.
//
//   gero-xdev/v1|DEVICE_REGISTER_SESSION|<challenge>|<deviceId>|<network>|<stakeAddress>
//
// `network` and `stakeAddress` are copied byte for byte from the challenge. Noble
// Ed25519 is deterministic, so the §5.8 vector pins subject AND signature exactly.
//
// This module also holds the two pure decisions that sit around the frame: how to
// read the relay's DEVICE_REGISTER_ACK (§5.5, explicit-value rule) and whether a
// wallet with remote signing on still needs a proof (handover A1).
//
// Pure: no chrome, no WebSocket, no Date.now.

import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import type { DeviceChallenge, DeviceRegisterAck } from './protocol';
import { CROSS_DEVICE_SUBJECT_VERSION } from './envelope';

// Same wiring as deviceIdentity.ts: noble v3's synchronous API needs a sha512.
// Repeated here so this module is usable on its own (tests import it directly).
if (!ed25519.hashes.sha512) {
  ed25519.hashes.sha512 = sha512;
}

/** Type token of the session subject. Used by no other gero-xdev/v1 subject (§5.3). */
export const DEVICE_REGISTER_SESSION_TYPE = 'DEVICE_REGISTER_SESSION';

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error(`Invalid hex string length: ${hex.length}`);
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** The exact UTF-8 string the relay key signs (§5.3). */
export function buildSessionSubject(
  challenge: string,
  deviceId: string,
  network: string,
  stakeAddress: string,
): string {
  return [CROSS_DEVICE_SUBJECT_VERSION, DEVICE_REGISTER_SESSION_TYPE, challenge, deviceId, network, stakeAddress].join('|');
}

/**
 * Sign the session subject with this device's relay key. Synchronous (noble's
 * fast path) so a register() call puts its frame on the wire before any later
 * event can run — the challenge dedupe in registrationSession.ts relies on that.
 */
export function signDeviceRegisterSession(
  challenge: DeviceChallenge,
  deviceId: string,
  privKeyHex: string,
): string {
  const subject = buildSessionSubject(challenge.challenge, deviceId, challenge.network, challenge.stakeAddress);
  return bytesToHex(ed25519.sign(new TextEncoder().encode(subject), hexToBytes(privKeyHex)));
}

/**
 * The wire network id (§1.3) of a wallet: the extension's `Network` value
 * ('Mainnet' | 'Preprod' | 'Preview') becomes 'cardano-mainnet' etc. Compared
 * byte for byte with DEVICE_CHALLENGE.network.
 */
export function wireNetworkOf(network: string): string {
  return `cardano-${network.toLowerCase()}`;
}

/** Which wallet a challenge must name for this client to sign it (§5.2 client rule). */
export interface XdevWallet {
  stakeAddress: string;
  network: string; // wire network id, from wireNetworkOf
}

export function challengeMatchesWallet(ch: DeviceChallenge, wallet: XdevWallet | null): boolean {
  return !!wallet && ch.stakeAddress === wallet.stakeAddress && ch.network === wallet.network;
}

/**
 * A key-hash reward address the wallet-control proof can be produced for (A2):
 * mainnet `stake1…` or testnet `stake_test1…`. Enterprise / BTC / Midnight
 * wallets have none. verifyDeviceRegisterProof is already network-agnostic.
 */
export function isProofEligibleStakeAddress(stakeAddress: string | null | undefined): boolean {
  return typeof stakeAddress === 'string' && /^stake(_test)?1[a-z0-9]+$/.test(stakeAddress);
}

/**
 * Handover A1: remote signing is on but no proof would ride the DEVICE_REGISTER.
 * Either none was ever cached (enabled before proofs existed, storage cleared,
 * identity regenerated) or the relay explicitly rejected the one we sent
 * (`proofRejected`, from a §5.5 ack). Wallets that cannot produce a proof at all
 * never "need" one — nothing the user does would help.
 */
export function computeNeedsProof(input: {
  enabled: boolean;
  hasProof: boolean;
  proofRejected?: boolean;
  isCardano: boolean;
  stakeAddress: string | null | undefined;
}): boolean {
  if (!input.enabled) return false;
  if (!input.isCardano || !isProofEligibleStakeAddress(input.stakeAddress)) return false;
  return !input.hasProof || input.proofRejected === true;
}

/**
 * What a DEVICE_REGISTER_ACK asks of the client (§5.5, F4). Acts ONLY on explicit
 * values: a legacy relay answers `{type, deviceId}` and that means "unknown", not
 * "unverified". Testing `!== 'verified'` would prompt every user of today's relay.
 */
export type RegisterAckAction =
  | 'needs_proof' // proofStatus absent/invalid: ask the user to re-confirm (fresh proof), then register again
  | 'stale_challenge' // a SUBSCRIBE raced the frame: re-register at most once per challenge
  | 'session_rejected' // sessionStatus absent/invalid: a client bug, log once, never prompt
  | 'not_registered' // registered:false with neither of the above: log once
  | 'none'; // legacy ack, or everything verified

export function classifyRegisterAck(ack: DeviceRegisterAck): RegisterAckAction {
  if (ack.proofStatus === 'absent' || ack.proofStatus === 'invalid') return 'needs_proof';
  if (ack.sessionStatus === 'stale_challenge') return 'stale_challenge';
  if (ack.sessionStatus === 'absent' || ack.sessionStatus === 'invalid') return 'session_rejected';
  if (ack.registered === false) return 'not_registered';
  return 'none';
}
