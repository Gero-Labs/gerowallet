// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  SITE_ACTIVITY_LINGER_MS,
  SITE_ACTIVITY_STALE_MS,
  hydrateSiteActivity,
  isSiteActivityVisible,
  reduceSiteActivity,
} from './midnightSiteActivity';
import type { MidnightSiteActivity, SiteActivityEvent } from './midnightSiteActivity';

const ORIGIN = 'https://dapp.example';
const T0 = 1_000_000;

function play(events: Array<[SiteActivityEvent, number?]>, origin = ORIGIN, start: MidnightSiteActivity | null = null) {
  let state = start;
  let t = T0;
  for (const [event, at] of events) {
    t = at ?? t + 1000;
    state = reduceSiteActivity(state, origin, event, t);
  }
  return state!;
}

describe('reduceSiteActivity', () => {
  it('starts a record on the first proof and counts circuits', () => {
    const a = play([[{ type: 'prove-start' }], [{ type: 'prove-start' }], [{ type: 'prove-done' }]]);
    expect(a).toMatchObject({ origin: ORIGIN, step: 'proving', startedAt: T0 + 1000, circuitsStarted: 2, circuitsDone: 1 });
    expect(a.updatedAt).toBe(T0 + 3000);
  });

  it('never counts more done than started', () => {
    const a = play([[{ type: 'prove-start' }], [{ type: 'prove-done' }], [{ type: 'prove-done' }]]);
    expect(a.circuitsDone).toBe(1);
  });

  it('walks Prove → Fund → Submit → submitted with the tx id', () => {
    const a = play([
      [{ type: 'prove-start' }], [{ type: 'prove-done' }],
      [{ type: 'funding' }], [{ type: 'funding-done' }],
      [{ type: 'submit-start' }], [{ type: 'submitted', txId: 'abc' }],
    ]);
    expect(a.step).toBe('submitted');
    expect(a.txId).toBe('abc');
    expect(a.startedAt).toBe(T0 + 1000);
  });

  it('marks funding-done as submitting until the site submits', () => {
    expect(play([[{ type: 'prove-start' }], [{ type: 'funding' }], [{ type: 'funding-done' }]]).step).toBe('submitting');
  });

  it('records each failure with its reason', () => {
    expect(play([[{ type: 'prove-start' }], [{ type: 'prove-failed', reason: 'proof-server' }]])).toMatchObject({ step: 'failed', reason: 'proof-server', failedAt: 'proving' });
    expect(play([[{ type: 'funding' }], [{ type: 'funding-failed', reason: 'declined' }]])).toMatchObject({ step: 'failed', reason: 'declined', failedAt: 'funding' });
    expect(play([[{ type: 'submit-start' }], [{ type: 'submit-failed', reason: 'other' }]])).toMatchObject({ step: 'failed', reason: 'other', failedAt: 'submitting' });
  });

  it('starts over after a finished transaction and for another site', () => {
    const done = play([[{ type: 'prove-start' }], [{ type: 'submitted', txId: 'x' }]]);
    const next = reduceSiteActivity(done, ORIGIN, { type: 'prove-start' }, T0 + 9000);
    expect(next).toMatchObject({ step: 'proving', startedAt: T0 + 9000, circuitsStarted: 1, circuitsDone: 0 });
    expect(next.txId).toBeUndefined();

    const inFlight = play([[{ type: 'prove-start' }], [{ type: 'prove-start' }]]);
    const other = reduceSiteActivity(inFlight, 'https://other.example', { type: 'prove-start' }, T0 + 9000);
    expect(other).toMatchObject({ origin: 'https://other.example', circuitsStarted: 1 });
  });

  it('creates a record when the start was missed (worker restart)', () => {
    expect(reduceSiteActivity(null, ORIGIN, { type: 'funding' }, T0)).toMatchObject({ origin: ORIGIN, step: 'funding', startedAt: T0 });
  });
});

describe('isSiteActivityVisible', () => {
  it('keeps an in-flight record until it goes stale', () => {
    const a = play([[{ type: 'prove-start' }]]);
    expect(isSiteActivityVisible(a, a.updatedAt + SITE_ACTIVITY_STALE_MS - 1)).toBe(true);
    expect(isSiteActivityVisible(a, a.updatedAt + SITE_ACTIVITY_STALE_MS)).toBe(false);
  });

  it('lets a finished record linger briefly', () => {
    const a = play([[{ type: 'prove-start' }], [{ type: 'submitted' }]]);
    expect(isSiteActivityVisible(a, a.updatedAt + SITE_ACTIVITY_LINGER_MS - 1)).toBe(true);
    expect(isSiteActivityVisible(a, a.updatedAt + SITE_ACTIVITY_LINGER_MS)).toBe(false);
    expect(isSiteActivityVisible(null, T0)).toBe(false);
  });
});

describe('hydrateSiteActivity', () => {
  const stored = { origin: ORIGIN, step: 'funding', startedAt: 1, updatedAt: 2, circuitsStarted: 2, circuitsDone: 2 };

  it('keeps a well-formed record, with optional tx id and reason', () => {
    expect(hydrateSiteActivity(stored)).toEqual(stored);
    expect(hydrateSiteActivity({ ...stored, step: 'submitted', txId: 'x' })).toMatchObject({ txId: 'x' });
    expect(hydrateSiteActivity({ ...stored, step: 'failed', reason: 'declined' })).toMatchObject({ reason: 'declined' });
    expect(hydrateSiteActivity({ ...stored, reason: 'nope' })?.reason).toBeUndefined();
  });

  it('drops anything else', () => {
    expect(hydrateSiteActivity(null)).toBeNull();
    expect(hydrateSiteActivity({ ...stored, step: 'done' })).toBeNull();
    expect(hydrateSiteActivity({ ...stored, origin: '' })).toBeNull();
    expect(hydrateSiteActivity({ ...stored, circuitsDone: '2' })).toBeNull();
  });
});
