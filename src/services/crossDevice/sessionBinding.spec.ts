import { describe, it, expect } from 'vitest';
import * as ed25519 from '@noble/ed25519';
import {
  buildSessionSubject,
  signDeviceRegisterSession,
  classifyRegisterAck,
  computeNeedsProof,
  isProofEligibleStakeAddress,
  wireNetworkOf,
  challengeMatchesWallet,
} from './sessionBinding';
import { deviceIdFromPubKey } from './deviceIdentity';
import type { DeviceChallenge, DeviceRegisterAck } from './protocol';

// ---- Relay contract §5.8 vectors (RFC 8032 TEST 1 relay key; public test keys only) ----
const RELAY_SEED = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const RELAY_PUB = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';
const DEVICE_ID = '21fe31dfa154a261626bf854046fd227';
const STAKE = 'stake1uyxk54m7j3q6mrkevcunryrwf4p7e68c93cjk8gzxkhlkpswtcyrc';
const CHALLENGE: DeviceChallenge = {
  type: 'DEVICE_CHALLENGE',
  challenge: 'c0c1c2c3c4c5c6c7c8c9cacbcccdcecf',
  network: 'cardano-mainnet',
  stakeAddress: STAKE,
};
const VEC_SUBJECT = `gero-xdev/v1|DEVICE_REGISTER_SESSION|c0c1c2c3c4c5c6c7c8c9cacbcccdcecf|${DEVICE_ID}|cardano-mainnet|${STAKE}`;
const VEC_SESSION_SIG = '92690bc775cdf2e4762c5972bb8ee9501a15d5e9c1b446fe8c04dabe41dac62efc3bbf09db91db9f3f0e7d10cc86f0ccdb2a433715261ca6ff0c88daf6f72104';

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

describe('§5.8 session signature vector (byte for byte)', () => {
  it('the relay key of the vector derives the vector deviceId', () => {
    expect(deviceIdFromPubKey(RELAY_PUB)).toBe(DEVICE_ID);
    expect(Buffer.from(ed25519.getPublicKey(hexToBytes(RELAY_SEED))).toString('hex')).toBe(RELAY_PUB);
  });

  it('builds the exact subject', () => {
    expect(buildSessionSubject(CHALLENGE.challenge, DEVICE_ID, CHALLENGE.network, CHALLENGE.stakeAddress)).toBe(VEC_SUBJECT);
  });

  it('signs it to the exact sessionSig (noble is deterministic)', () => {
    expect(signDeviceRegisterSession(CHALLENGE, DEVICE_ID, RELAY_SEED)).toBe(VEC_SESSION_SIG);
  });

  it('the signature verifies against the relay pubkey over the UTF-8 subject', async () => {
    const ok = await ed25519.verifyAsync(hexToBytes(VEC_SESSION_SIG), new TextEncoder().encode(VEC_SUBJECT), hexToBytes(RELAY_PUB));
    expect(ok).toBe(true);
  });

  it('a different challenge or network changes the signature (the subject binds them)', () => {
    expect(signDeviceRegisterSession({ ...CHALLENGE, challenge: 'd0'.repeat(16) }, DEVICE_ID, RELAY_SEED)).not.toBe(VEC_SESSION_SIG);
    expect(signDeviceRegisterSession({ ...CHALLENGE, network: 'cardano-preprod' }, DEVICE_ID, RELAY_SEED)).not.toBe(VEC_SESSION_SIG);
  });
});

describe('wire network + challenge matching (§5.2 client rule)', () => {
  it('maps the extension Network values to wire ids', () => {
    expect(wireNetworkOf('Mainnet')).toBe('cardano-mainnet');
    expect(wireNetworkOf('Preprod')).toBe('cardano-preprod');
    expect(wireNetworkOf('Preview')).toBe('cardano-preview');
  });

  it('matches only the exact stake address AND network', () => {
    const wallet = { stakeAddress: STAKE, network: 'cardano-mainnet' };
    expect(challengeMatchesWallet(CHALLENGE, wallet)).toBe(true);
    expect(challengeMatchesWallet({ ...CHALLENGE, network: 'cardano-preprod' }, wallet)).toBe(false);
    expect(challengeMatchesWallet({ ...CHALLENGE, stakeAddress: 'stake1other' }, wallet)).toBe(false);
    expect(challengeMatchesWallet(CHALLENGE, null)).toBe(false);
  });
});

describe('DEVICE_REGISTER_ACK rule (§5.5, F4): explicit values only', () => {
  const ack = (extra: Partial<DeviceRegisterAck>): DeviceRegisterAck => ({ type: 'DEVICE_REGISTER_ACK', deviceId: DEVICE_ID, ...extra });

  it('legacy ack {type, deviceId} -> none (no prompt, no log)', () => {
    expect(classifyRegisterAck(ack({}))).toBe('none');
    expect(classifyRegisterAck({ type: 'DEVICE_REGISTER_ACK' })).toBe('none');
  });

  it('all verified -> none', () => {
    expect(classifyRegisterAck(ack({ proofStatus: 'verified', sessionStatus: 'verified', registered: true }))).toBe('none');
  });

  it.each(['absent', 'invalid'] as const)('proofStatus %s -> needs_proof (prompt)', (proofStatus) => {
    expect(classifyRegisterAck(ack({ proofStatus, sessionStatus: 'verified', registered: false }))).toBe('needs_proof');
  });

  it('proof wins over session: absent proof + stale challenge -> needs_proof', () => {
    expect(classifyRegisterAck(ack({ proofStatus: 'absent', sessionStatus: 'stale_challenge', registered: false }))).toBe('needs_proof');
  });

  it('stale_challenge -> stale_challenge (re-sign at most once per challenge)', () => {
    expect(classifyRegisterAck(ack({ proofStatus: 'verified', sessionStatus: 'stale_challenge', registered: false }))).toBe('stale_challenge');
  });

  it.each(['absent', 'invalid'] as const)('sessionStatus %s -> session_rejected (log only)', (sessionStatus) => {
    expect(classifyRegisterAck(ack({ proofStatus: 'verified', sessionStatus, registered: false }))).toBe('session_rejected');
  });

  it('registered:false alone -> not_registered (log only)', () => {
    expect(classifyRegisterAck(ack({ registered: false }))).toBe('not_registered');
    expect(classifyRegisterAck(ack({ proofStatus: 'verified', sessionStatus: 'verified', registered: false }))).toBe('not_registered');
  });

  it('a partial ack with only verified fields -> none (never tests !== verified)', () => {
    expect(classifyRegisterAck(ack({ proofStatus: 'verified' }))).toBe('none');
    expect(classifyRegisterAck(ack({ registered: true }))).toBe('none');
  });
});

describe('proof eligibility (A2) and needsProof (A1)', () => {
  it('accepts mainnet and testnet key-hash reward addresses only', () => {
    expect(isProofEligibleStakeAddress(STAKE)).toBe(true);
    expect(isProofEligibleStakeAddress('stake_test1uqxk54m7j3q6mrkevcunryrwf4p7e68c93cjk8gzxkhlkpsxyz')).toBe(true);
    expect(isProofEligibleStakeAddress('')).toBe(false);
    expect(isProofEligibleStakeAddress(null)).toBe(false);
    expect(isProofEligibleStakeAddress(undefined)).toBe(false);
    expect(isProofEligibleStakeAddress('addr1qxyz')).toBe(false);
    expect(isProofEligibleStakeAddress('bc1qxyz')).toBe(false);
    expect(isProofEligibleStakeAddress('stake_test')).toBe(false);
  });

  const base = { enabled: true, hasProof: false, isCardano: true, stakeAddress: STAKE };
  it.each([
    // enabled, hasProof, proofRejected, isCardano, stake, expected
    [{ ...base }, true], // on, no proof -> prompt
    [{ ...base, hasProof: true }, false], // on, proof cached -> fine
    [{ ...base, hasProof: true, proofRejected: true }, true], // relay rejected the cached proof -> prompt
    [{ ...base, enabled: false }, false], // off -> never
    [{ ...base, enabled: false, proofRejected: true }, false],
    [{ ...base, isCardano: false }, false], // BTC / Midnight cannot produce one
    [{ ...base, stakeAddress: '' }, false], // enterprise: no reward address
    [{ ...base, stakeAddress: 'stake_test1uqxk54m7j3q6mrkevcunryrwf4p7e68c93cjk8gzxkhlkpsxyz' }, true], // testnet counts
  ])('needsProof(%o) = %s', (input, expected) => {
    expect(computeNeedsProof(input)).toBe(expected);
  });
});
