import { describe, it, expect, vi } from 'vitest';
import { createCrossDeviceSigning } from './crossDeviceSigning.service';
import { generateDeviceKeypair, deviceIdFromPubKey } from './deviceIdentity';
import { signMessage } from './envelope';
import { type CrossDeviceMessage, type SignRequest, type SignResponse } from './protocol';

// A shared in-memory bus that fans every published message out to all
// subscribed listeners (simulating gero-sync's fan-out to sibling devices).
function makeBus() {
  const listeners = new Set<(raw: unknown) => void>();
  return {
    publish(msg: CrossDeviceMessage) {
      for (const l of [...listeners]) l(msg);
    },
    makeTransport() {
      return {
        send: (msg: CrossDeviceMessage) => {
          queueMicrotask(() => {
            for (const l of [...listeners]) l(msg);
          });
        },
        onMessage: (cb: (raw: unknown) => void) => {
          listeners.add(cb);
          return () => listeners.delete(cb);
        },
      };
    },
  };
}

const requesterKp = generateDeviceKeypair((n) => new Uint8Array(n).fill(11));
const approverKp = generateDeviceKeypair((n) => new Uint8Array(n).fill(22));
const requesterId = deviceIdFromPubKey(requesterKp.pubKeyHex);
const approverId = deviceIdFromPubKey(approverKp.pubKeyHex);

// Stand-in for the DEVICES-backed registry (in prod, populated from the server snapshot).
const pubKeyRegistry: Record<string, string> = {
  [requesterId]: requesterKp.pubKeyHex,
  [approverId]: approverKp.pubKeyHex,
};

async function makePair(now = () => 1000) {
  const bus = makeBus();
  let counter = 0;
  const newId = () => `id-${counter++}`;

  const requester = createCrossDeviceSigning({
    transport: bus.makeTransport(),
    identity: { deviceId: requesterId, privKeyHex: requesterKp.privKeyHex },
    resolvePubKey: async (id) => pubKeyRegistry[id] ?? null,
    now,
    newId,
  });

  const approver = createCrossDeviceSigning({
    transport: bus.makeTransport(),
    identity: { deviceId: approverId, privKeyHex: approverKp.privKeyHex },
    resolvePubKey: async (id) => pubKeyRegistry[id] ?? null,
    now,
    newId: () => `res-${counter++}`,
  });

  return { bus, requester, approver };
}

describe('crossDeviceSigning happy path', () => {
  it('approver receives a verified request; requester resolves with the witness', async () => {
    const { requester, approver } = await makePair();

    approver.onSignRequest((_req, respond) => {
      void respond({ decision: 'approved', witnessSetCbor: 'a100' });
    });

    const result = await requester.requestSignature({
      unsignedCbor: '84a4',
      intent: 'Swap 10 ADA',
      stakeAddress: 'stake1',
    });

    expect(result.decision).toBe('approved');
    expect(result.witnessSetCbor).toBe('a100');

    requester.dispose();
    approver.dispose();
  });

  it('the approver sees the real unsignedCbor, not just the intent', async () => {
    const { requester, approver } = await makePair();
    let seen: SignRequest | null = null;

    approver.onSignRequest((req, respond) => {
      seen = req;
      void respond({ decision: 'approved', witnessSetCbor: 'ab' });
    });

    await requester.requestSignature({
      unsignedCbor: 'deadbeef',
      intent: 'lying intent',
      stakeAddress: 'stake1',
    });

    expect(seen).not.toBeNull();
    expect(seen!.unsignedCbor).toBe('deadbeef');
    requester.dispose();
    approver.dispose();
  });
});

describe('crossDeviceSigning rejection', () => {
  it('a rejected response resolves with the reason and no witness', async () => {
    const { requester, approver } = await makePair();

    approver.onSignRequest((_req, respond) => {
      void respond({ decision: 'rejected', reason: 'user_declined' });
    });

    const result = await requester.requestSignature({
      unsignedCbor: 'cb00',
      intent: 'Swap',
      stakeAddress: 'stake1',
    });

    expect(result.decision).toBe('rejected');
    expect(result.reason).toBe('user_declined');
    expect(result.witnessSetCbor).toBeUndefined();
    requester.dispose();
    approver.dispose();
  });
});

describe('crossDeviceSigning security', () => {
  it('drops an inbound message with an invalid signature (approver never fires)', async () => {
    const { bus, approver } = await makePair();
    const handler = vi.fn();
    approver.onSignRequest(handler);

    const forged: SignRequest = {
      type: 'SIGN_REQUEST',
      reqId: 'forged',
      nonce: 'nf',
      from: requesterId,
      stakeAddress: 'stake1',
      unsignedCbor: 'ev11',
      intent: 'evil',
      expiresAt: 9999999999,
      sig: '00'.repeat(64),
    };
    bus.publish(forged);
    await new Promise((r) => setTimeout(r, 10));
    expect(handler).not.toHaveBeenCalled();
  });

  it('drops an inbound message from an unregistered device (no pubkey)', async () => {
    const { bus, approver } = await makePair();
    const handler = vi.fn();
    approver.onSignRequest(handler);

    const strangerKp = generateDeviceKeypair((n) => new Uint8Array(n).fill(99));
    const signed = await signMessage<SignRequest>(
      {
        type: 'SIGN_REQUEST',
        reqId: 'stranger',
        nonce: 'ns',
        from: 'unknown-device',
        stakeAddress: 'stake1',
        unsignedCbor: 'cb00',
        intent: 'Swap',
        expiresAt: 9999999999,
      },
      strangerKp.privKeyHex,
    );
    bus.publish(signed);
    await new Promise((r) => setTimeout(r, 10));
    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores a response for an unknown reqId (requester stays pending, ttl decides)', async () => {
    const { bus, requester } = await makePair();

    const ghost = await signMessage<SignResponse>(
      {
        type: 'SIGN_RESPONSE',
        reqId: 'never-issued',
        nonce: 'ng',
        deviceId: approverId,
        decision: 'approved',
        witnessSetCbor: 'ab',
      },
      approverKp.privKeyHex,
    );
    bus.publish(ghost);

    const result = await requester.requestSignature({
      unsignedCbor: 'cb00',
      intent: 'Swap',
      stakeAddress: 'stake1',
      ttlMs: 50,
    });
    expect(result.decision).toBe('rejected');
    requester.dispose();
  });
});

describe('crossDeviceSigning ttl', () => {
  it('rejects the requester promise when the ttl elapses with no response', async () => {
    const { requester } = await makePair();

    const result = await requester.requestSignature({
      unsignedCbor: 'cb00',
      intent: 'Swap',
      stakeAddress: 'stake1',
      ttlMs: 30,
    });
    expect(result.decision).toBe('rejected');
    expect(result.reason).toBeDefined();
    requester.dispose();
  });
});

describe('crossDeviceSigning approver replay + expiry', () => {
  it('drops a replayed SIGN_REQUEST (approver surfaces it only once)', async () => {
    const { bus, approver } = await makePair(() => 1000);
    const handler = vi.fn();
    approver.onSignRequest(handler);

    const req = await signMessage<SignRequest>(
      {
        type: 'SIGN_REQUEST',
        reqId: 'r1',
        nonce: 'n1',
        from: requesterId,
        stakeAddress: 'stake1',
        unsignedCbor: '84a4',
        intent: 'Swap',
        expiresAt: 9999999999,
      },
      requesterKp.privKeyHex,
    );
    bus.publish(req);
    await new Promise((r) => setTimeout(r, 10));
    bus.publish(req); // exact-bytes replay (relay re-delivery)
    await new Promise((r) => setTimeout(r, 10));

    expect(handler).toHaveBeenCalledTimes(1);
    approver.dispose();
  });

  it('drops an already-expired SIGN_REQUEST (never surfaces it)', async () => {
    const { bus, approver } = await makePair(() => 1000); // nowSec = 1
    const handler = vi.fn();
    approver.onSignRequest(handler);

    const expired = await signMessage<SignRequest>(
      {
        type: 'SIGN_REQUEST',
        reqId: 'r-exp',
        nonce: 'n-exp',
        from: requesterId,
        stakeAddress: 'stake1',
        unsignedCbor: '84a4',
        intent: 'Swap',
        expiresAt: 0, // already past nowSec=1
      },
      requesterKp.privKeyHex,
    );
    bus.publish(expired);
    await new Promise((r) => setTimeout(r, 10));

    expect(handler).not.toHaveBeenCalled();
    approver.dispose();
  });
});

describe('crossDeviceSigning trusted-device gates', () => {
  const mkRequester = (bus: ReturnType<typeof makeBus>, extra = {}) =>
    createCrossDeviceSigning({
      transport: bus.makeTransport(),
      identity: { deviceId: requesterId, privKeyHex: requesterKp.privKeyHex },
      resolvePubKey: async (id) => pubKeyRegistry[id] ?? null,
      now: () => 1000,
      newId: (() => { let c = 0; return () => `q-${c++}`; })(),
      ...extra,
    });
  const mkApprover = (bus: ReturnType<typeof makeBus>, extra = {}) =>
    createCrossDeviceSigning({
      transport: bus.makeTransport(),
      identity: { deviceId: approverId, privKeyHex: approverKp.privKeyHex },
      resolvePubKey: async (id) => pubKeyRegistry[id] ?? null,
      now: () => 1000,
      newId: (() => { let c = 0; return () => `r-${c++}`; })(),
      ...extra,
    });

  it('approver show-gate: an untrusted requester never surfaces the request', async () => {
    const bus = makeBus();
    const requester = mkRequester(bus);
    const handler = vi.fn();
    const approver = mkApprover(bus, { isRequesterTrusted: () => false });
    approver.onSignRequest(handler);

    void requester.requestSignature({ unsignedCbor: '84a4', stakeAddress: 'stake1', ttlMs: 40 });
    await new Promise((r) => setTimeout(r, 20));

    expect(handler).not.toHaveBeenCalled();
    requester.dispose();
    approver.dispose();
  });

  it('requester accept-gate: an approval from an untrusted responder is ignored (ttl decides)', async () => {
    const bus = makeBus();
    const requester = mkRequester(bus, { isResponderTrusted: () => false });
    const approver = mkApprover(bus);
    approver.onSignRequest((_req, respond) => {
      void respond({ decision: 'approved', witnessSetCbor: 'a100' });
    });

    const result = await requester.requestSignature({ unsignedCbor: '84a4', stakeAddress: 'stake1', ttlMs: 30 });

    expect(result.decision).toBe('rejected');
    expect(result.reason).toBe('expired');
    expect(result.witnessSetCbor).toBeUndefined();
    requester.dispose();
    approver.dispose();
  });

  it('a trusted responder resolves normally', async () => {
    const bus = makeBus();
    const requester = mkRequester(bus, {
      isResponderTrusted: (id: string, pk: string) => id === approverId && pk === approverKp.pubKeyHex,
    });
    const approver = mkApprover(bus, { isRequesterTrusted: () => true });
    approver.onSignRequest((_req, respond) => {
      void respond({ decision: 'approved', witnessSetCbor: 'a100' });
    });

    const result = await requester.requestSignature({ unsignedCbor: '84a4', stakeAddress: 'stake1', ttlMs: 200 });

    expect(result.decision).toBe('approved');
    expect(result.witnessSetCbor).toBe('a100');
    requester.dispose();
    approver.dispose();
  });
});
