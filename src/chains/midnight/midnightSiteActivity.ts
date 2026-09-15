/**
 * What a connected site's transaction is doing inside the wallet right now.
 *
 * The DApp Connector sees a site's transaction as three separate calls —
 * per-circuit proving (`getProvingProvider`), balancing
 * (`balanceUnsealedTransaction`) and `submitTransaction` — and until now the
 * only visible trace of any of them was the site's own UI. This module folds
 * those calls into one record the side panel can render as a Prove → Fund →
 * Submit tracker: the background records events from its handlers, the
 * store broadcasts the record, mini-Gero shows it.
 *
 * One record at a time: a new site, or a new transaction after a finished
 * one, replaces the previous record. Pure and chrome-free.
 */

export type SiteActivityStep = 'proving' | 'funding' | 'submitting' | 'submitted' | 'failed';

/** Why a transaction stopped — short codes the panel turns into copy. */
export type SiteFailureReason = 'proof-server' | 'declined' | 'other';

export interface MidnightSiteActivity {
  /** The site's origin, e.g. `https://dareu-preprod.vercel.app`. */
  origin: string;
  step: SiteActivityStep;
  /** When this transaction's first proof request arrived (Unix ms). */
  startedAt: number;
  /** Last event (Unix ms); drives the visibility windows. */
  updatedAt: number;
  circuitsStarted: number;
  circuitsDone: number;
  txId?: string;
  reason?: SiteFailureReason;
  /** Which step the transaction failed in (the stepper marks it). */
  failedAt?: 'proving' | 'funding' | 'submitting';
}

export type SiteActivityEvent =
  | { type: 'prove-start' }
  | { type: 'prove-done' }
  | { type: 'prove-failed'; reason: SiteFailureReason }
  | { type: 'funding' }
  | { type: 'funding-done' }
  | { type: 'funding-failed'; reason: SiteFailureReason }
  | { type: 'submit-start' }
  | { type: 'submitted'; txId?: string }
  | { type: 'submit-failed'; reason: SiteFailureReason };

/** A finished (submitted / failed) record stays on screen this long. */
export const SITE_ACTIVITY_LINGER_MS = 60_000;
/** An in-flight record with no event for this long is treated as abandoned. */
export const SITE_ACTIVITY_STALE_MS = 10 * 60_000;

const TERMINAL: ReadonlySet<SiteActivityStep> = new Set(['submitted', 'failed']);

function fresh(origin: string, now: number): MidnightSiteActivity {
  return { origin, step: 'proving', startedAt: now, updatedAt: now, circuitsStarted: 0, circuitsDone: 0 };
}

/**
 * Fold one connector event into the record. A `prove-start` for a new site,
 * or after a finished transaction, begins a new record; every other event
 * updates the current one (creating it if the panel missed the start, e.g.
 * after a worker restart).
 */
export function reduceSiteActivity(
  prev: MidnightSiteActivity | null,
  origin: string,
  event: SiteActivityEvent,
  now: number,
): MidnightSiteActivity {
  const continues = prev !== null && prev.origin === origin && !TERMINAL.has(prev.step);
  const base: MidnightSiteActivity = continues && prev
    ? { ...prev, updatedAt: now }
    : fresh(origin, now);
  delete base.txId;
  delete base.reason;
  delete base.failedAt;
  switch (event.type) {
    case 'prove-start':
      return { ...base, step: 'proving', circuitsStarted: base.circuitsStarted + 1 };
    case 'prove-done':
      return { ...base, step: 'proving', circuitsDone: Math.min(base.circuitsStarted, base.circuitsDone + 1) };
    case 'prove-failed':
      return { ...base, step: 'failed', reason: event.reason, failedAt: 'proving' };
    case 'funding':
      return { ...base, step: 'funding' };
    case 'funding-done':
      return { ...base, step: 'submitting' };
    case 'funding-failed':
      return { ...base, step: 'failed', reason: event.reason, failedAt: 'funding' };
    case 'submit-start':
      return { ...base, step: 'submitting' };
    case 'submitted':
      return event.txId ? { ...base, step: 'submitted', txId: event.txId } : { ...base, step: 'submitted' };
    case 'submit-failed':
      return { ...base, step: 'failed', reason: event.reason, failedAt: 'submitting' };
    default:
      return base;
  }
}

/** Whether the card should still be on screen at `now`. */
export function isSiteActivityVisible(activity: MidnightSiteActivity | null, now: number): boolean {
  if (!activity) return false;
  const age = now - activity.updatedAt;
  return TERMINAL.has(activity.step) ? age < SITE_ACTIVITY_LINGER_MS : age < SITE_ACTIVITY_STALE_MS;
}

const STEPS: ReadonlySet<string> = new Set<SiteActivityStep>(['proving', 'funding', 'submitting', 'submitted', 'failed']);
const REASONS: ReadonlySet<string> = new Set<SiteFailureReason>(['proof-server', 'declined', 'other']);

/** Persisted record; only the exact shape survives a cold start. */
export function hydrateSiteActivity(stored: unknown): MidnightSiteActivity | null {
  if (!stored || typeof stored !== 'object') return null;
  const s = stored as Record<string, unknown>;
  if (typeof s['origin'] !== 'string' || !s['origin']) return null;
  if (typeof s['step'] !== 'string' || !STEPS.has(s['step'])) return null;
  if (typeof s['startedAt'] !== 'number' || typeof s['updatedAt'] !== 'number') return null;
  if (typeof s['circuitsStarted'] !== 'number' || typeof s['circuitsDone'] !== 'number') return null;
  const out: MidnightSiteActivity = {
    origin: s['origin'],
    step: s['step'] as SiteActivityStep,
    startedAt: s['startedAt'],
    updatedAt: s['updatedAt'],
    circuitsStarted: s['circuitsStarted'],
    circuitsDone: s['circuitsDone'],
  };
  if (typeof s['txId'] === 'string' && s['txId']) out.txId = s['txId'];
  if (typeof s['reason'] === 'string' && REASONS.has(s['reason'])) out.reason = s['reason'] as SiteFailureReason;
  if (s['failedAt'] === 'proving' || s['failedAt'] === 'funding' || s['failedAt'] === 'submitting') out.failedAt = s['failedAt'];
  return out;
}
