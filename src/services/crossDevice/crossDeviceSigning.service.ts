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

import { parseCrossDeviceMessage, type CrossDeviceMessage, type SignRequest, type SignResponse, isSignRequest, isSignResponse } from './protocol';
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

export interface CrossDeviceSigning {
  requestSignature(input: {
    unsignedCbor: string;
    intent: string;
    stakeAddress: string;
    toDeviceId?: string;
    ttlMs?: number;
  }): Promise<SignDecision>;
  onSignRequest(handler: SignRequestHandler): () => void;
  dispose(): void;
}

const DEFAULT_TTL_MS = 60_000;

export function createCrossDeviceSigning(deps: CrossDeviceDeps): CrossDeviceSigning {
  const { transport, identity, resolvePubKey, now, newId } = deps;

  let machine: MachineState = { byId: {}, seen: [] };
  // Pending requester promises awaiting their SIGN_RESPONSE, keyed by reqId.
  const waiting = new Map<
    string,
    { resolve: (d: SignDecision) => void; timer: ReturnType<typeof setTimeout> }
  >();
  const requestHandlers = new Set<SignRequestHandler>();

  function settle(reqId: string, decision: SignDecision): void {
    const entry = waiting.get(reqId);
    if (!entry) return;
    clearTimeout(entry.timer);
    waiting.delete(reqId);
    entry.resolve(decision);
  }

  async function handleInbound(raw: unknown): Promise<void> {
    const msg = parseCrossDeviceMessage(raw);
    if (!msg) return;
    if (msg.type === 'DEVICE_REGISTER') return; // registry announcements are server-side concerns

    // Authenticated origin (invariant 2): verify against the sender's registered pubkey.
    const pubKey = await resolvePubKey(msg.fromDeviceId);
    if (!pubKey) return;
    const ok = await verifyMessage(msg as { sig: string } & Record<string, unknown>, pubKey);
    if (!ok) return;

    if (isSignRequest(msg)) {
      // Ignore requests this device itself originated.
      if (msg.fromDeviceId === identity.deviceId) return;
      dispatchSignRequest(msg);
      return;
    }

    if (isSignResponse(msg)) {
      handleSignResponse(msg);
    }
  }

  function dispatchSignRequest(req: SignRequest): void {
    const respond = async (r: SignDecision): Promise<void> => {
      const res = await signMessage<SignResponse>(
        {
          v: req.v,
          type: 'SIGN_RESPONSE',
          reqId: req.reqId,
          fromDeviceId: identity.deviceId,
          decision: r.decision,
          witnessSetCbor: r.witnessSetCbor,
          reason: r.reason,
          nonce: newId(),
          createdAt: now(),
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

  async function requestSignature(input: {
    unsignedCbor: string;
    intent: string;
    stakeAddress: string;
    toDeviceId?: string;
    ttlMs?: number;
  }): Promise<SignDecision> {
    const reqId = newId();
    const nonce = newId();
    const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
    const req = await signMessage<SignRequest>(
      {
        v: 1,
        type: 'SIGN_REQUEST',
        reqId,
        fromDeviceId: identity.deviceId,
        toDeviceId: input.toDeviceId ?? 'any',
        stakeAddress: input.stakeAddress,
        unsignedCbor: input.unsignedCbor,
        intent: input.intent,
        nonce,
        createdAt: now(),
        ttlMs,
      },
      identity.privKeyHex,
    );
    machine = createRequest(machine, req);

    return new Promise<SignDecision>((resolve) => {
      const timer = setTimeout(() => {
        // ttl elapsed with no verified response: reject the requester promise.
        waiting.delete(reqId);
        resolve({ decision: 'rejected', reason: 'expired' });
      }, ttlMs);
      waiting.set(reqId, { resolve, timer });
      transport.send(req);
    });
  }

  function onSignRequest(handler: SignRequestHandler): () => void {
    requestHandlers.add(handler);
    return () => requestHandlers.delete(handler);
  }

  function dispose(): void {
    unsubscribe();
    for (const { timer } of waiting.values()) clearTimeout(timer);
    waiting.clear();
    requestHandlers.clear();
  }

  return { requestSignature, onSignRequest, dispose };
}
