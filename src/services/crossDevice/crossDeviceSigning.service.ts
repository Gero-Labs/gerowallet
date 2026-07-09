// Cross-device signing bridge — transport-injected orchestration service.
//
// Wires the pure primitives (protocol validators, envelope sign/verify,
// state machine) to an injected transport. It has two sides:
//   - Requester: signs and publishes a SIGN_REQUEST, then resolves when a
//     verified matching SIGN_RESPONSE arrives (or rejects on ttl).
//   - Approver: registers a handler that receives verified SIGN_REQUESTs so it
//     can locally decode + guardrail + sign, then respond.
//
// Everything network-facing is injected (transport, now, newId, resolvePubKey),
// so this is fully unit-testable with an in-memory fake and no real network.
// The pure modules stay free of chrome/WebSocket/Date.now; this service is the
// only place timing (ttl reject timer) lives.

import { parseCrossDeviceMessage, type CrossDeviceMessage, type SignRequest, type SignResponse, type PairConfirm, type PairAck } from './protocol';
import { signMessage, verifyMessage } from './envelope';
import { createRequest, applyResponse, type MachineState } from './signRequestMachine';

export interface Transport {
  send(msg: CrossDeviceMessage): void;
  onMessage(cb: (raw: unknown) => void): () => void;
}

export interface CrossDeviceIdentity {
  deviceId: string;
  privKeyHex: string;
}

export interface CrossDeviceDeps {
  transport: Transport;
  identity: CrossDeviceIdentity;
  resolvePubKey: (deviceId: string) => Promise<string | null>; // registry lookup (gero-sync-backed later)
  now: () => number;
  newId: () => string; // reqId/nonce generator (injected for tests)
  // Trusted-device gates, checked AFTER signature verification. Default allow-all
  // (Phase-0 behaviour); the bootstrap injects the real per-wallet trust check.
  //   isRequesterTrusted: approver show-gate — only surface SIGN_REQUESTs from a
  //     trusted device (drops rogue requests + their tx CBOR).
  //   isResponderTrusted: requester accept-gate — only act on SIGN_RESPONSEs from
  //     a trusted device (closes DoS-by-rejection, ignores rogue approvals).
  isRequesterTrusted?: (deviceId: string, pubKey: string) => boolean;
  isResponderTrusted?: (deviceId: string, pubKey: string) => boolean;
  // QR pairing: a verified inbound PAIR_CONFIRM (phone -> this desktop). Verified
  // here against the pubKey CARRIED IN THE FRAME (the phone is not a trusted sibling
  // yet), then handed off for the wallet-control-proof check + pin. Absent => QR
  // pairing inbound is ignored (dark default).
  onPairConfirm?: (frame: PairConfirm) => void;
  // Optional diagnostic sink (injected debugLog in prod, absent in tests). The wake
  // path is otherwise silent, which is exactly what hid the WAKE_PENDING allow-list
  // bug — a mismatched relay frame or a stuck poll leaves no breadcrumb without this.
  log?: (msg: string) => void;
  // Wake tuning (defaults below). Injected mainly so tests can run the poll fast.
  wakePollMs?: number;
  wakeWindowMs?: number;
}

export interface SignDecision {
  decision: 'approved' | 'rejected';
  witnessSetCbor?: string;
  reason?: string;
}

export type SignRequestHandler = (
  req: SignRequest,
  respond: (r: SignDecision) => Promise<void>,
) => void;

export interface RequestSignatureInput {
  unsignedCbor: string;
  intent?: string;
  stakeAddress?: string;
  ttlMs?: number;
  /** Optional target deviceId. When set, the relay routes only to that device
   *  (with an APNs wake if it is offline); absent => relay broadcasts. Routing
   *  hint only, not signed. */
  to?: string;
}

export interface CrossDeviceSigning {
  requestSignature(input: RequestSignatureInput): Promise<SignDecision>;
  onSignRequest(handler: SignRequestHandler): () => void;
  /** Send a signed PAIR_ACK to a just-paired phone (cosmetic confirm tick). `to` is
   *  the phone's deviceId (the PAIR_CONFIRM.from), `nonce` the echoed pairing nonce. */
  sendPairAck(to: string, nonce: string): Promise<void>;
  dispose(): void;
}

const DEFAULT_TTL_MS = 60_000;
// When the target device is offline, the relay wakes it (APNs) and returns
// WAKE_PENDING instead of delivering. We then wait up to WAKE_WINDOW_MS for it to
// reconnect (polling the registry every WAKE_POLL_MS) and re-issue a FRESH request
// once it's back — the interactive TTL is too short to survive a cold wake.
const WAKE_WINDOW_MS = 120_000;
const WAKE_POLL_MS = 2_000;
// Cap re-issues so a relay that keeps reporting the target offline can't loop the
// desktop forever (each online-detection re-issues; this bounds it).
const MAX_WAKE_REISSUES = 3;

export function createCrossDeviceSigning(deps: CrossDeviceDeps): CrossDeviceSigning {
  const { transport, identity, resolvePubKey, now, newId } = deps;
  const onPairConfirm = deps.onPairConfirm;
  const log = deps.log ?? (() => { /* no-op sink */ });
  const isRequesterTrusted = deps.isRequesterTrusted ?? (() => true);
  const isResponderTrusted = deps.isResponderTrusted ?? (() => true);
  const wakePollMs = deps.wakePollMs ?? WAKE_POLL_MS;
  const wakeWindowMs = deps.wakeWindowMs ?? WAKE_WINDOW_MS;

  let machine: MachineState = { byId: {}, seen: [] };
  // Pending requester promises awaiting their SIGN_RESPONSE, keyed by the CURRENT
  // reqId. onWake fires when the relay reports the target offline (WAKE_PENDING).
  const waiting = new Map<
    string,
    { resolve: (d: SignDecision) => void; timer: ReturnType<typeof setTimeout> | null; onWake?: () => void }
  >();
  const requestHandlers = new Set<SignRequestHandler>();
  // Cancel callbacks for in-flight requestSignature calls (incl. their wake-poll
  // timers, which live in the promise closure). dispose() invokes these so a logout
  // / wallet-switch mid-wake can't leave a poll (and a stray re-issue) running.
  const activeRequests = new Set<() => void>();

  // Approver-side replay + expiry guard. The requester machine's dedup/expiry
  // only protects the REQUESTER; the approver path had neither, so an untrusted
  // relay could re-deliver a captured (still-valid-signature) SIGN_REQUEST and
  // re-surface the approval sheet, or deliver an already-expired request. APNs
  // would make replay a reliable primitive. Keyed by reqId:nonce; pruned by
  // expiry so it stays bounded by the in-flight window.
  const approverSeen = new Map<string, number>(); // reqId:nonce -> expiresAt (unix seconds)

  function approverAccepts(req: SignRequest): boolean {
    const nowSec = Math.floor(now() / 1000);
    for (const [k, exp] of approverSeen) {
      if (exp <= nowSec) approverSeen.delete(k);
    }
    if (req.expiresAt <= nowSec) return false; // already expired: never surface it
    const key = `${req.reqId}:${req.nonce}`;
    if (approverSeen.has(key)) return false; // replay of a request we already surfaced
    approverSeen.set(key, req.expiresAt);
    return true;
  }

  function settle(reqId: string, decision: SignDecision): void {
    const entry = waiting.get(reqId);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    waiting.delete(reqId);
    entry.resolve(decision);
  }

  async function handleInbound(raw: unknown): Promise<void> {
    // Relay control frame (unsigned): the target device is offline and a wake was
    // sent. Acted on ONLY for a reqId we are actively awaiting; a spurious one from
    // the relay merely extends our own wait and never affects authenticity (signing
    // still needs the phone's verified SIGN_RESPONSE). Handled before parsing since
    // WAKE_PENDING is not a signed CrossDeviceMessage.
    if (raw && typeof raw === 'object' && (raw as { type?: unknown }).type === 'WAKE_PENDING') {
      const reqId = (raw as { reqId?: unknown }).reqId;
      const matched = typeof reqId === 'string' && waiting.has(reqId);
      // Observability: a WAKE_PENDING whose reqId doesn't match a pending request
      // (relay shape mismatch, or arrived after ttl) is otherwise a silent no-op —
      // the desktop would just sit on its ttl and reject 'expired' with no breadcrumb.
      log(`WAKE_PENDING reqId=${String(reqId)} matched=${matched} awaiting=[${[...waiting.keys()].join(',')}]`);
      if (typeof reqId === 'string') waiting.get(reqId)?.onWake?.();
      return;
    }

    const msg = parseCrossDeviceMessage(raw);
    if (!msg) return;

    // QR pairing confirm (phone -> this desktop). Authenticated against the pubKey
    // IN THE FRAME, not resolvePubKey: the phone is not in the DEVICES snapshot yet
    // (pairing is precisely how it becomes trusted), so there is no pinned key to
    // resolve. Deliberately UNGATED by isRequesterTrusted for the same reason. The
    // signed subject binds `to`, so we accept only confirms addressed to THIS device.
    // A valid frame signature alone NEVER pins — the WALLET binding is enforced
    // downstream (walletManager.handlePairConfirm) via the embedded wallet-control
    // proof against our OWN stake.
    if (msg.type === 'PAIR_CONFIRM') {
      if (msg.from === identity.deviceId) return; // never our own echo
      if (msg.to !== identity.deviceId) return; // only confirms addressed to us
      if (!(await verifyMessage(msg, msg.pubKey))) return;
      onPairConfirm?.(msg);
      return;
    }

    // Only SIGN_REQUEST/SIGN_RESPONSE are authenticated here. Registry frames
    // (DEVICES / DEVICE_REGISTER / DEVICE_REGISTER_ACK) are handled elsewhere.
    if (msg.type !== 'SIGN_REQUEST' && msg.type !== 'SIGN_RESPONSE') return;

    // Authenticated origin (invariant 2): verify against the sender's registered pubkey.
    const senderId = msg.type === 'SIGN_REQUEST' ? msg.from : msg.deviceId;
    const pubKey = await resolvePubKey(senderId);
    if (!pubKey) return;
    const ok = await verifyMessage(msg, pubKey);
    if (!ok) return;

    if (msg.type === 'SIGN_REQUEST') {
      // Ignore requests this device itself originated.
      if (msg.from === identity.deviceId) return;
      // Approver show-gate: only surface requests from a trusted device.
      if (!isRequesterTrusted(senderId, pubKey)) return;
      // Drop replays of an already-surfaced request and already-expired requests.
      if (!approverAccepts(msg)) return;
      dispatchSignRequest(msg);
      return;
    }
    // Requester accept-gate: only act on responses from a trusted device.
    if (!isResponderTrusted(senderId, pubKey)) return;
    handleSignResponse(msg);
  }

  function dispatchSignRequest(req: SignRequest): void {
    const respond = async (r: SignDecision): Promise<void> => {
      const res = await signMessage<SignResponse>(
        {
          type: 'SIGN_RESPONSE',
          reqId: req.reqId,
          nonce: newId(),
          // Route the response back to the original requester (hint, not signed).
          to: req.from,
          deviceId: identity.deviceId,
          decision: r.decision,
          witnessSetCbor: r.witnessSetCbor,
          reason: r.reason,
        },
        identity.privKeyHex,
      );
      transport.send(res);
    };
    for (const handler of [...requestHandlers]) {
      handler(req, respond);
    }
  }

  function handleSignResponse(res: SignResponse): void {
    // Only act on responses to a request this device is actively awaiting.
    if (!waiting.has(res.reqId)) return;
    machine = applyResponse(machine, res, now());
    const status = machine.byId[res.reqId]?.status;
    if (status === 'approved') {
      settle(res.reqId, { decision: 'approved', witnessSetCbor: res.witnessSetCbor });
    } else if (status === 'rejected') {
      settle(res.reqId, { decision: 'rejected', reason: res.reason });
    } else if (status === 'expired') {
      settle(res.reqId, { decision: 'rejected', reason: 'expired' });
    }
  }

  const unsubscribe = transport.onMessage((raw) => {
    void handleInbound(raw);
  });

  async function requestSignature(input: RequestSignatureInput): Promise<SignDecision> {
    const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
    const to = input.to;

    return new Promise<SignDecision>((resolve) => {
      let done = false;
      let currentReqId = '';
      let reissues = 0;
      let wakeTimer: ReturnType<typeof setTimeout> | null = null;
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      let checking = false;

      function stopWake(): void {
        if (wakeTimer) { clearTimeout(wakeTimer); wakeTimer = null; }
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
      }
      const cancel = (): void => finish({ decision: 'rejected', reason: 'disposed' });
      function finish(d: SignDecision): void {
        if (done) return;
        done = true;
        activeRequests.delete(cancel);
        stopWake();
        const e = currentReqId ? waiting.get(currentReqId) : undefined;
        if (e?.timer) clearTimeout(e.timer);
        if (currentReqId) waiting.delete(currentReqId);
        resolve(d);
      }
      activeRequests.add(cancel);

      // Send a fresh SIGN_REQUEST (new reqId/nonce/expiresAt), (re)registering the
      // pending entry under it. Used for the initial send and each re-issue on wake.
      async function issue(): Promise<void> {
        if (done) return;
        const reqId = newId();
        const nonce = newId();
        const expiresAt = Math.floor(now() / 1000) + Math.ceil(ttlMs / 1000);
        let req: SignRequest;
        try {
          req = await signMessage<SignRequest>(
            {
              type: 'SIGN_REQUEST',
              reqId,
              nonce,
              from: identity.deviceId,
              // Routing hint (not in the signed subject); omit when absent so the
              // relay falls back to broadcast for callers that do not target a device.
              ...(to ? { to } : {}),
              stakeAddress: input.stakeAddress,
              unsignedCbor: input.unsignedCbor,
              intent: input.intent,
              expiresAt,
            },
            identity.privKeyHex,
          );
        } catch {
          finish({ decision: 'rejected', reason: 'sign_failed' });
          return;
        }
        if (done) return;
        machine = createRequest(machine, req);
        // Move the pending entry to the new reqId (drop any prior one).
        if (currentReqId) {
          const prev = waiting.get(currentReqId);
          if (prev?.timer) clearTimeout(prev.timer);
          waiting.delete(currentReqId);
        }
        currentReqId = reqId;
        const timer = setTimeout(() => finish({ decision: 'rejected', reason: 'expired' }), ttlMs);
        waiting.set(reqId, { resolve: finish, timer, onWake });
        transport.send(req);
      }

      // Relay reported the target offline (a wake was sent). Pause the short
      // interactive ttl and wait (bounded) for the device to reconnect, polling the
      // registry; re-issue a FRESH request once it is back (the relay never queued
      // the stale one). No target => nothing to wake, let the ttl reject.
      function onWake(): void {
        if (done || !to || wakeTimer) return;
        const e = currentReqId ? waiting.get(currentReqId) : undefined;
        if (e) {
          if (e.timer) clearTimeout(e.timer);
          waiting.set(currentReqId, { ...e, timer: null });
        }
        log(`onWake: target ${to} offline; ttl paused, polling for reconnect (window ${wakeWindowMs}ms)`);
        wakeTimer = setTimeout(() => {
          log(`wake_timeout: ${to} did not reconnect within ${wakeWindowMs}ms`);
          finish({ decision: 'rejected', reason: 'wake_timeout' });
        }, wakeWindowMs);
        const check = async (): Promise<void> => {
          if (done || checking) return; // in-flight guard: no overlapping re-issue
          checking = true;
          try {
            const pk = await resolvePubKey(to);
            if (pk && !done) {
              stopWake();
              if (reissues >= MAX_WAKE_REISSUES) { log(`wake_exhausted: ${to} (${reissues} re-issues)`); finish({ decision: 'rejected', reason: 'wake_exhausted' }); return; }
              reissues += 1;
              log(`target ${to} back online; re-issuing SIGN_REQUEST (${reissues}/${MAX_WAKE_REISSUES})`);
              void issue();
            }
          } finally {
            checking = false;
          }
        };
        void check(); // in case it is already back online
        pollTimer = setInterval(() => { void check(); }, wakePollMs);
      }

      void issue();
    });
  }

  function onSignRequest(handler: SignRequestHandler): () => void {
    requestHandlers.add(handler);
    return () => requestHandlers.delete(handler);
  }

  async function sendPairAck(to: string, nonce: string): Promise<void> {
    // from = THIS device's deviceId (== the deviceId in the QR the phone scanned);
    // the phone verifies the sig against the pubKey it pinned from that QR.
    const ack = await signMessage<PairAck>(
      { type: 'PAIR_ACK', from: identity.deviceId, to, nonce },
      identity.privKeyHex,
    );
    transport.send(ack);
  }

  function dispose(): void {
    unsubscribe();
    // Cancel in-flight requests first: this stops any wake-poll timers (closure-local,
    // not on the waiting entries) and resolves their promises as 'disposed'.
    for (const cancel of [...activeRequests]) cancel();
    activeRequests.clear();
    for (const { timer } of waiting.values()) if (timer) clearTimeout(timer);
    waiting.clear();
    requestHandlers.clear();
  }

  return { requestSignature, onSignRequest, sendPairAck, dispose };
}
