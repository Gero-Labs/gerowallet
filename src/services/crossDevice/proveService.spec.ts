import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createProveService, type ProveServiceDeps, type ProveTransport } from './proveService';
import { provePayloadDigest, signProveMessage } from './proveEnvelope';
import { generateDeviceKeypair } from './deviceIdentity';
import {
  chunkAad,
  deriveSessionKeys,
  generateEphemeralKeyPair,
  joinChunks,
  openChunk,
  sealChunk,
  splitPayload,
  type SessionKeys,
} from './proveSession';
import type {
  ProveAccept,
  ProveCancel,
  ProveChunk,
  ProveInit,
  ProveMessage,
  ProveReject,
} from './proveProtocol';

const PHONE = 'phone-dev';
const LEDGER = '8.1.0';

const phoneKp = generateDeviceKeypair((n) => new Uint8Array(n).fill(9));
const desktopKp = generateDeviceKeypair((n) => new Uint8Array(n).fill(8));
const strangerKp = generateDeviceKeypair((n) => new Uint8Array(n).fill(7));

const PAYLOAD = new TextEncoder().encode('signed-but-unproven-tx');
const PROVEN = new TextEncoder().encode('finalized-proven-tx');

/** In-memory transport: captures what the desktop sends, injects what it receives. */
function makeTransport() {
  const sent: ProveMessage[] = [];
  let cb: ((raw: unknown) => void) | null = null;
  const transport: ProveTransport = {
    send: (msg) => { sent.push(msg); },
    onMessage: (fn) => { cb = fn; return () => { cb = null; }; },
  };
  const lastOf = <T extends ProveMessage['type']>(type: T) =>
    [...sent].reverse().find((m) => m.type === type) as Extract<ProveMessage, { type: T }> | undefined;
  return {
    transport,
    sent,
    deliver: (raw: unknown) => cb?.(raw),
    lastOf,
    /**
     * Settle until the desktop has actually sent `type`, then hand it back.
     *
     * Every frame in this file is Ed25519-signed, and @noble/ed25519 hashes via
     * WebCrypto, so "the service has responded" is reached after an unknowable
     * number of event-loop turns — more of them on a loaded CI runner than on an
     * idle laptop. Waiting for the frame instead of for a fixed number of turns
     * is what keeps that load-dependent, and it returns as soon as the frame
     * lands, which matters: the job-timeout tests assert on state that a slow
     * settle would have already torn down.
     */
    waitUntilSent: async <T extends ProveMessage['type']>(type: T) => {
      const found = await waitFor(() => lastOf(type));
      if (!found) throw new Error(`timed out waiting for the desktop to send ${type}`);
      return found;
    },
  };
}

function makeDeps(over: Partial<ProveServiceDeps> = {}) {
  const t = makeTransport();
  let n = 0;
  const deps: ProveServiceDeps = {
    transport: t.transport,
    identity: { deviceId: 'desk-dev', privKeyHex: desktopKp.privKeyHex },
    resolvePubKey: async (id) => (id === PHONE ? phoneKp.pubKeyHex : null),
    isPeerPinned: () => true,
    isServingEnabled: () => true,
    ledgerVersion: LEDGER,
    checkProverHealth: async () => true,
    prove: async () => PROVEN,
    now: () => 1_000_000,
    newId: () => `id-${++n}`,
    // Long enough that only the dedicated timeout test ever trips it — real
    // signing work happens between deliver() and the assertions.
    jobTimeoutMs: 5_000,
    ...over,
  };
  return { t, deps };
}

/** The phone half: mints ephemerals, signs a real PROVE_INIT, seals real chunks. */
async function makePhone(reqId = 'req-1', payload = PAYLOAD, over: Partial<ProveInit> = {}) {
  const eph = generateEphemeralKeyPair();
  const parts = splitPayload(payload);
  const init = await signProveMessage<ProveInit>({
    type: 'PROVE_INIT',
    reqId,
    nonce: `nonce-${reqId}`,
    from: PHONE,
    to: 'desk-dev',
    ephPub: eph.pubKeyHex,
    ledgerVersion: LEDGER,
    byteLen: payload.length,
    chunkCount: parts.length,
    expiresAt: 2000, // now() is 1_000_000 ms => 1000 s
    payloadDigest: provePayloadDigest(payload),
    ...over,
  }, phoneKp.privKeyHex);

  let keys: SessionKeys | null = null;
  const onAccept = (accept: ProveAccept) => {
    keys = deriveSessionKeys({
      ourPrivKey: eph.privKey,
      theirPubKeyHex: accept.ephPub,
      reqId,
      phoneDeviceId: PHONE,
      desktopDeviceId: 'desk-dev',
      role: 'phone',
    });
  };
  const chunks = (): ProveChunk[] => parts.map((p, i) => {
    const sealed = sealChunk(keys!.send, p, chunkAad(reqId, 'p2d', i, parts.length));
    return {
      type: 'PROVE_CHUNK', reqId, to: 'desk-dev', seq: i, count: parts.length,
      nonceHex: sealed.nonceHex, ciphertextB64: sealed.ciphertextB64,
    };
  });
  return { init, onAccept, chunks, keys: () => keys! };
}

/**
 * Yield one real MACROTASK. Microtasks are not enough: @noble/ed25519's
 * signAsync/verifyAsync hash via WebCrypto, which a bare `Promise.resolve()`
 * loop does not drain, and every frame in this file is signed.
 */
const tick = () => new Promise((r) => { setTimeout(r, 0); });

/**
 * Poll `predicate` across macrotasks until it returns something truthy.
 *
 * Returns undefined on expiry rather than throwing, so callers decide whether a
 * miss is a failure. The budget is deliberately far larger than the work needs;
 * it is a stuck-test backstop, not a timing assumption. Nothing waits for the
 * whole budget in the passing case — each call returns on the turn the
 * condition first holds.
 */
async function waitFor<T>(predicate: () => T, budgetMs = 5000): Promise<T | undefined> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const value = predicate();
    if (value) return value;
    if (Date.now() >= deadline) return undefined;
    await tick();
  }
}

/**
 * Give the service a fair chance to react, for the cases that assert it did
 * NOTHING. A negative assertion cannot wait on a condition — there is no frame
 * to wait for — so this is an intentional fixed settle, and the only place in
 * this file where a turn count is a judgement call rather than a fact.
 * Everything that expects a frame uses `t.waitUntilSent` instead.
 */
const settle = async () => {
  for (let i = 0; i < 6; i++) await tick();
};

/**
 * Wait until the desktop has stopped sending, so a count taken afterwards is a
 * stable baseline. Accepting a job is not the end of its output — it also
 * reports status — so waiting for one named frame still banks a baseline that
 * the same job then walks past.
 */
async function waitUntilQuiet(t: { sent: ProveMessage[] }, quietTicks = 6, budgetMs = 5000) {
  const deadline = Date.now() + budgetMs;
  let seen = -1;
  let quiet = 0;
  while (Date.now() < deadline) {
    if (t.sent.length === seen) {
      if (++quiet >= quietTicks) return;
    } else {
      seen = t.sent.length;
      quiet = 0;
    }
    await tick();
  }
}

describe('createProveService — happy path', () => {
  it('proves a job and streams back a decryptable finalized tx', async () => {
    const { t, deps } = makeDeps();
    const svc = createProveService(deps);
    const phone = await makePhone();

    t.deliver(phone.init);

    const accept = await t.waitUntilSent('PROVE_ACCEPT');
    expect(accept!.ledgerVersion).toBe(LEDGER);
    phone.onAccept(accept!);

    for (const c of phone.chunks()) t.deliver(c);

    const result = await t.waitUntilSent('PROVE_RESULT');
    expect(result.byteLen).toBe(PROVEN.length);
    expect(result.provenDigest).toBe(provePayloadDigest(PROVEN));

    const back = t.sent.filter((m): m is ProveChunk => m.type === 'PROVE_CHUNK');
    expect(back).toHaveLength(result.chunkCount);
    const opened = back.map((c) =>
      openChunk(phone.keys().receive, c, chunkAad('req-1', 'd2p', c.seq, back.length)));
    expect(new TextDecoder().decode(joinChunks(opened))).toBe('finalized-proven-tx');
    expect(svc.isBusy()).toBe(false);
    svc.dispose();
  });

  it('passes the exact reassembled payload to the prover', async () => {
    // Digest INSIDE the mock: the service zeroes the payload buffer once prove()
    // settles (R8), so a reference captured by vi.fn reads back as zeros later.
    // That wipe is deliberate — see the `prove` contract in ProveServiceDeps.
    let seenDigest = '';
    let calls = 0;
    const { t, deps } = makeDeps({
      prove: async (payload) => { calls += 1; seenDigest = provePayloadDigest(payload); return PROVEN; },
    });
    const svc = createProveService(deps);
    const big = new Uint8Array(70_000).map((_, i) => i % 251);
    const phone = await makePhone('req-big', big);

    t.deliver(phone.init);
    phone.onAccept(await t.waitUntilSent('PROVE_ACCEPT'));
    for (const c of phone.chunks()) t.deliver(c);
    await settle();

    expect(calls).toBe(1);
    // Multi-chunk payload reassembled byte-for-byte, in order.
    expect(seenDigest).toBe(provePayloadDigest(big));
    svc.dispose();
  });

  it('zeroes the payload buffer once proving settles', async () => {
    let captured: Uint8Array | null = null;
    const { t, deps } = makeDeps({
      prove: async (payload) => { captured = payload; return PROVEN; },
    });
    const svc = createProveService(deps);
    const phone = await makePhone();
    t.deliver(phone.init);
    phone.onAccept(await t.waitUntilSent('PROVE_ACCEPT'));
    for (const c of phone.chunks()) t.deliver(c);
    await settle();
    expect(captured).not.toBeNull();
    expect(captured!.every((b) => b === 0)).toBe(true);
    svc.dispose();
  });

  it('reports a status of queued then proving', async () => {
    const { t, deps } = makeDeps();
    const svc = createProveService(deps);
    const phone = await makePhone();
    t.deliver(phone.init);
    phone.onAccept(await t.waitUntilSent('PROVE_ACCEPT'));
    for (const c of phone.chunks()) t.deliver(c);
    await settle();
    const states = t.sent.filter((m) => m.type === 'PROVE_STATUS').map((m) => (m as { state: string }).state);
    expect(states).toEqual(['queued', 'proving']);
    svc.dispose();
  });
});

describe('gate order', () => {
  let svc: { dispose: () => void; isBusy: () => boolean } | null = null;
  beforeEach(() => { svc?.dispose(); svc = null; });

  async function run(over: Partial<ProveServiceDeps>, initOver: Partial<ProveInit> = {}) {
    const { t, deps } = makeDeps(over);
    svc = createProveService(deps);
    const phone = await makePhone('req-1', PAYLOAD, initOver);
    t.deliver(initOver.sig ? { ...phone.init, ...initOver } : phone.init);
    await settle();
    return t;
  }

  it('drops an UNPINNED sender silently — no reject frame at all', async () => {
    const t = await run({ isPeerPinned: () => false });
    // The whole point: a prober must not even learn we are here.
    expect(t.sent).toHaveLength(0);
  });

  it('rejects serving_off when the toggle is off', async () => {
    const t = await run({ isServingEnabled: () => false });
    expect((await t.waitUntilSent('PROVE_REJECT')).reason).toBe('serving_off');
  });

  it('rejects ledger_mismatch on version skew', async () => {
    const t = await run({ ledgerVersion: '9.0.0' });
    expect((await t.waitUntilSent('PROVE_REJECT')).reason).toBe('ledger_mismatch');
  });

  it('rejects prover_unhealthy when the local proof server is down', async () => {
    const t = await run({ checkProverHealth: async () => false });
    expect((await t.waitUntilSent('PROVE_REJECT')).reason).toBe('prover_unhealthy');
  });

  it('rejects too_large above the payload cap', async () => {
    const { t, deps } = makeDeps();
    svc = createProveService(deps);
    const phone = await makePhone('req-1', PAYLOAD, { byteLen: 99_000_000 });
    t.deliver(phone.init);
    expect((await t.waitUntilSent('PROVE_REJECT')).reason).toBe('too_large');
  });

  it('never starts a prover for a gated job', async () => {
    const prove = vi.fn(async () => PROVEN);
    await run({ isServingEnabled: () => false, prove });
    expect(prove).not.toHaveBeenCalled();
  });

  // The guard stops malformed hex, but a well-formed LOW-ORDER curve point still
  // makes getSharedSecret throw. Under `void handleInbound(...)` that escape
  // would become an unhandled rejection in the service worker rather than an
  // answer, leaving the phone to wait out its own timeout.
  it('rejects a well-formed but unusable ephPub instead of throwing', async () => {
    const { t, deps } = makeDeps();
    svc = createProveService(deps);
    // All-zero: valid 32-byte hex, passes the shape guard, low-order point.
    const phone = await makePhone('req-lo', PAYLOAD, { ephPub: '00'.repeat(32) });
    t.deliver(phone.init);
    expect((await t.waitUntilSent('PROVE_REJECT')).reason).toBe('decrypt_failed');
    expect(svc!.isBusy()).toBe(false);
  });

  it('drops a frame addressed to a different device', async () => {
    const { t, deps } = makeDeps();
    svc = createProveService(deps);
    const phone = await makePhone('req-1', PAYLOAD, { to: 'other-desk' });
    t.deliver(phone.init);
    await settle();
    expect(t.sent).toHaveLength(0);
  });

  it('drops a frame whose signature does not match the registered key', async () => {
    const { t, deps } = makeDeps();
    svc = createProveService(deps);
    const forged = await signProveMessage<ProveInit>({
      type: 'PROVE_INIT', reqId: 'req-x', nonce: 'n', from: PHONE, to: 'desk-dev',
      ephPub: generateEphemeralKeyPair().pubKeyHex, ledgerVersion: LEDGER,
      byteLen: 4, chunkCount: 1, expiresAt: 2000, payloadDigest: provePayloadDigest(PAYLOAD),
    }, strangerKp.privKeyHex);
    t.deliver(forged);
    await settle();
    expect(t.sent).toHaveLength(0);
  });

  it('drops an expired PROVE_INIT silently', async () => {
    const { t, deps } = makeDeps();
    svc = createProveService(deps);
    const phone = await makePhone('req-old', PAYLOAD, { expiresAt: 999 }); // now = 1000s
    t.deliver(phone.init);
    await settle();
    expect(t.sent).toHaveLength(0);
  });

  it('drops a replayed PROVE_INIT silently', async () => {
    const { t, deps } = makeDeps();
    svc = createProveService(deps);
    const phone = await makePhone();
    t.deliver(phone.init);
    // Let the FIRST job finish talking before snapshotting. Anything shorter
    // banks a baseline the same job then walks past — it sends PROVE_ACCEPT and
    // then PROVE_STATUS — and the late frame gets counted against the replay.
    // The replay was being dropped correctly the whole time; the baseline was
    // what moved.
    await waitUntilQuiet(t);
    const afterFirst = t.sent.length;
    t.deliver(phone.init); // byte-identical replay
    await settle();
    expect(t.sent).toHaveLength(afterFirst);
  });

  it('rate-limits a pinned peer after a burst', async () => {
    // maxJobs: 1 so this trips on the second job. The default of 5 needs six
    // full signed jobs, whose real Ed25519 work saturates the CPU long enough
    // to starve timers in other spec files running in parallel workers.
    const { t, deps } = makeDeps({
      prove: async () => PROVEN,
      rateLimit: { maxJobs: 1, windowMs: 60_000 },
    });
    svc = createProveService(deps);
    for (let i = 0; i < 2; i++) {
      const p = await makePhone(`req-${i}`);
      t.deliver(p.init);
      await settle();
      // Free the single-job slot so the rate limit is what bites, not `busy`.
      const cancel = await signProveMessage<ProveCancel>({
        type: 'PROVE_CANCEL', reqId: `req-${i}`, nonce: `c${i}`, from: PHONE, to: 'desk-dev',
      }, phoneKp.privKeyHex);
      t.deliver(cancel);
      await settle();
    }
    expect((await t.waitUntilSent('PROVE_REJECT')).reason).toBe('rate_limited');
  });
});

describe('single-job queue', () => {
  it('rejects a second job as busy while one is in flight', async () => {
    const { t, deps } = makeDeps();
    const svc = createProveService(deps);
    const first = await makePhone('req-1');
    t.deliver(first.init);
    await settle();
    expect(svc.isBusy()).toBe(true);

    const second = await makePhone('req-2');
    t.deliver(second.init);
    expect((await t.waitUntilSent('PROVE_REJECT')).reason).toBe('busy');
    svc.dispose();
  });

  // The race the synchronous slot claim exists to prevent: two INITs arriving
  // back-to-back must not both get through the awaited health check.
  it('starts only one prover when two jobs race through the health check', async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((r) => { release = r; });
    const prove = vi.fn(async () => PROVEN);
    const { t, deps } = makeDeps({
      prove,
      checkProverHealth: async () => { await gate; return true; },
    });
    const svc = createProveService(deps);

    const a = await makePhone('req-a');
    const b = await makePhone('req-b');
    t.deliver(a.init);
    t.deliver(b.init);
    release!();
    // Both frames, in either order: the loser is rejected as soon as the winner
    // takes the slot, but the winner's accept is still being signed, so which
    // lands first is not fixed. Settle afterwards to give a second accept — the
    // bug this guards against — a fair chance to show up.
    await waitFor(() => t.lastOf('PROVE_ACCEPT') && t.lastOf('PROVE_REJECT'));
    await settle();

    expect(t.sent.filter((m) => m.type === 'PROVE_ACCEPT')).toHaveLength(1);
    expect((t.lastOf('PROVE_REJECT') as ProveReject).reason).toBe('busy');
    svc.dispose();
  });
});

describe('chunk handling', () => {
  async function accepted(reqId = 'req-1', payload = PAYLOAD) {
    const { t, deps } = makeDeps();
    const svc = createProveService(deps);
    const phone = await makePhone(reqId, payload);
    t.deliver(phone.init);
    phone.onAccept(await t.waitUntilSent('PROVE_ACCEPT'));
    return { t, svc, phone };
  }

  it('rejects decrypt_failed on a tampered chunk', async () => {
    const { t, svc, phone } = await accepted();
    const [c] = phone.chunks();
    t.deliver({ ...c, ciphertextB64: btoa('garbage-that-is-not-a-valid-seal') });
    expect((await t.waitUntilSent('PROVE_REJECT')).reason).toBe('decrypt_failed');
    expect(svc.isBusy()).toBe(false);
    svc.dispose();
  });

  it('rejects a chunk resealed under a different direction', async () => {
    const { t, svc, phone } = await accepted();
    const sealed = sealChunk(phone.keys().send, PAYLOAD, chunkAad('req-1', 'd2p', 0, 1));
    t.deliver({
      type: 'PROVE_CHUNK', reqId: 'req-1', to: 'desk-dev', seq: 0, count: 1,
      nonceHex: sealed.nonceHex, ciphertextB64: sealed.ciphertextB64,
    });
    expect((await t.waitUntilSent('PROVE_REJECT')).reason).toBe('decrypt_failed');
    svc.dispose();
  });

  it('ignores a chunk for an unknown job without failing the live one', async () => {
    const { t, svc, phone } = await accepted();
    t.deliver({ ...phone.chunks()[0], reqId: 'other-req' });
    await settle();
    expect(t.lastOf('PROVE_REJECT')).toBeUndefined();
    expect(svc.isBusy()).toBe(true);
    svc.dispose();
  });

  it('ignores an out-of-range seq', async () => {
    const { t, svc, phone } = await accepted();
    t.deliver({ ...phone.chunks()[0], seq: 5 });
    await settle();
    expect(t.lastOf('PROVE_REJECT')).toBeUndefined();
    svc.dispose();
  });

  it('ignores a duplicate chunk rather than double-counting it', async () => {
    const big = new Uint8Array(70_000).fill(3);
    const { t, svc, phone } = await accepted('req-dup', big);
    const [first] = phone.chunks();
    t.deliver(first);
    t.deliver(first);
    await settle();
    // Two chunks expected; a double-counted duplicate would have completed the job.
    expect(t.lastOf('PROVE_RESULT')).toBeUndefined();
    expect(svc.isBusy()).toBe(true);
    svc.dispose();
  });

  it('rejects digest_mismatch when the payload is not what was signed', async () => {
    const { t, deps } = makeDeps();
    const svc = createProveService(deps);
    // Phone signs a digest for PAYLOAD but ships different bytes of equal length.
    const phone = await makePhone('req-1', PAYLOAD);
    t.deliver(phone.init);
    phone.onAccept(await t.waitUntilSent('PROVE_ACCEPT'));
    const other = new Uint8Array(PAYLOAD.length).fill(0x41);
    const sealed = sealChunk(phone.keys().send, other, chunkAad('req-1', 'p2d', 0, 1));
    t.deliver({
      type: 'PROVE_CHUNK', reqId: 'req-1', to: 'desk-dev', seq: 0, count: 1,
      nonceHex: sealed.nonceHex, ciphertextB64: sealed.ciphertextB64,
    });
    expect((await t.waitUntilSent('PROVE_REJECT')).reason).toBe('digest_mismatch');
    svc.dispose();
  });
});

describe('cancel, timeout, failure, dispose', () => {
  it('honors a signed PROVE_CANCEL from the job owner', async () => {
    const { t, deps } = makeDeps();
    const svc = createProveService(deps);
    const phone = await makePhone();
    t.deliver(phone.init);
    await settle();
    const cancel = await signProveMessage<ProveCancel>({
      type: 'PROVE_CANCEL', reqId: 'req-1', nonce: 'c1', from: PHONE, to: 'desk-dev',
    }, phoneKp.privKeyHex);
    t.deliver(cancel);
    await settle();
    expect(svc.isBusy()).toBe(false);
    svc.dispose();
  });

  it('ignores a cancel for a different job', async () => {
    const { t, deps } = makeDeps();
    const svc = createProveService(deps);
    const phone = await makePhone();
    t.deliver(phone.init);
    await settle();
    const cancel = await signProveMessage<ProveCancel>({
      type: 'PROVE_CANCEL', reqId: 'other', nonce: 'c1', from: PHONE, to: 'desk-dev',
    }, phoneKp.privKeyHex);
    t.deliver(cancel);
    await settle();
    expect(svc.isBusy()).toBe(true);
    svc.dispose();
  });

  // Real timers, not fake ones: the signing path awaits WebCrypto, and faking
  // timers under it makes the flush unable to drain the very frames we assert on.
  // A 60ms job budget keeps this fast enough to be a normal unit test.
  it('times the job out and frees the slot', async () => {
    const { t, deps } = makeDeps({ jobTimeoutMs: 60 });
    const svc = createProveService(deps);
    const phone = await makePhone();
    t.deliver(phone.init);
    await settle();
    expect(svc.isBusy()).toBe(true);
    await new Promise((r) => { setTimeout(r, 80); });
    expect((await t.waitUntilSent('PROVE_REJECT')).reason).toBe('timeout');
    expect(svc.isBusy()).toBe(false);
    svc.dispose();
  });

  // Time spent proving is subtracted from the window in which the finalized tx
  // is still submittable (the ledger enforces intent TTL against wall clock), so
  // the phone's signed expiry — not our budget — is the real ceiling.
  it('bounds the job by the signed expiresAt when that is sooner than the budget', async () => {
    // now = 1_000_900ms => nowSec 1000, so expiresAt 1001 is still fresh but
    // only 100ms away, well inside the 5s default budget.
    const { t, deps } = makeDeps({ now: () => 1_000_900, jobTimeoutMs: 5_000 });
    const svc = createProveService(deps);
    const phone = await makePhone('req-ttl', PAYLOAD, { expiresAt: 1001 });
    t.deliver(phone.init);
    await settle();
    expect(svc.isBusy()).toBe(true);
    await new Promise((r) => { setTimeout(r, 160); });
    expect((await t.waitUntilSent('PROVE_REJECT')).reason).toBe('timeout');
    expect(svc.isBusy()).toBe(false);
    svc.dispose();
  });

  it('rejects prove_failed and frees the slot when the prover throws', async () => {
    const { t, deps } = makeDeps({ prove: async () => { throw new Error('proof server 500'); } });
    const svc = createProveService(deps);
    const phone = await makePhone();
    t.deliver(phone.init);
    phone.onAccept(await t.waitUntilSent('PROVE_ACCEPT'));
    for (const c of phone.chunks()) t.deliver(c);
    expect((await t.waitUntilSent('PROVE_REJECT')).reason).toBe('prove_failed');
    expect(svc.isBusy()).toBe(false);
    svc.dispose();
  });

  it('stops serving after dispose', async () => {
    const { t, deps } = makeDeps();
    const svc = createProveService(deps);
    svc.dispose();
    const phone = await makePhone();
    t.deliver(phone.init);
    await settle();
    expect(t.sent).toHaveLength(0);
  });
});
