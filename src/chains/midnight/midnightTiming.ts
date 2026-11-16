// Stage timings for Midnight transaction builds, to see where a slow build
// spends its time: one `console.debug` line (DevTools "Verbose") per stage group.
//
// PRIVACY: durations and counts only. Never keys, hex, addresses, amounts,
// nullifier prefixes or URLs with credentials.

import type { DustLightTransport } from './midnightDustLightSync';

export type MidnightTimingExtra = Record<string, number | string | boolean | undefined>;

export interface MidnightTimer {
  /** Time `fn` as `stage` (repeated stages add up). */
  time<T>(stage: string, fn: () => Promise<T>): Promise<T>;
  /** Record the time since the previous lap (or the start) as `stage`. */
  lap(stage: string): void;
  /** Add counts or labels to the summary line. */
  note(extra: MidnightTimingExtra): void;
  /** Log the summary line (once). */
  done(outcome?: 'ok' | 'failed'): void;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function midnightTimer(scope: string): MidnightTimer {
  const start = now();
  let last = start;
  let logged = false;
  const stages: Record<string, number> = {};
  const extras: MidnightTimingExtra = {};
  const add = (stage: string, ms: number) => { stages[stage] = (stages[stage] ?? 0) + Math.round(ms); };
  return {
    async time(stage, fn) {
      const begin = now();
      try { return await fn(); } finally { add(stage, now() - begin); last = now(); }
    },
    lap(stage) {
      const at = now();
      add(stage, at - last);
      last = at;
    },
    note(extra) { Object.assign(extras, extra); },
    done(outcome = 'ok') {
      if (logged) return;
      logged = true;
      console.debug(`[midnight-timing] ${scope}`, { outcome, totalMs: Math.round(now() - start), ...stages, ...extras });
    },
  };
}

/** Wrap a DUST light-sync transport to time and count its requests on `timer`. */
export function timedDustTransport(transport: DustLightTransport, timer: MidnightTimer): DustLightTransport {
  let spendRequests = 0;
  let prefixScans = 0;
  let commitmentRequests = 0;
  return {
    snapshot: address => timer.time('dustSnapshot', () => transport.snapshot(address)),
    spends: (block, prefixes, fromBlock, toBlock) => {
      spendRequests++;
      if (fromBlock === 0) prefixScans++;
      timer.note({ spendRequests, prefixScans, tipHeight: block.height });
      return timer.time('dustSpends', () => transport.spends(block, prefixes, fromBlock, toBlock));
    },
    commitments: (block, ranges) => {
      commitmentRequests++;
      timer.note({ commitmentRequests });
      return timer.time('dustCommitments', () => transport.commitments(block, ranges));
    },
  };
}
