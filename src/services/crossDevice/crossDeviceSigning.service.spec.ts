import { describe, it, expect, vi } from 'vitest';
import { createCrossDeviceSigning, type SignDecision } from './crossDeviceSigning.service';
import { generateDeviceKeypair, deviceIdFromPubKey } from './deviceIdentity';
import { signMessage, verifyMessage } from './envelope';
import { isPairAck, type CrossDeviceMessage, type SignRequest, type SignResponse, type PairConfirm, type PairAck } from './protocol';

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

// QR pairing inbound (PAIR_CONFIRM) — the auth boundary before the wallet-proof check.
const phoneKp = generateDeviceKeypair((n) => new Uint8Array(n).fill(44));
const desktopKp = generateDeviceKeypair((n) => new Uint8Array(n).fill(55));
const phoneId = 'ios-phone-uuid';
const desktopId = deviceIdFromPubKey(desktopKp.pubKeyHex);
const flush = () => new Promise((r) => setTimeout(r, 30)); // let ed25519 verifyAsync settle

function makeDesktop() {
  const bus = makeBus();
  const onPairConfirm = vi.fn();
  const desktop = createCrossDeviceSigning({
    transport: bus.makeTransport(),
    identity: { deviceId: desktopId, privKeyHex: desktopKp.privKeyHex },
    resolvePubKey: async () => null, // the phone is NOT in the registry (pairing establishes trust)
    now: () => 1000,
    newId: () => 'x',
    isRequesterTrusted: () => false, // even fully UNtrusted...
    isResponderTrusted: () => false,
    onPairConfirm,
  });
  return { bus, onPairConfirm, desktop };
}

async function signedConfirm(overrides: Partial<Omit<PairConfirm, 'sig'>> = {}): Promise<PairConfirm> {
  const frame: Omit<PairConfirm, 'sig'> = {
    type: 'PAIR_CONFIRM',
    from: phoneId,
    pubKey: phoneKp.pubKeyHex,
    to: desktopId,
    nonce: 'n1',
    stakeAddress: 'stake1uxyz',
    proof: { coseSign1: 'a0', coseKey: 'a1', stakeAddress: 'stake1uxyz' },
    label: 'iPhone',
    platform: 'ios',
    hasSigningKey: true,
    ...overrides,
  };
  return signMessage<PairConfirm>(frame, phoneKp.privKeyHex);
}

describe('PAIR_CONFIRM inbound (QR pairing auth boundary)', () => {
  it('delivers a valid confirm to onPairConfirm — verified via frame.pubKey, UNGATED by trust', async () => {
    const { bus, onPairConfirm, desktop } = makeDesktop();
    bus.publish(await signedConfirm());
    await flush();
    expect(onPairConfirm).toHaveBeenCalledTimes(1);
    expect(onPairConfirm.mock.calls[0][0]).toMatchObject({ from: phoneId, to: desktopId, nonce: 'n1' });
    desktop.dispose();
  });

  it('drops a confirm whose claimed pubKey did not sign it (frame.pubKey swap)', async () => {
    const { bus, onPairConfirm, desktop } = makeDesktop();
    const frame = await signedConfirm();
    bus.publish({ ...frame, pubKey: approverKp.pubKeyHex }); // claim a different key than what signed
    await flush();
    expect(onPairConfirm).not.toHaveBeenCalled();
    desktop.dispose();
  });

  it('drops a confirm with a tampered subject field (nonce) — sig no longer matches', async () => {
    const { bus, onPairConfirm, desktop } = makeDesktop();
    const frame = await signedConfirm();
    bus.publish({ ...frame, nonce: 'n2' });
    await flush();
    expect(onPairConfirm).not.toHaveBeenCalled();
    desktop.dispose();
  });

  it('drops a confirm addressed to a DIFFERENT desktop (to != self)', async () => {
    const { bus, onPairConfirm, desktop } = makeDesktop();
    bus.publish(await signedConfirm({ to: 'some-other-desktop' }));
    await flush();
    expect(onPairConfirm).not.toHaveBeenCalled();
    desktop.dispose();
  });

  it('ignores our own echoed confirm (from == self)', async () => {
    const { bus, onPairConfirm, desktop } = makeDesktop();
    // A confirm whose `from` is the desktop itself, correctly signed by the desktop key.
    const selfFrame: Omit<PairConfirm, 'sig'> = {
      type: 'PAIR_CONFIRM', from: desktopId, pubKey: desktopKp.pubKeyHex, to: desktopId,
      nonce: 'n1', stakeAddress: 'stake1uxyz',
      proof: { coseSign1: 'a0', coseKey: 'a1', stakeAddress: 'stake1uxyz' },
    };
    bus.publish(await signMessage<PairConfirm>(selfFrame, desktopKp.privKeyHex));
    await flush();
    expect(onPairConfirm).not.toHaveBeenCalled();
    desktop.dispose();
  });

  it('sendPairAck emits a PAIR_ACK signed by the desktop over from|to|nonce', async () => {
    const { bus, desktop } = makeDesktop();
    const captured: PairAck[] = [];
    bus.makeTransport().onMessage((raw) => { if (isPairAck(raw)) captured.push(raw); });
    await desktop.sendPairAck(phoneId, 'nonce1');
    await flush();
    expect(captured).toHaveLength(1);
    // from = desktop's own id (the QR deviceId); phone verifies vs the pinned desktop key.
    expect(captured[0]).toMatchObject({ type: 'PAIR_ACK', from: desktopId, to: phoneId, nonce: 'nonce1' });
    expect(await verifyMessage(captured[0], desktopKp.pubKeyHex)).toBe(true);
    desktop.dispose();
  });
});

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

describe('crossDeviceSigning wake / re-request (WAKE_PENDING)', () => {
  // A transport that captures outgoing SIGN_REQUESTs and does NOT auto-deliver them
  // (simulating an offline target: the relay would return WAKE_PENDING, not deliver).
  // Responses/WAKE_PENDING are injected manually via publish().
  function makeManualBus() {
    const listeners = new Set<(raw: unknown) => void>();
    const sent: SignRequest[] = [];
    return {
      sent,
      publish: (m: unknown) => { for (const l of [...listeners]) l(m); },
      transport: {
        send: (msg: CrossDeviceMessage) => { if (msg.type === 'SIGN_REQUEST') sent.push(msg as SignRequest); },
        onMessage: (cb: (raw: unknown) => void) => { listeners.add(cb); return () => listeners.delete(cb); },
      },
    };
  }

  it('pauses the ttl on WAKE_PENDING, re-issues a fresh request when the target reconnects', async () => {
    const bus = makeManualBus();
    let approverOnline = false;
    const requester = createCrossDeviceSigning({
      transport: bus.transport,
      identity: { deviceId: requesterId, privKeyHex: requesterKp.privKeyHex },
      resolvePubKey: async (id) => (id === approverId ? (approverOnline ? approverKp.pubKeyHex : null) : null),
      now: () => 1000,
      newId: (() => { let c = 0; return () => `w-${c++}`; })(),
      wakePollMs: 5,
      wakeWindowMs: 500,
    });

    let settled: SignDecision | null = null;
    const resultP = requester.requestSignature({ unsignedCbor: '84a4', stakeAddress: 'stake1', to: approverId, ttlMs: 60 });
    void resultP.then((d) => { settled = d; });

    await new Promise((r) => setTimeout(r, 15));
    expect(bus.sent.length).toBe(1);
    expect(bus.sent[0].to).toBe(approverId);
    const firstReqId = bus.sent[0].reqId;

    // Relay: target offline -> WAKE_PENDING must PAUSE the 60ms ttl.
    bus.publish({ type: 'WAKE_PENDING', reqId: firstReqId, to: approverId });
    await new Promise((r) => setTimeout(r, 90)); // past the original ttl
    expect(settled).toBeNull();            // not rejected: ttl was paused
    expect(bus.sent.length).toBe(1);       // not re-issued: still offline

    // Target reconnects -> poll re-issues a FRESH request.
    approverOnline = true;
    await new Promise((r) => setTimeout(r, 30));
    expect(bus.sent.length).toBe(2);
    const secondReqId = bus.sent[1].reqId;
    expect(secondReqId).not.toBe(firstReqId);

    // Approve the fresh request -> requester resolves.
    const res = await signMessage<SignResponse>(
      { type: 'SIGN_RESPONSE', reqId: secondReqId, nonce: 'rn', to: requesterId, deviceId: approverId, decision: 'approved', witnessSetCbor: 'a100' },
      approverKp.privKeyHex,
    );
    bus.publish(res);
    const result = await resultP;
    expect(result.decision).toBe('approved');
    expect(result.witnessSetCbor).toBe('a100');
    requester.dispose();
  });

  it('rejects with wake_timeout if the target never reconnects', async () => {
    const bus = makeManualBus();
    const requester = createCrossDeviceSigning({
      transport: bus.transport,
      identity: { deviceId: requesterId, privKeyHex: requesterKp.privKeyHex },
      resolvePubKey: async () => null, // never comes online
      now: () => 1000,
      newId: (() => { let c = 0; return () => `t-${c++}`; })(),
      wakePollMs: 5,
      wakeWindowMs: 40,
    });

    const resultP = requester.requestSignature({ unsignedCbor: '84a4', stakeAddress: 'stake1', to: approverId, ttlMs: 60 });
    await new Promise((r) => setTimeout(r, 10));
    bus.publish({ type: 'WAKE_PENDING', reqId: bus.sent[0].reqId, to: approverId });

    const result = await resultP;
    expect(result.decision).toBe('rejected');
    expect(result.reason).toBe('wake_timeout');
    requester.dispose();
  });

  it('dispose() during a wake-wait stops the poll and resolves disposed', async () => {
    const bus = makeManualBus();
    let online = false;
    const requester = createCrossDeviceSigning({
      transport: bus.transport,
      identity: { deviceId: requesterId, privKeyHex: requesterKp.privKeyHex },
      resolvePubKey: async (id) => (id === approverId && online ? approverKp.pubKeyHex : null),
      now: () => 1000,
      newId: (() => { let c = 0; return () => `d-${c++}`; })(),
      wakePollMs: 5,
      wakeWindowMs: 1000,
    });
    const resultP = requester.requestSignature({ unsignedCbor: '84a4', stakeAddress: 'stake1', to: approverId, ttlMs: 60 });
    await new Promise((r) => setTimeout(r, 10));
    bus.publish({ type: 'WAKE_PENDING', reqId: bus.sent[0].reqId, to: approverId });
    await new Promise((r) => setTimeout(r, 10)); // now in the wake-wait, polling
    const before = bus.sent.length;

    requester.dispose();
    const result = await resultP;
    expect(result.reason).toBe('disposed');

    // Target coming online AFTER dispose must not trigger a stray re-issue.
    online = true;
    await new Promise((r) => setTimeout(r, 30));
    expect(bus.sent.length).toBe(before);
  });

  it('does not double-issue when the registry lookup is slow (in-flight guard)', async () => {
    const bus = makeManualBus();
    const requester = createCrossDeviceSigning({
      transport: bus.transport,
      identity: { deviceId: requesterId, privKeyHex: requesterKp.privKeyHex },
      // Slow lookup that returns online: many poll ticks fire during one await.
      resolvePubKey: async (id) => { await new Promise((r) => setTimeout(r, 25)); return id === approverId ? approverKp.pubKeyHex : null; },
      now: () => 1000,
      newId: (() => { let c = 0; return () => `g-${c++}`; })(),
      wakePollMs: 5,
      wakeWindowMs: 1000,
    });
    const resultP = requester.requestSignature({ unsignedCbor: '84a4', stakeAddress: 'stake1', to: approverId, ttlMs: 500 });
    await new Promise((r) => setTimeout(r, 10));
    bus.publish({ type: 'WAKE_PENDING', reqId: bus.sent[0].reqId, to: approverId });
    await new Promise((r) => setTimeout(r, 90)); // several poll ticks overlap the slow resolve

    expect(bus.sent.length).toBe(2); // exactly one re-issue, not several

    const res = await signMessage<SignResponse>(
      { type: 'SIGN_RESPONSE', reqId: bus.sent[1].reqId, nonce: 'n', to: requesterId, deviceId: approverId, decision: 'approved', witnessSetCbor: 'a1' },
      approverKp.privKeyHex,
    );
    bus.publish(res);
    await resultP;
    requester.dispose();
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
