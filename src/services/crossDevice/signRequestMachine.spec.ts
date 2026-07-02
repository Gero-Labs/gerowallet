import { describe, it, expect } from 'vitest';
import {
  createRequest,
  applyResponse,
  expireStale,
  type MachineState,
} from './signRequestMachine';
import type { SignRequest, SignResponse } from './protocol';

// `now` is milliseconds; expiresAt is unix SECONDS.
function makeReq(overrides: Partial<SignRequest> = {}): SignRequest {
  return {
    type: 'SIGN_REQUEST',
    reqId: 'req-1',
    nonce: 'n1',
    from: 'dev1',
    stakeAddress: 'stake1',
    unsignedCbor: '84a4',
    intent: 'Swap',
    expiresAt: 6, // expires at 6000 ms
    sig: 'ab'.repeat(64),
    ...overrides,
  };
}

function makeRes(overrides: Partial<SignResponse> = {}): SignResponse {
  return {
    type: 'SIGN_RESPONSE',
    reqId: 'req-1',
    nonce: 'n2',
    deviceId: 'dev2',
    decision: 'approved',
    witnessSetCbor: 'a100',
    sig: 'cd'.repeat(64),
    ...overrides,
  };
}

const empty: MachineState = { byId: {}, seen: [] };

describe('createRequest', () => {
  it('adds a pending request keyed by reqId', () => {
    const state = createRequest(empty, makeReq());
    expect(state.byId['req-1'].status).toBe('pending');
    expect(state.byId['req-1'].request.unsignedCbor).toBe('84a4');
    expect(state.seen).toContain('req-1:n1');
  });

  it('ignores a duplicate (reqId:nonce) — replay safety', () => {
    const once = createRequest(empty, makeReq());
    const twice = createRequest(once, makeReq({ intent: 'MALICIOUS SWAP' }));
    expect(twice.byId['req-1'].request.intent).toBe('Swap');
    expect(twice.seen.filter((s) => s === 'req-1:n1')).toHaveLength(1);
  });

  it('does not mutate the input state', () => {
    createRequest(empty, makeReq());
    expect(empty.byId).toEqual({});
    expect(empty.seen).toEqual([]);
  });
});

describe('applyResponse', () => {
  it('approves a pending request within ttl', () => {
    const state = createRequest(empty, makeReq());
    const next = applyResponse(state, makeRes(), 3000); // 3000 ms < 6000 ms expiry
    expect(next.byId['req-1'].status).toBe('approved');
  });

  it('records a rejection with reason', () => {
    const state = createRequest(empty, makeReq());
    const next = applyResponse(
      state,
      makeRes({ decision: 'rejected', witnessSetCbor: undefined, reason: 'user_declined' }),
      3000,
    );
    expect(next.byId['req-1'].status).toBe('rejected');
  });

  it('cannot approve at/after expiry (expires instead)', () => {
    const state = createRequest(empty, makeReq());
    const next = applyResponse(state, makeRes(), 7000); // 7000 ms >= 6000 ms
    expect(next.byId['req-1'].status).toBe('expired');
  });

  it('ignores a response for an unknown reqId', () => {
    const state = createRequest(empty, makeReq());
    const next = applyResponse(state, makeRes({ reqId: 'ghost' }), 3000);
    expect(next.byId['ghost']).toBeUndefined();
    expect(next.byId['req-1'].status).toBe('pending');
  });

  it('ignores a second response after the first decision (no re-decide)', () => {
    const state = createRequest(empty, makeReq());
    const approved = applyResponse(state, makeRes(), 3000);
    const attemptFlip = applyResponse(
      approved,
      makeRes({ decision: 'rejected', witnessSetCbor: undefined }),
      3500,
    );
    expect(attemptFlip.byId['req-1'].status).toBe('approved');
  });
});

describe('expireStale', () => {
  it('flips only overdue pendings to expired', () => {
    let state = createRequest(empty, makeReq({ reqId: 'a', nonce: 'na', expiresAt: 2 }));
    state = createRequest(state, makeReq({ reqId: 'b', nonce: 'nb', expiresAt: 10 }));
    const next = expireStale(state, 5000); // a expires 2000 (overdue), b at 10000 (fresh)
    expect(next.byId['a'].status).toBe('expired');
    expect(next.byId['b'].status).toBe('pending');
  });

  it('leaves already-decided requests untouched', () => {
    const created = createRequest(empty, makeReq());
    const approved = applyResponse(created, makeRes(), 3000);
    const next = expireStale(approved, 999999);
    expect(next.byId['req-1'].status).toBe('approved');
  });
});
