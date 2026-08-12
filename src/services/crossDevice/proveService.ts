// Cross-Device Proving (XDP) — the background prover service. Requirement R3.
//
// The serving half of XDP: this desktop answers a pinned phone's PROVE_INIT by
// proving its signed-but-unproven Midnight tx against the local proof server and
// streaming the finalized tx back, encrypted. It is the counterpart to
// crossDeviceSigning.service.ts, and follows the same discipline — everything
// network-facing, clock-facing, and WASM-facing is INJECTED, so the whole state
// machine unit-tests with an in-memory fake and no real network or prover.
//
// There is deliberately NO approval UI and no user gesture anywhere in this
// file. Proving authorizes nothing: the tx is already signed, the desktop cannot
// alter what it proves (the payload digest is signed by the phone and re-checked
// here), and a proof is worthless without the tx it belongs to. So the desktop
// serves silently, gated only on pinning + an opt-in toggle. That is also why
// PROVE_CANCEL is always safe to honor — there is no human mid-flow to confuse.
//
// PRIVACY (ground rule 13, extended): never log payload bodies, plaintext,
// keys, or ciphertext. Sizes, durations, counts, reqIds and reasons only.

import {
  MAX_PROVE_PAYLOAD_BYTES,
  parseProveMessage,
  type ProveAccept,
  type ProveCancel,
  type ProveChunk,
  type ProveInit,
  type ProveMessage,
  type ProveRejectReason,
  type ProveReject,
  type ProveResult,
  type ProveStatus,
  type ProveStatusState,
} from './proveProtocol';
import { provePayloadDigest, signProveMessage, verifyProveMessage } from './proveEnvelope';
import {
  chunkAad,
  deriveSessionKeys,
  generateEphemeralKeyPair,
  joinChunks,
  openChunk,
  sealChunk,
  splitPayload,
  wipe,
  DEFAULT_CHUNK_BYTES,
  type SessionKeys,
} from './proveSession';


export interface ProveTransport {
  send(msg: ProveMessage): void;
  onMessage(cb: (raw: unknown) => void): () => void;
}

/**
 * The proving budget. 180 s is the brief's figure; the job timeout adds grace
 * for chunk transfer on either side. Both stay under Chrome's hard cap on a
 * single MV3 task, and the total never drops below the wallet's established
 * never-below-120 s rule for proving work.
 */
export const PROVE_BUDGET_MS = 180_000;
const JOB_TIMEOUT_MS = PROVE_BUDGET_MS + 30_000;

/** Per-peer sliding window. A pinned peer is trusted, not unlimited. */
const RATE_LIMIT_MAX_JOBS = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;

export interface ProveServiceDeps {
  transport: ProveTransport;
  identity: { deviceId: string; privKeyHex: string };
  /** Registry lookup for the sender's pinned relay pubkey. */
  resolvePubKey: (deviceId: string) => Promise<string | null>;
  /**
   * Gate 1 — is this peer PINNED? Failing this drops the frame SILENTLY (no
   * reject frame), matching the signing rail: an unpinned prober must not learn
   * whether this wallet exists, is online, or pairs with anyone.
   */
  isPeerPinned: (deviceId: string, pubKey: string) => boolean;
  /** Gate 2 — has the user enabled serving to this specific peer? */
  isServingEnabled: (deviceId: string) => boolean;
  /** Gate 3 — proof-server docker tag this desktop proves against. */
  ledgerVersion: string;
  /** Gate 6 — local proof server `/health`. Never throws (see midnightLocalProver). */
  checkProverHealth: () => Promise<boolean>;
  /**
   * The work itself: signed-but-unproven bytes in, finalized bytes out. Injected
   * so this service never imports the ledger WASM — that lives behind
   * midnightUnshieldedProver.ts, and keeping it out of here is what makes the
   * gate logic testable.
   *
   * CONTRACT: the `payload` buffer is ZEROED as soon as the returned promise
   * settles (R8 — witness bytes must not linger in a long-lived service worker).
   * An implementation must consume or copy it before then, and must never retain
   * the reference for later use.
   */
  prove: (payload: Uint8Array) => Promise<Uint8Array>;
  now: () => number;
  newId: () => string;
  log?: (msg: string) => void;
  /** Tuning (tests inject small values). */
  jobTimeoutMs?: number;
  chunkBytes?: number;
  /**
   * Per-peer sliding-window rate limit. Injectable like every other tunable
   * here so a test can trip it in two jobs instead of six — each job costs
   * several real Ed25519 signatures, and a six-job test saturates the CPU long
   * enough to starve timers in other test files running in parallel.
   */
  rateLimit?: { maxJobs: number; windowMs: number };
}

export interface ProveService {
  /** Whether a job is currently running (drives the settings surface). */
  isBusy(): boolean;
  dispose(): void;
}

/** In-flight job state. Exactly one exists at a time (single-job queue). */
interface ActiveJob {
  reqId: string;
  peerId: string;
  keys: SessionKeys;
  ephPriv: Uint8Array;
  expectedChunks: number;
  received: Map<number, Uint8Array>;
  byteLen: number;
  payloadDigest: string;
  timer: ReturnType<typeof setTimeout> | null;
  cancelled: boolean;
}

export function createProveService(deps: ProveServiceDeps): ProveService {
  const { transport, identity, resolvePubKey, now, newId } = deps;
  const log = deps.log ?? (() => { /* no-op sink */ });
  const jobTimeoutMs = deps.jobTimeoutMs ?? JOB_TIMEOUT_MS;
  const chunkBytes = deps.chunkBytes ?? DEFAULT_CHUNK_BYTES;
  const rateMaxJobs = deps.rateLimit?.maxJobs ?? RATE_LIMIT_MAX_JOBS;
  const rateWindowMs = deps.rateLimit?.windowMs ?? RATE_LIMIT_WINDOW_MS;

  /**
   * The single job slot. Claimed SYNCHRONOUSLY before the first await (the
   * health check), because two PROVE_INITs racing through an async gate would
   * both pass a naive "is anything running" test and start two provers. The
   * brief lists health before the queue check; claiming the slot first is the
   * only way that ordering is actually safe.
   */
  let active: ActiveJob | null = null;
  /** reqId:nonce -> expiresAt (unix seconds). Replay guard, pruned by expiry. */
  const seen = new Map<string, number>();
  /** peerId -> recent job start times (unix ms), for the rate limit. */
  const recentJobs = new Map<string, number[]>();
  let disposed = false;

  function isFresh(init: ProveInit): boolean {
    const nowSec = Math.floor(now() / 1000);
    for (const [k, exp] of seen) if (exp <= nowSec) seen.delete(k);
    if (init.expiresAt <= nowSec) return false;
    const key = `${init.reqId}:${init.nonce}`;
    if (seen.has(key)) return false;
    seen.set(key, init.expiresAt);
    return true;
  }

  function withinRateLimit(peerId: string): boolean {
    const cutoff = now() - rateWindowMs;
    const times = (recentJobs.get(peerId) ?? []).filter((t) => t > cutoff);
    if (times.length >= rateMaxJobs) {
      recentJobs.set(peerId, times);
      return false;
    }
    times.push(now());
    recentJobs.set(peerId, times);
    return true;
  }

  async function sendSigned<T extends { sig: string }>(msg: Omit<T, 'sig'>): Promise<void> {
    try {
      transport.send(await signProveMessage<T>(msg, identity.privKeyHex) as unknown as ProveMessage);
    } catch (e) {
      log(`send failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function reject(
    init: Pick<ProveInit, 'reqId' | 'from'>,
    reason: ProveRejectReason,
  ): Promise<void> {
    log(`reject ${init.reqId}: ${reason}`);
    await sendSigned<ProveReject>({
      type: 'PROVE_REJECT',
      reqId: init.reqId,
      nonce: newId(),
      from: identity.deviceId,
      to: init.from,
      reason,
    });
  }

  async function status(job: ActiveJob, state: ProveStatusState): Promise<void> {
    await sendSigned<ProveStatus>({
      type: 'PROVE_STATUS',
      reqId: job.reqId,
      nonce: newId(),
      from: identity.deviceId,
      to: job.peerId,
      state,
    });
  }

  /** Tear a job down exactly once, wiping its key material. */
  function endJob(job: ActiveJob): void {
    if (job.timer) clearTimeout(job.timer);
    job.timer = null;
    job.received.clear();
    wipe(job.keys.send, job.keys.receive, job.ephPriv);
    if (active === job) active = null;
  }

  /** Fail an active job: tell the peer why (best effort), then tear down. */
  function failJob(job: ActiveJob, reason: ProveRejectReason): void {
    if (job.cancelled) { endJob(job); return; }
    job.cancelled = true;
    void reject({ reqId: job.reqId, from: job.peerId }, reason);
    endJob(job);
  }

  async function handleInit(init: ProveInit, senderPubKey: string): Promise<void> {
    // Gate 1 — PINNED. Silent drop, no reject frame: an unpinned sender learns
    // nothing, not even that this device is here. Signing-rail discipline.
    if (!deps.isPeerPinned(init.from, senderPubKey)) {
      log(`drop PROVE_INIT from unpinned ${init.from.slice(0, 8)}`);
      return;
    }
    // Replay / expiry. Also silent — a replayed INIT is a relay artifact, and
    // answering it would let a captured frame pull a fresh reject out of us.
    if (!isFresh(init)) {
      log(`drop stale/replayed PROVE_INIT ${init.reqId}`);
      return;
    }
    // Gate 2 — serving toggle (master + per-device).
    if (!deps.isServingEnabled(init.from)) return reject(init, 'serving_off');
    // Gate 3 — version skew. Refuse before any crypto work; a proof from a
    // mismatched ledger would be rejected on-chain after all the effort.
    if (init.ledgerVersion !== deps.ledgerVersion) return reject(init, 'ledger_mismatch');
    // Gate 4 — size cap, checked against the SIGNED byteLen before we accept a
    // single chunk, so a hostile peer cannot stream unbounded memory into a
    // long-lived service worker.
    if (init.byteLen > MAX_PROVE_PAYLOAD_BYTES) return reject(init, 'too_large');
    // Gate 5 — per-peer rate limit.
    if (!withinRateLimit(init.from)) return reject(init, 'rate_limited');
    // Gate 6 — single-job queue. Claimed here, SYNCHRONOUSLY, before the awaited
    // health check below (see the `active` declaration).
    if (active) return reject(init, 'busy');

    // Session establishment. `isProveInit` already rejects an ephPub that is not
    // 32 bytes of hex, but a WELL-FORMED low-order curve point still makes
    // getSharedSecret throw, and this runs under `void handleInbound(...)` — so
    // an escape here becomes an unhandled rejection in the service worker
    // instead of an answer to the peer, leaving the phone to wait out its own
    // timeout with its rate-limit budget already spent. Every other risky step
    // in this file is wrapped; this one was not.
    const eph = generateEphemeralKeyPair();
    let keys: SessionKeys;
    try {
      keys = deriveSessionKeys({
        ourPrivKey: eph.privKey,
        theirPubKeyHex: init.ephPub,
        reqId: init.reqId,
        phoneDeviceId: init.from,
        desktopDeviceId: identity.deviceId,
        role: 'desktop',
      });
    } catch (e) {
      wipe(eph.privKey);
      log(`session setup failed for ${init.reqId}: ${e instanceof Error ? e.message : String(e)}`);
      return reject(init, 'decrypt_failed');
    }
    const job: ActiveJob = {
      reqId: init.reqId,
      peerId: init.from,
      keys,
      ephPriv: eph.privKey,
      expectedChunks: init.chunkCount,
      received: new Map(),
      byteLen: init.byteLen,
      payloadDigest: init.payloadDigest,
      timer: null,
      cancelled: false,
    };
    active = job;
    // Bound the job by the SIGNED request expiry as well as the proving budget.
    // Without this a job could keep the single slot (and a running proof) alive
    // long after the phone gave up at `expiresAt` — wasted work on a result
    // nobody will accept, and a slot no other job can use.
    //
    // This matters more since iOS measured that the ledger's TTL enforcement is
    // WALL-CLOCK (`wellFormed(…, tblock: now)` reads "Intent TTL has expired"
    // once the window lapses): time spent proving is time subtracted from the
    // window in which the finalized tx can still be submitted. Whatever budget
    // the phone signs into `expiresAt` is the real ceiling, not ours.
    const msUntilExpiry = init.expiresAt * 1000 - now();
    const effectiveTimeoutMs = Math.max(0, Math.min(jobTimeoutMs, msUntilExpiry));
    job.timer = setTimeout(() => failJob(job, 'timeout'), effectiveTimeoutMs);

    // Gate 7 — prover health, last because it is the only gate that costs a
    // round-trip, and because its answer should be as fresh as possible.
    if (!(await deps.checkProverHealth())) {
      job.cancelled = true;
      void reject(init, 'prover_unhealthy');
      endJob(job);
      return;
    }
    if (job.cancelled || active !== job) return; // cancelled while checking health

    log(`accept ${init.reqId} from ${init.from.slice(0, 8)} (${init.byteLen}B, ${init.chunkCount} chunks)`);
    await sendSigned<ProveAccept>({
      type: 'PROVE_ACCEPT',
      reqId: init.reqId,
      nonce: newId(),
      from: identity.deviceId,
      to: init.from,
      ephPub: eph.pubKeyHex,
      ledgerVersion: deps.ledgerVersion,
    });
    await status(job, 'queued');
  }

  function handleChunk(chunk: ProveChunk): void {
    const job = active;
    // Unsigned frame: everything about it is verified by the AEAD tag below, so
    // a mismatched reqId/seq/count is simply ignored rather than answered.
    if (!job || job.cancelled || chunk.reqId !== job.reqId) return;
    if (chunk.count !== job.expectedChunks) return;
    if (chunk.seq < 0 || chunk.seq >= job.expectedChunks) return;
    if (job.received.has(chunk.seq)) return; // duplicate; first one wins

    let plaintext: Uint8Array;
    try {
      // AAD is rebuilt from OUR expectation (direction p2d, our chunk count),
      // never from relay-supplied values — the PAIR_ACK discipline.
      plaintext = openChunk(
        job.keys.receive,
        { nonceHex: chunk.nonceHex, ciphertextB64: chunk.ciphertextB64 },
        chunkAad(job.reqId, 'p2d', chunk.seq, job.expectedChunks),
      );
    } catch {
      // A tag failure means tampering, a wrong key, or a spliced chunk. There is
      // no recovery and no point continuing to collect.
      failJob(job, 'decrypt_failed');
      return;
    }
    job.received.set(chunk.seq, plaintext);
    if (job.received.size === job.expectedChunks) void runProof(job);
  }

  async function runProof(job: ActiveJob): Promise<void> {
    const ordered: Uint8Array[] = [];
    for (let i = 0; i < job.expectedChunks; i += 1) ordered.push(job.received.get(i)!);
    const payload = joinChunks(ordered);
    job.received.clear();

    // The phone SIGNED this digest in PROVE_INIT, so this is what proves the
    // desktop is proving the exact tx the phone intended — not something a relay
    // (or a bug in our own reassembly) substituted.
    if (payload.length !== job.byteLen || provePayloadDigest(payload) !== job.payloadDigest) {
      log(`digest mismatch on ${job.reqId} (${payload.length}B vs ${job.byteLen}B)`);
      wipe(payload);
      failJob(job, 'digest_mismatch');
      return;
    }

    await status(job, 'proving');
    if (job.cancelled) { wipe(payload); endJob(job); return; }

    const startedAt = now();
    let proven: Uint8Array;
    try {
      proven = await deps.prove(payload);
    } catch (e) {
      // Message only — midnightLocalProver's errors are HTTP-status diagnostics
      // and never contain the payload (see its file header).
      log(`prove failed on ${job.reqId} after ${now() - startedAt}ms: ${e instanceof Error ? e.message : String(e)}`);
      wipe(payload);
      failJob(job, 'prove_failed');
      return;
    } finally {
      wipe(payload);
    }
    // A cancel (or timeout) that landed mid-proof: drop the result on the floor.
    // Sending it anyway would be harmless cryptographically but would contradict
    // the peer's own state machine.
    if (job.cancelled || active !== job) { endJob(job); return; }

    log(`proved ${job.reqId} in ${now() - startedAt}ms (${proven.length}B)`);
    const parts = splitPayload(proven, chunkBytes);
    for (let i = 0; i < parts.length; i += 1) {
      const sealed = sealChunk(job.keys.send, parts[i], chunkAad(job.reqId, 'd2p', i, parts.length));
      transport.send({
        type: 'PROVE_CHUNK',
        reqId: job.reqId,
        to: job.peerId,
        seq: i,
        count: parts.length,
        nonceHex: sealed.nonceHex,
        ciphertextB64: sealed.ciphertextB64,
      });
    }
    await sendSigned<ProveResult>({
      type: 'PROVE_RESULT',
      reqId: job.reqId,
      nonce: newId(),
      from: identity.deviceId,
      to: job.peerId,
      byteLen: proven.length,
      chunkCount: parts.length,
      provenDigest: provePayloadDigest(proven),
    });
    endJob(job);
  }

  function handleCancel(cancel: ProveCancel): void {
    const job = active;
    if (!job || cancel.reqId !== job.reqId || cancel.from !== job.peerId) return;
    log(`cancel honored for ${job.reqId}`);
    job.cancelled = true;
    endJob(job);
  }

  async function handleInbound(raw: unknown): Promise<void> {
    if (disposed) return;
    const msg = parseProveMessage(raw);
    if (!msg) return;

    // Chunks are unsigned by design; the AEAD tag is their authentication.
    if (msg.type === 'PROVE_CHUNK') {
      handleChunk(msg);
      return;
    }
    // This desktop serves; it never requests. The phone-side frames
    // (ACCEPT/REJECT/STATUS/RESULT) are not ours to act on.
    if (msg.type !== 'PROVE_INIT' && msg.type !== 'PROVE_CANCEL') return;
    if (msg.from === identity.deviceId) return; // never our own echo
    if (msg.to !== identity.deviceId) return; // only frames addressed to us

    // Authenticated origin: verify against the sender's REGISTERED pubkey before
    // any gate runs. An unresolvable sender is dropped — for XDP that is not a
    // dark-feature fallback but the intended end state, since a peer must be
    // pinned to be served at all.
    const pubKey = await resolvePubKey(msg.from);
    if (!pubKey) return;
    if (!(await verifyProveMessage(msg, pubKey))) return;

    if (msg.type === 'PROVE_INIT') {
      await handleInit(msg, pubKey);
      return;
    }
    handleCancel(msg);
  }

  const unsubscribe = transport.onMessage((raw) => { void handleInbound(raw); });

  return {
    isBusy: () => active !== null,
    dispose: () => {
      disposed = true;
      unsubscribe();
      if (active) {
        // Wallet switch / logout mid-job: wipe key material rather than leave it
        // in a service worker that may outlive the session.
        active.cancelled = true;
        endJob(active);
      }
      seen.clear();
      recentJobs.clear();
    },
  };
}
