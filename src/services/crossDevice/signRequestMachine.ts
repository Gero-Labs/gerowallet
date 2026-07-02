// Cross-device signing bridge — pure sign-request state machine.
//
// Tracks the requester's view of outstanding sign requests. It is a pure
// reducer: no timers, no Date.now inside — the caller passes `now`. This makes
// replay-safety and ttl behavior fully deterministic and testable.
//
// Security invariants encoded here (see plan section 4):
//   - Replay safety: a duplicate (reqId:nonce) is ignored; `seen` records used keys.
//   - ttl enforcement: a request whose ttl has passed cannot transition to
//     approved; it goes/stays expired.
//   - Original request preserved: the untouched SignRequest is kept so the
//     requester can later apply the witness to the ORIGINAL unsignedCbor and
//     re-verify the tx body hash (invariant 5, follow-up).

import type { SignRequest, SignResponse } from './protocol';

export type ReqStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface PendingReq {
  reqId: string;
  nonce: string;
  request: SignRequest;
  status: ReqStatus;
}

export interface MachineState {
  byId: Record<string, PendingReq>;
  seen: string[]; // used (reqId:nonce) keys, for replay detection
}

function seenKey(reqId: string, nonce: string): string {
  return `${reqId}:${nonce}`;
}

// `now` is caller-supplied milliseconds (Date.now()); expiresAt is unix seconds.
function isExpired(req: SignRequest, now: number): boolean {
  return now >= req.expiresAt * 1000;
}

/**
 * Register a new sign request as pending. Deduped by (reqId:nonce): a replay of
 * an already-seen key returns the state unchanged, preserving the original
 * request. Does not mutate the input state.
 */
export function createRequest(state: MachineState, req: SignRequest): MachineState {
  const key = seenKey(req.reqId, req.nonce);
  if (state.seen.includes(key)) {
    return state;
  }
  return {
    byId: {
      ...state.byId,
      [req.reqId]: {
        reqId: req.reqId,
        nonce: req.nonce,
        request: req,
        status: 'pending',
      },
    },
    seen: [...state.seen, key],
  };
}

/**
 * Apply an incoming SIGN_RESPONSE. Transitions a pending request to approved or
 * rejected iff it has not expired; if the ttl has passed the request goes to
 * expired instead. Responses for unknown reqIds or already-decided requests are
 * ignored. Does not mutate the input state.
 */
export function applyResponse(
  state: MachineState,
  res: SignResponse,
  now: number,
): MachineState {
  const existing = state.byId[res.reqId];
  if (!existing || existing.status !== 'pending') {
    return state;
  }
  const nextStatus: ReqStatus = isExpired(existing.request, now)
    ? 'expired'
    : res.decision === 'approved'
      ? 'approved'
      : 'rejected';
  return {
    ...state,
    byId: {
      ...state.byId,
      [res.reqId]: { ...existing, status: nextStatus },
    },
  };
}

/**
 * Flip any pending requests whose ttl has passed to expired. Leaves
 * already-decided requests untouched. Does not mutate the input state.
 */
export function expireStale(state: MachineState, now: number): MachineState {
  let changed = false;
  const byId: Record<string, PendingReq> = {};
  for (const [id, entry] of Object.entries(state.byId)) {
    if (entry.status === 'pending' && isExpired(entry.request, now)) {
      byId[id] = { ...entry, status: 'expired' };
      changed = true;
    } else {
      byId[id] = entry;
    }
  }
  return changed ? { ...state, byId } : state;
}
