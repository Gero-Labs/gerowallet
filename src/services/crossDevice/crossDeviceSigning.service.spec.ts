import { describe, it, expect, vi } from 'vitest';
import { createCrossDeviceSigning } from './crossDeviceSigning.service';
import { generateDeviceKeypair, deviceIdFromPubKey } from './deviceIdentity';
import { signMessage } from './envelope';
import { CROSS_DEVICE_PROTOCOL_VERSION, type CrossDeviceMessage, type SignRequest } from './protocol';

// A shared in-memory bus that fans every published message out to all
// subscribed listeners (simulating gero-sync's fan-out to sibling devices).
function makeBus() {
  const listeners = new Set<(raw: unknown) => void>();
  return {
    publish(msg: CrossDeviceMessage) {
      // Deliver to everyone (each device ignores messages meant for others / its own).
      for (const l of [...listeners]) l(msg);
    },
    makeTransport() {
      return {
        send: (msg: CrossDeviceMessage) => {
          // Async delivery to mimic real network hop.
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

// Deterministic device identities for the two simulated devices.
const requesterKp = generateDeviceKeypair((n) => new Uint8Array(n).fill(11));
const approverKp = generateDeviceKeypair((n) => new Uint8Array(n).fill(22));
const requesterId = deviceIdFromPubKey(requesterKp.pubKeyHex);
const approverId = deviceIdFromPubKey(approverKp.pubKeyHex);

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
      void respond({ decision: 'approved', witnessSetCbor: 'WITNESS_A100' });
    });

    const result = await requester.requestSignature({
      unsignedCbor: '84a4CBOR',
      intent: 'Swap 10 ADA',
      stakeAddress: 'stake1',
    });

    expect(result.decision).toBe('approved');
    expect(result.witnessSetCbor).toBe('WITNESS_A100');

    requester.dispose();
    approver.dispose();
  });

  it('the approver sees the real unsignedCbor, not just the intent', async () => {
    const { requester, approver } = await makePair();
    let seen: SignRequest | null = null;

    approver.onSignRequest((req, respond) => {
      seen = req;
      void respond({ decision: 'approved', witnessSetCbor: 'W' });
    });

    await requester.requestSignature({
      unsignedCbor: 'GROUND_TRUTH_CBOR',
      intent: 'lying intent',
      stakeAddress: 'stake1',
    });

    expect(seen).not.toBeNull();
    expect(seen!.unsignedCbor).toBe('GROUND_TRUTH_CBOR');
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
      unsignedCbor: 'cbor',
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

    // A structurally valid SIGN_REQUEST with a bogus signature.
    const forged: SignRequest = {
      v: CROSS_DEVICE_PROTOCOL_VERSION,
      type: 'SIGN_REQUEST',
      reqId: 'forged',
      fromDeviceId: requesterId,
      toDeviceId: 'any',
      stakeAddress: 'stake1',
      unsignedCbor: 'evil',
      intent: 'evil',
      nonce: 'nf',
      createdAt: 1000,
      ttlMs: 5000,
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

    // Signed by a device with no registry entry.
    const strangerKp = generateDeviceKeypair((n) => new Uint8Array(n).fill(99));
    const signed = await signMessage<SignRequest>(
      {
        v: CROSS_DEVICE_PROTOCOL_VERSION,
        type: 'SIGN_REQUEST',
        reqId: 'stranger',
        fromDeviceId: 'unknown-device',
        toDeviceId: 'any',
        stakeAddress: 'stake1',
        unsignedCbor: 'cbor',
        intent: 'Swap',
        nonce: 'ns',
        createdAt: 1000,
        ttlMs: 5000,
      },
      strangerKp.privKeyHex,
    );
    bus.publish(signed);
    await new Promise((r) => setTimeout(r, 10));
    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores a response for an unknown reqId (requester stays pending)', async () => {
    const { bus, requester } = await makePair();

    // Publish a well-signed response for a reqId the requester never issued.
    const ghost = await signMessage({
      v: CROSS_DEVICE_PROTOCOL_VERSION,
      type: 'SIGN_RESPONSE',
      reqId: 'never-issued',
      fromDeviceId: approverId,
      decision: 'approved',
      witnessSetCbor: 'w',
      nonce: 'ng',
      createdAt: 1000,
    }, approverKp.privKeyHex);
    bus.publish(ghost as CrossDeviceMessage);

    const pending = requester.requestSignature({
      unsignedCbor: 'cbor',
      intent: 'Swap',
      stakeAddress: 'stake1',
      ttlMs: 50,
    });
    // The ghost must not resolve our real request; only ttl expiry (below) does.
    const result = await pending; // will reject via ttl since no valid response arrives
    expect(result.decision).toBe('rejected');
    requester.dispose();
  });
});

describe('crossDeviceSigning ttl', () => {
  it('rejects the requester promise when the ttl elapses with no response', async () => {
    let clock = 1000;
    const { requester } = await makePair(() => clock);

    const p = requester.requestSignature({
      unsignedCbor: 'cbor',
      intent: 'Swap',
      stakeAddress: 'stake1',
      ttlMs: 30,
    });
    // No approver handler wired, so nothing responds; ttl timer fires.
    const result = await p;
    expect(result.decision).toBe('rejected');
    expect(result.reason).toBeDefined();
    clock = 999999;
    requester.dispose();
  });
});
