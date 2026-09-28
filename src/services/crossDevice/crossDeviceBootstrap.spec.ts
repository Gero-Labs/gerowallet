import { describe, it, expect, beforeEach, vi } from 'vitest';

// The bridge's transport is the shared webSocketService singleton; only sendRaw
// is exercised here. Inbound frames arrive through feedCrossDeviceMessage, which
// is how walletManager's onCrossDeviceMessage hands them over in production.
const sent = vi.hoisted(() => [] as unknown[]);
const logs = vi.hoisted(() => [] as string[]);
vi.mock('@/services/websocket.service', () => ({ default: { sendRaw: (m: unknown) => { sent.push(m); }, isConnected: () => true } }));
vi.mock('@/utils/debug', () => ({ debugLog: (...a: unknown[]) => { logs.push(a.map(String).join(' ')); } }));

import { bootstrapCrossDeviceSigning } from './crossDeviceBootstrap';
import type { DeviceChallenge, DeviceInfo, DeviceRegister } from './protocol';

// ---- Relay contract §3.8 / §5.8 vectors (public test keys only) ----
const RELAY_SEED = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const RELAY_PUB = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';
const DEVICE_ID = '21fe31dfa154a261626bf854046fd227';
const STAKE = 'stake1uyxk54m7j3q6mrkevcunryrwf4p7e68c93cjk8gzxkhlkpswtcyrc';
const VEC_PROOF = {
  coseSign1: '84582aa201276761646472657373581de10d6a577e9441ad8ed9663931906e4d43ece8f82c712b1d0235affb06a166686173686564f458ba6765726f2d786465762f76317c4445564943455f52454749535445527c32316665333164666131353461323631363236626638353430343666643232377c643735613938303138326231306162376435346266656433633936343037336130656531373266336461613632333235616630323161363866373037353131617c7374616b65317579786b35346d376a3371366d726b657663756e7279727766347037653638633933636a6b38677a786b686c6b70737774637972635840689bb635e76b6272f352d295cea334b1b670ec2c38824b4c0e29baaf5fd3339357bb88427a8df8e4a3cb180f9896d33ec08fb8ada7d64405033755358aaf980e',
  coseKey: 'a5010102581de10d6a577e9441ad8ed9663931906e4d43ece8f82c712b1d0235affb06032720062158208a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c',
  stakeAddress: STAKE,
};
const CHALLENGE: DeviceChallenge = { type: 'DEVICE_CHALLENGE', challenge: 'c0c1c2c3c4c5c6c7c8c9cacbcccdcecf', network: 'cardano-mainnet', stakeAddress: STAKE };
/** CONTRACT §5.8 "DEVICE_REGISTER frame (with the §3.8 Vector 2 proof)", verbatim. */
const VEC_REGISTER_FRAME = JSON.parse('{"type":"DEVICE_REGISTER","deviceId":"21fe31dfa154a261626bf854046fd227","label":"Gero Extension","platform":"extension","pubKey":"d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a","hasSigningKey":true,"proof":{"coseSign1":"' + VEC_PROOF.coseSign1 + '","coseKey":"' + VEC_PROOF.coseKey + '","stakeAddress":"' + STAKE + '"},"challenge":"c0c1c2c3c4c5c6c7c8c9cacbcccdcecf","sessionSig":"92690bc775cdf2e4762c5972bb8ee9501a15d5e9c1b446fe8c04dabe41dac62efc3bbf09db91db9f3f0e7d10cc86f0ccdb2a433715261ca6ff0c88daf6f72104"}');

const sibling: DeviceInfo = { deviceId: 'ios-1', label: "Adam's iPhone", platform: 'ios', pubKey: 'bb'.repeat(32), hasSigningKey: true };

function bridge(opts: {
  challenge?: DeviceChallenge | null;
  onRegisterRejected?: () => void;
  onStaleChallenge?: () => void;
} = {}) {
  const handles = bootstrapCrossDeviceSigning({
    label: 'Gero Extension',
    hasSigningKey: true,
    enabled: true,
    identity: { deviceId: DEVICE_ID, privKeyHex: RELAY_SEED, pubKeyHex: RELAY_PUB },
    getProof: () => VEC_PROOF,
    getChallenge: () => opts.challenge ?? null,
    onRegisterRejected: opts.onRegisterRejected,
    onStaleChallenge: opts.onStaleChallenge,
  });
  if (!handles) throw new Error('bridge not built');
  return handles;
}
const frames = () => sent.filter((m): m is DeviceRegister => (m as { type?: string }).type === 'DEVICE_REGISTER');

beforeEach(() => { sent.length = 0; logs.length = 0; });

describe('DEVICE_REGISTER signing (contract §5.3, §5.8 vector)', () => {
  it('with a challenge, sends the §5.8 frame byte for byte (challenge echoed, sessionSig by the relay key)', () => {
    const b = bridge({ challenge: CHALLENGE });
    b.register();
    expect(frames()).toHaveLength(1);
    expect(frames()[0]).toEqual(VEC_REGISTER_FRAME);
    expect(JSON.stringify(frames()[0])).toBe(JSON.stringify(VEC_REGISTER_FRAME)); // same key order too
    b.dispose();
  });

  it('without a challenge (legacy fallback only), sends the frame with neither challenge nor sessionSig', () => {
    const b = bridge({ challenge: null });
    b.register();
    const f = frames()[0];
    expect('challenge' in f).toBe(false);
    expect('sessionSig' in f).toBe(false);
    expect(f.proof).toEqual(VEC_PROOF);
    b.dispose();
  });

  it('copies network and stakeAddress from the challenge into the subject (a different network signs differently)', () => {
    const b = bridge({ challenge: { ...CHALLENGE, network: 'cardano-preprod' } });
    b.register();
    expect(frames()[0].challenge).toBe(CHALLENGE.challenge);
    expect(frames()[0].sessionSig).not.toBe(VEC_REGISTER_FRAME.sessionSig);
    b.dispose();
  });

  it('keeps sending proof exactly as DeviceRegisterProof (A5: shape unchanged by the session fields)', () => {
    const b = bridge({ challenge: CHALLENGE });
    b.register();
    expect(Object.keys(frames()[0].proof ?? {})).toEqual(['coseSign1', 'coseKey', 'stakeAddress']);
    b.dispose();
  });
});

describe('DEVICES restricted (contract §5.6)', () => {
  it('keeps the last full registry when restricted:true arrives, and logs it', () => {
    const b = bridge({ challenge: CHALLENGE });
    b.onCrossDeviceMessage({ type: 'DEVICES', devices: [sibling] });
    expect(b.getDevices().map((d) => d.deviceId)).toEqual(['ios-1']);
    b.onCrossDeviceMessage({ type: 'DEVICES', devices: [], restricted: true }); // after a re-SUBSCRIBE, before our new frame is accepted
    expect(b.getDevices().map((d) => d.deviceId)).toEqual(['ios-1']);
    expect(logs.some((l) => l.includes('restricted'))).toBe(true);
    b.onCrossDeviceMessage({ type: 'DEVICES', devices: [] }); // a real empty snapshot still empties it
    expect(b.getDevices()).toEqual([]);
    b.dispose();
  });
});

describe('DEVICE_REGISTER_ACK handling (contract §5.5, F4)', () => {
  const ack = (extra: Record<string, unknown>) => ({ type: 'DEVICE_REGISTER_ACK', deviceId: DEVICE_ID, ...extra });

  it('a legacy ack {type, deviceId} gives no prompt and no log', () => {
    const rejected = vi.fn(), stale = vi.fn();
    const b = bridge({ onRegisterRejected: rejected, onStaleChallenge: stale });
    b.onCrossDeviceMessage(ack({}));
    expect(rejected).not.toHaveBeenCalled();
    expect(stale).not.toHaveBeenCalled();
    expect(logs.filter((l) => l.includes('ACK') || l.includes('xdev'))).toEqual([]);
    b.dispose();
  });

  it('all verified does nothing', () => {
    const rejected = vi.fn(), stale = vi.fn();
    const b = bridge({ onRegisterRejected: rejected, onStaleChallenge: stale });
    b.onCrossDeviceMessage(ack({ proofStatus: 'verified', sessionStatus: 'verified', registered: true }));
    expect(rejected).not.toHaveBeenCalled();
    expect(stale).not.toHaveBeenCalled();
    b.dispose();
  });

  it.each(['absent', 'invalid'])('proofStatus %s prompts (onRegisterRejected)', (proofStatus) => {
    const rejected = vi.fn(), stale = vi.fn();
    const b = bridge({ onRegisterRejected: rejected, onStaleChallenge: stale });
    b.onCrossDeviceMessage(ack({ proofStatus, sessionStatus: 'verified', registered: false }));
    expect(rejected).toHaveBeenCalledTimes(1);
    expect(stale).not.toHaveBeenCalled();
    b.dispose();
  });

  it('stale_challenge re-signs exactly once per ack (onStaleChallenge), no prompt', () => {
    const rejected = vi.fn(), stale = vi.fn();
    const b = bridge({ onRegisterRejected: rejected, onStaleChallenge: stale });
    b.onCrossDeviceMessage(ack({ proofStatus: 'verified', sessionStatus: 'stale_challenge', registered: false }));
    expect(stale).toHaveBeenCalledTimes(1);
    expect(rejected).not.toHaveBeenCalled();
    b.dispose();
  });

  it.each(['absent', 'invalid'])('sessionStatus %s only logs, once per session', (sessionStatus) => {
    const rejected = vi.fn(), stale = vi.fn();
    const b = bridge({ onRegisterRejected: rejected, onStaleChallenge: stale });
    b.onCrossDeviceMessage(ack({ proofStatus: 'verified', sessionStatus, registered: false }));
    b.onCrossDeviceMessage(ack({ proofStatus: 'verified', sessionStatus, registered: false }));
    expect(rejected).not.toHaveBeenCalled();
    expect(stale).not.toHaveBeenCalled();
    expect(logs.filter((l) => l.includes('session sig rejected'))).toHaveLength(1);
    b.dispose();
  });

  it('registered:false alone only logs', () => {
    const rejected = vi.fn(), stale = vi.fn();
    const b = bridge({ onRegisterRejected: rejected, onStaleChallenge: stale });
    b.onCrossDeviceMessage(ack({ registered: false }));
    expect(rejected).not.toHaveBeenCalled();
    expect(stale).not.toHaveBeenCalled();
    expect(logs.filter((l) => l.includes('not accepted'))).toHaveLength(1);
    b.dispose();
  });
});
