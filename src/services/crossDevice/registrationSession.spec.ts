import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRegistrationSession, DEFAULT_FALLBACK_MS, type RegistrationSession } from './registrationSession';
import type { DeviceChallenge } from './protocol';

// Handover A6 "Challenge handling (G1)": a fake socket (onSocketOpen / isConnected)
// and a fake bridge whose register() records which challenge signed each frame,
// exactly as crossDeviceBootstrap.register() does via getChallenge().

const STAKE = 'stake1uyxk54m7j3q6mrkevcunryrwf4p7e68c93cjk8gzxkhlkpswtcyrc';
const WALLET = { stakeAddress: STAKE, network: 'cardano-mainnet' };
const ch = (value: string, extra: Partial<DeviceChallenge> = {}): DeviceChallenge => ({
  type: 'DEVICE_CHALLENGE', challenge: value.repeat(16), network: 'cardano-mainnet', stakeAddress: STAKE, ...extra,
});
const C1 = ch('a1'), C2 = ch('b2'), C3 = ch('c3');

interface Harness {
  session: RegistrationSession;
  frames: Array<string | null>; // challenge value each DEVICE_REGISTER was signed with (null = legacy unsigned)
  setBridge(on: boolean): void;
  setConnected(on: boolean): void;
  logs: string[];
}

function harness(opts: { bridge?: boolean; connected?: boolean; wallet?: typeof WALLET | null } = {}): Harness {
  const frames: Array<string | null> = [];
  const logs: string[] = [];
  let bridgeOn = opts.bridge ?? true;
  let connected = opts.connected ?? true;
  let session!: RegistrationSession;
  const bridge = { register: () => { frames.push(session.getChallenge()?.challenge ?? null); } };
  session = createRegistrationSession({
    wallet: () => (opts.wallet === undefined ? WALLET : opts.wallet),
    bridge: () => (bridgeOn ? bridge : null),
    isConnected: () => connected,
    log: (m) => logs.push(m),
  });
  return { session, frames, logs, setBridge: (on) => { bridgeOn = on; }, setConnected: (on) => { connected = on; } };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('registration session (contract §5.2 G1, §5.5 fallback)', () => {
  it('sends nothing on socket open; the first challenge sends exactly one frame signed with it', () => {
    const h = harness();
    h.session.onSocketOpen();
    expect(h.frames).toEqual([]);
    h.session.onChallenge(C1);
    expect(h.frames).toEqual([C1.challenge]);
  });

  it('same-socket credential expansion (re-SUBSCRIBE, no onSocketOpen): the new challenge sends one frame signed with it', () => {
    const h = harness();
    h.session.onSocketOpen();
    h.session.onChallenge(C1);
    h.session.onChallenge(C2); // relay answers the resubscribe(0, expanded) with a fresh challenge
    expect(h.frames).toEqual([C1.challenge, C2.challenge]);
  });

  it('force resync (resubscribe(0)): the same, one frame per new challenge', () => {
    const h = harness();
    h.session.onSocketOpen();
    h.session.onChallenge(C1);
    h.session.onChallenge(C2);
    h.session.onChallenge(C3);
    expect(h.frames).toEqual([C1.challenge, C2.challenge, C3.challenge]);
  });

  it('a duplicate DEVICE_CHALLENGE with the same value sends nothing', () => {
    const h = harness();
    h.session.onSocketOpen();
    h.session.onChallenge(C1);
    h.session.onChallenge({ ...C1 });
    h.session.register(); // an explicit non-forced register is also a no-op for a signed challenge
    expect(h.frames).toEqual([C1.challenge]);
  });

  it('enabling remote signing after login (bridge created on a live socket that has a challenge): one frame signed with it, no reconnect', () => {
    const h = harness({ bridge: false });
    h.session.onSocketOpen();
    h.session.onChallenge(C1); // bridge is null: nothing can be sent, the challenge is kept
    expect(h.frames).toEqual([]);
    h.setBridge(true);
    h.session.register({ force: true }); // reconfigureCrossDevice after the new bridge exists
    expect(h.frames).toEqual([C1.challenge]);
  });

  it('feature off at connect, then on: the stored challenge signs the frame, never an unsigned one (even past 5 s)', () => {
    const h = harness({ bridge: false });
    h.session.onSocketOpen();
    h.session.onChallenge(C1);
    vi.advanceTimersByTime(DEFAULT_FALLBACK_MS + 1_000); // the fallback timer was cleared by the challenge
    expect(h.frames).toEqual([]);
    h.setBridge(true);
    h.session.register({ force: true });
    expect(h.frames).toEqual([C1.challenge]);
  });

  it('proof re-send (produceDeviceRegisterProof): one forced frame carrying the current challenge', () => {
    const h = harness();
    h.session.onSocketOpen();
    h.session.onChallenge(C1);
    h.session.register({ force: true }); // the proof was just cached: ride at once
    expect(h.frames).toEqual([C1.challenge, C1.challenge]);
  });

  it('reconnect: onSocketOpen clears the old challenge; no frame is signed with it; the new challenge sends one', () => {
    const h = harness();
    h.session.onSocketOpen();
    h.session.onChallenge(C1);
    h.session.onSocketOpen(); // the socket dropped and reopened
    expect(h.session.getChallenge()).toBeNull();
    h.session.register({ force: true }); // e.g. a settings change right after reopen: nothing to sign with yet, and no unsigned frame before 5 s
    expect(h.frames).toEqual([C1.challenge]);
    h.session.onChallenge(C2);
    expect(h.frames).toEqual([C1.challenge, C2.challenge]);
  });

  it('a challenge for another stake address or network sends nothing and turns the 5 s fallback off', () => {
    const h = harness();
    h.session.onSocketOpen();
    h.session.onChallenge(ch('d4', { stakeAddress: 'stake1u_someone_else' }));
    h.session.onChallenge(ch('e5', { network: 'cardano-preprod' }));
    vi.advanceTimersByTime(DEFAULT_FALLBACK_MS + 1_000);
    h.session.register({ force: true });
    expect(h.frames).toEqual([]);
    expect(h.session.getChallenge()).toBeNull();
    expect(h.logs.filter((l) => l.includes('another wallet'))).toHaveLength(1); // logged once per socket
  });

  it('no challenge within 5 s of opening sends one legacy frame; a challenge after that sends one signed frame', () => {
    const h = harness();
    h.session.onSocketOpen();
    vi.advanceTimersByTime(DEFAULT_FALLBACK_MS - 1);
    expect(h.frames).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(h.frames).toEqual([null]); // relay in mode `off` / older relay: the unsigned frame
    h.session.onChallenge(C1); // a late challenge (e.g. the relay switched to `log`)
    expect(h.frames).toEqual([null, C1.challenge]);
  });

  it('the legacy fallback is skipped when the bridge is null, and sent by a later forced register only while no challenge was seen', () => {
    const h = harness({ bridge: false });
    h.session.onSocketOpen();
    vi.advanceTimersByTime(DEFAULT_FALLBACK_MS);
    expect(h.frames).toEqual([]);
    h.setBridge(true);
    h.session.register({ force: true }); // enabling after login against a mode-`off` relay
    expect(h.frames).toEqual([null]);
  });

  it('a stale_challenge ack after the newer challenge already sent its frame sends nothing', () => {
    const h = harness();
    h.session.onSocketOpen();
    h.session.onChallenge(C1);
    h.session.onChallenge(C2); // the SUBSCRIBE that raced C1's frame
    h.session.onStaleChallenge(); // the relay's answer to the C1 frame
    expect(h.frames).toEqual([C1.challenge, C2.challenge]);
  });

  it('a stale_challenge ack sends one frame when the current challenge has none yet (at most once per challenge)', () => {
    const h = harness({ connected: false });
    h.session.onSocketOpen();
    h.session.onChallenge(C1); // socket reported not connected: nothing sent, challenge kept
    expect(h.frames).toEqual([]);
    h.setConnected(true);
    h.session.onStaleChallenge();
    h.session.onStaleChallenge();
    expect(h.frames).toEqual([C1.challenge]);
  });

  it('nothing is sent while the socket is not connected; the challenge stays stored', () => {
    const h = harness({ connected: false });
    h.session.onSocketOpen();
    h.session.onChallenge(C1);
    h.session.register({ force: true });
    expect(h.frames).toEqual([]);
    expect(h.session.getChallenge()).toEqual(C1);
  });

  it('reset (logout) drops the challenge and the fallback timer', () => {
    const h = harness();
    h.session.onSocketOpen();
    h.session.reset();
    vi.advanceTimersByTime(DEFAULT_FALLBACK_MS + 1_000);
    expect(h.frames).toEqual([]);
    expect(h.session.getChallenge()).toBeNull();
  });

  it('before login (no wallet) a challenge is never signed', () => {
    const h = harness({ wallet: null });
    h.session.onSocketOpen();
    h.session.onChallenge(C1);
    expect(h.frames).toEqual([]);
  });
});
