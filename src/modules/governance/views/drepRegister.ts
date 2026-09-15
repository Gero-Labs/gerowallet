/**
 * The whole DRep register, loaded once so the directory's columns can order it.
 *
 * WHY THIS EXISTS
 * ---------------
 * The directory used to fetch one page of 15 and sort those 15 client side. A
 * header reading "Voting power ↓" therefore meant "the 15 rows you happen to be
 * looking at", which is a lie told by a control that looks authoritative. Two
 * different fixes are needed, because the columns split in two:
 *
 *  - Voting power and delegators are SERVER-sortable. `sortDirectory`'s
 *    `SERVER_SORT_BY` pushes them to `/api/dreps` as `sort_by`, the server orders
 *    all 1,682 rows, and normal paging walks that global order. No extra bytes.
 *  - Participation, rationale rate and last-vote recency are computed CLIENT side
 *    from each record's `votes[]` (see `drepStats`). gero-backend cannot order by
 *    them at all. The only truthful way to order the register by a figure the
 *    server does not hold is to hold the register.
 *
 * THE MEASUREMENT (mainnet, api.gerowallet.io, 2026-08-24)
 * -------------------------------------------------------
 * Register:        1,682 DReps, 30,172 vote rows, 80,151 delegator rows.
 * `per_page`:      honoured up to at least 2,000 — no server clamp observed.
 * One walk @ 500:  4 requests, 10.74 MB gzipped on the wire (30.73 MB decoded),
 *                  1.9 s with pages 2..4 in parallel, 3.1 s strictly sequential.
 * One page @ 15:   0.32 MB gzipped, 0.34 s — the status quo, for comparison.
 * Single request:  `per_page=2000` returns all 1,682 in one response but takes
 *                  3.8–7.2 s, i.e. SLOWER than four smaller pages. Hence the walk.
 * Retained heap:   34.1 MB for the projection below (measured with --expose-gc).
 *                  Keeping the raw records instead costs roughly three times that,
 *                  because 68% of the payload is delegator identity and vote
 *                  transaction hashes that no directory column reads.
 *
 * THE CHOICE
 * ----------
 * 10.74 MB and ~2 s, once per chain/network, behind a visible loading state, is a
 * real cost but not an impractical one, and it buys the page's primary ordering.
 * It is also no longer this page's cost alone: `drepNames.ts` used to walk the
 * same endpoint on the same budget merely to label rows on the positions tab, and
 * now derives its index from this register instead, so a session that opens both
 * surfaces pays once rather than twice. So the directory loads the whole register for
 * client-computed sorts (which includes the DEFAULT, participation) and pages it
 * in memory. Paging then costs nothing: page 3 is rows 31–45 of the global order,
 * not a fresh query against an unordered server page.
 *
 * WHAT IS NOT ASSUMED
 * -------------------
 *  - That `sort_by` is validated upstream. It is NOT: `sort_by=participation` and
 *    `sort_by=garbage_key` both return HTTP 200 and the server's DEFAULT order,
 *    silently. A pass-through of the client's sort key would therefore render an
 *    arbitrary order under a header claiming to be sorted. `SERVER_SORT_BY` is an
 *    allow-list for exactly that reason.
 *  - That the walk succeeds. `complete: false` comes back whenever a page failed
 *    or the request budget ran out, and the caller must then say the order is
 *    page-local rather than imply a register-wide one.
 *  - That the ask was honoured. Page count prefers the server's own
 *    `meta.total_pages`, and otherwise divides by the rows page 1 ACTUALLY
 *    returned, never by the size requested — see `pageCount`.
 */

import blockchainApi from '@/api/blockchain-api';
import type { DRepRecord } from '@/shared/utils/drepStats';

/** Rows asked for per request. What the server returns is its call — see `pageCount`. */
export const REGISTER_PAGE_SIZE = 500;

/**
 * Requests one walk may cost.
 *
 * Four pages covers mainnet's 1,682 DReps at the size above, so eight leaves
 * ~2.4x headroom. Past the cap the register is INCOMPLETE and says so, so growth
 * degrades the label rather than quietly downloading tens of megabytes more.
 *
 * It was six while `drepNames.ts` ran its own eight-page walk. Now that both
 * surfaces share this one, six would have quietly cost the name index two pages'
 * worth of rows — so the budget is the HIGHER of the two, never the tighter.
 *
 * Six was chosen to keep a page the user waits on short, and that reasoning does
 * not survive the merge: what governs latency is the pages actually FETCHED
 * (four, at the observed page size), not the cap, which only binds when the
 * register turns out far larger than measured or the server clamps its page
 * size. In that case the register is incomplete either way, and being two pages
 * closer to whole is worth two requests.
 */
export const MAX_REGISTER_PAGES = 8;

/** How long a loaded register stays fresh. DRep figures move per epoch, not per second. */
export const REGISTER_TTL_MS = 5 * 60 * 1000;

export interface DRepRegister {
  records: DRepRecord[];
  /**
   * Whether `records` is the WHOLE matching set. False means a page failed or the
   * budget ran out, and no caller may describe the order as register-wide.
   */
  complete: boolean;
  /** The server's own count of matching DReps, or null when it sent none. */
  totalItems: number | null;
  fetchedAt: number;
}

/** The subset of a `/api/dreps` row every directory surface actually reads. */
interface RawRecord {
  [key: string]: unknown;
  votes?: unknown;
  delegators?: unknown;
}

/**
 * Drop the two thirds of each record nothing renders.
 *
 * Measured: 30.73 MB of raw JSON becomes 10.59 MB, and retained heap lands at
 * 34.1 MB instead of roughly 100 MB. The fields kept are exactly those read by
 * `drepStats` (identity, `amount`, `active`, `registered`, vote choice/rationale/
 * time), `useDelegationHealth` (`expires_epoch_no`, the same vote fields),
 * `drepView` (`metadata`, `url`, `hash`, `display_name`, and `epoch_no`/`amount`
 * on delegators for `epochInflow`) and the delegate handoff (`hex`, `has_script`,
 * and both array LENGTHS). Nothing else on the wire is read by anything.
 *
 * Dropping a field is therefore a decision to be made HERE and nowhere else: a
 * surface that later needs `vote_tx_hash` must add it back rather than quietly
 * read `undefined`.
 */
export function projectRecord(raw: unknown): DRepRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as RawRecord;
  const votes = Array.isArray(row.votes) ? row.votes : [];
  const delegators = Array.isArray(row.delegators) ? row.delegators : [];

  return {
    drep_id: row['drep_id'] as string | null,
    hex: row['hex'] as string | null,
    has_script: row['has_script'] as boolean | null,
    registered: row['registered'] as boolean | null,
    active: row['active'] as boolean | null,
    expires_epoch_no: row['expires_epoch_no'] as number | null,
    amount: row['amount'] as string | null,
    url: row['url'] as string | null,
    hash: row['hash'] as string | null,
    display_name: row['display_name'] as string | null,
    metadata: row['metadata'] as DRepRecord['metadata'],
    votes: votes.map(vote => {
      const entry = (vote ?? {}) as Record<string, unknown>;
      return {
        proposal_id: entry['proposal_id'] as string | null,
        vote: entry['vote'] as string | null,
        meta_url: entry['meta_url'] as string | null,
        block_time: entry['block_time'] as number | null,
      };
    }),
    // Only the two fields `epochInflow` reads. The count survives as the length.
    delegators: delegators.map(delegator => {
      const entry = (delegator ?? {}) as Record<string, unknown>;
      return { epoch_no: entry['epoch_no'] as number | null, amount: entry['amount'] as string | null };
    }),
  };
}

/**
 * How many pages the matching set has, from whichever count the server sent.
 *
 * `stride` is the rows page 1 CAME BACK with, never `REGISTER_PAGE_SIZE`: a server
 * that clamped 1,682 rows to 100 a page would otherwise be read as four pages and
 * abandoned two thirds short, with nothing to say it had.
 */
export function pageCount(meta: unknown, stride: number): number {
  const counts = meta as { total_pages?: unknown; total_items?: unknown } | null | undefined;
  if (typeof counts?.total_pages === 'number' && Number.isFinite(counts.total_pages)) {
    return Math.max(1, Math.floor(counts.total_pages));
  }
  if (typeof counts?.total_items === 'number' && Number.isFinite(counts.total_items)) {
    return Math.max(1, Math.ceil(counts.total_items / Math.max(1, stride)));
  }
  return 1;
}

function totalOf(meta: unknown): number | null {
  const total = (meta as { total_items?: unknown } | null | undefined)?.total_items;
  return typeof total === 'number' && Number.isFinite(total) ? total : null;
}

/**
 * Walk the matching set into one array.
 *
 * Page 1 goes first alone, because it is the only thing that reveals how wide a
 * page is and how many there are. The remainder go together: measured, that takes
 * the walk from 3.1 s to 1.9 s, and this runs in front of a person watching a
 * skeleton.
 *
 * The name index rides the same concurrency, which is a change of character for
 * it: its own walk was strictly sequential precisely because it is a background
 * courtesy that should not burst. A shared walk cannot be two shapes at once, and
 * the parallel one is the right pick — in the common case the register is already
 * loaded and the courtesy costs no requests at all, and where it does pay, three
 * concurrent requests land the names sooner on a tab that is showing a
 * placeholder for them.
 *
 * `allSettled`, not `all`: one failed page must cost that page and the
 * completeness claim, not the whole register.
 */
async function walk(chain: string, network: string, search: string): Promise<DRepRegister> {
  const query = search ? { search } : {};
  const first = await blockchainApi.getDRepsPaginated(
    { page: 1, per_page: REGISTER_PAGE_SIZE, ...query },
    chain,
    network,
  );

  const head = (first?.items ?? []) as unknown[];
  const records: DRepRecord[] = [];
  for (const raw of head) {
    const projected = projectRecord(raw);
    if (projected) records.push(projected);
  }

  const totalItems = totalOf(first?.meta);
  const pages = head.length ? pageCount(first?.meta, head.length) : 1;
  const reachable = Math.min(pages, MAX_REGISTER_PAGES);
  let complete = pages <= MAX_REGISTER_PAGES;

  if (reachable > 1) {
    const rest = await Promise.allSettled(
      Array.from({ length: reachable - 1 }, (_, index) =>
        blockchainApi.getDRepsPaginated(
          { page: index + 2, per_page: REGISTER_PAGE_SIZE, ...query },
          chain,
          network,
        ),
      ),
    );
    for (const settled of rest) {
      if (settled.status !== 'fulfilled') {
        complete = false;
        continue;
      }
      const items = (settled.value?.items ?? []) as unknown[];
      if (!items.length) complete = false;
      for (const raw of items) {
        const projected = projectRecord(raw);
        if (projected) records.push(projected);
      }
    }
  }

  // The server's own count is the last check: fewer rows in hand than it says
  // exist means the order cannot be described as covering everything, whatever
  // the page arithmetic concluded.
  if (totalItems !== null && records.length < totalItems) complete = false;

  return { records, complete, totalItems, fetchedAt: Date.now() };
}

interface CacheEntry {
  key: string;
  loaded: Promise<DRepRegister>;
  at: number;
}

/**
 * Exactly ONE register is held at a time. A second key evicts the first rather
 * than accumulating: two mainnet registers in memory is 68 MB for a page that
 * only ever renders one of them.
 */
let cache: CacheEntry | null = null;

/**
 * The whole matching set for one chain/network/search, fetched at most once per
 * TTL.
 *
 * `search` is part of the key because the server applies it BEFORE ordering
 * (verified: `search=cardano` reports 466 matching rows with and without
 * `sort_by`), so a searched register is a different, smaller set — and ordering
 * it client side still orders the whole of that set, not one page of it.
 *
 * Never rejects. A total failure resolves to an empty, INCOMPLETE register so the
 * caller can fall back to a server page and label the order honestly.
 */
export function loadDRepRegister(chain: string, network: string, search = ''): Promise<DRepRegister> {
  const key = `${chain}:${network}:${search}`;
  if (cache && cache.key === key && Date.now() - cache.at < REGISTER_TTL_MS) return cache.loaded;

  const loaded = walk(chain, network, search).catch(
    (): DRepRegister => ({ records: [], complete: false, totalItems: null, fetchedAt: Date.now() }),
  );
  cache = { key, loaded, at: Date.now() };
  return loaded;
}

/** Test seam, and the eviction hook for a wallet or network switch. */
export function resetDRepRegister(): void {
  cache = null;
}
