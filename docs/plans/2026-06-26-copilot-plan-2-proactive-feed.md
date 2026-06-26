# Gero Copilot - Plan 2: Proactive Friend Feed (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the proactive "friend" pipeline end-to-end, deterministically: detect notable market moves on the user's held + watched tokens, narrate them in a non-advisory friend voice, and surface them in an in-app Feed - with zero backend dependency and zero LLM cost.

**Architecture:** Detection runs on-demand in the sidepanel UI (not a background poller - CLAUDE.md forbids background price polling). When the Feed opens, an engine pulls `market-api` snapshots for the held (`walletStore.tokens`) + watched (`useWatchlist`) tokens, runs pure deterministic detectors over the API-provided deltas (`priceChange24h/7d`), narrates each new event into an i18n template (observer voice, no advice), dedupes against a seen-set, and appends capped items to a persisted `copilotFeedStore`. A new `/feed` route + nav tab renders the feed.

**Tech Stack:** Vue 2.7 + TypeScript + Vuetify 2.7, Vite, Vitest 3.2.4 (co-located `.spec.ts`), `market-api` (default export, axios on `VITE_NEXUS_URL`).

**Scope (v1) and explicit deferrals:**
- IN: held + watched tokens; price-move detector (up/down beyond a threshold); deterministic friend-voice narration via i18n; dedupe + cap; persisted feed store; Feed page/route/nav; detection on Feed open + manual refresh.
- DEFERRED to later plans (do NOT build here): real-time background push + `chrome.notifications`; daily digest; the tuning dial (vibe + per-category mutes); LLM narration via the Nexus proxy; liquidity-drop / volume-spike / holder-concentration detectors that need a stored baseline; unifying the chat dock history with the feed (decision #3 - the feed is its own surface in v1); Mode-3 spend receipts.

**Testing note:** Pure-TS units (reducer, detectors, narrator, snapshot fetcher, engine) are TDD with Vitest. The store's `chrome.storage` glue, the composable, the `.vue` page, and the router/nav wiring are verified with `npm run typecheck` + `npm run build` + a manual run (no component-render test infra; `chrome` is unavailable in Vitest). Run a single spec with `npx vitest run <path>`.

**No-advice rule (carry over from Plan 1 / the design spec):** every feed message is an OBSERVATION of a past, factual market move with personality, never a recommendation, prediction, or suitability judgment. Narration templates state what happened (ticker, %, timeframe) and never "buy/sell/hold/should/will/moon/dump". Each feed item carries the same "not financial advice" framing as the dock.

---

### Task 1: Feed reducer (pure dedupe + cap)

**Files:**
- Create: `src/services/copilot/feedReducer.ts`
- Test: `src/services/copilot/feedReducer.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/copilot/feedReducer.spec.ts
import { describe, it, expect } from 'vitest';
import { addFeedItems, type FeedItem } from './feedReducer';

function item(key: string, ts: number): FeedItem {
  return { id: key, key, ts, textKey: 'copilot.feed.priceUp', params: {} };
}

describe('addFeedItems', () => {
  it('appends new items and keeps newest-first order', () => {
    const out = addFeedItems({ items: [], seen: [] }, [item('a', 1), item('b', 2)], 50);
    expect(out.items.map((i) => i.key)).toEqual(['b', 'a']);
    expect(out.seen).toEqual(['a', 'b']);
  });

  it('drops items whose key was already seen', () => {
    const start = addFeedItems({ items: [], seen: [] }, [item('a', 1)], 50);
    const out = addFeedItems(start, [item('a', 9), item('c', 3)], 50);
    expect(out.items.map((i) => i.key)).toEqual(['c', 'a']);
    expect(out.seen).toEqual(['a', 'c']);
  });

  it('caps items and the seen-set to max (newest kept)', () => {
    const out = addFeedItems({ items: [], seen: [] }, [item('a', 1), item('b', 2), item('c', 3)], 2);
    expect(out.items.map((i) => i.key)).toEqual(['c', 'b']);
    expect(out.seen).toEqual(['b', 'c']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/copilot/feedReducer.spec.ts`
Expected: FAIL with "Cannot find module './feedReducer'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/services/copilot/feedReducer.ts
export interface FeedItem {
  id: string;
  key: string; // dedupe key (e.g. "priceUp:SNEK:2026-06-26")
  ts: number; // event time (ms) - passed in; do not call Date.now() here
  textKey: string; // i18n key for the friend message
  params: Record<string, string | number>;
}

export interface FeedState {
  items: FeedItem[]; // newest-first
  seen: string[]; // recently-seen keys (oldest-first), capped to max
}

/** Pure: append new (unseen) items newest-first, dedupe by key, cap items and seen-set to max. */
export function addFeedItems(state: FeedState, incoming: FeedItem[], max: number): FeedState {
  const seenSet = new Set(state.seen);
  const fresh = incoming.filter((i) => !seenSet.has(i.key));
  const items = [...fresh].sort((a, b) => b.ts - a.ts).concat(state.items).slice(0, max);
  const seen = [...state.seen, ...fresh.map((i) => i.key)].slice(-max);
  return { items, seen };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/copilot/feedReducer.spec.ts`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add src/services/copilot/feedReducer.ts src/services/copilot/feedReducer.spec.ts
git commit -m "feat(copilot): pure feed reducer (dedupe + cap)"
```

---

### Task 2: Price-move detector (pure)

**Files:**
- Create: `src/services/copilot/detectors.ts`
- Test: `src/services/copilot/detectors.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/copilot/detectors.spec.ts
import { describe, it, expect } from 'vitest';
import { detectPriceMoves, type TokenSnapshot } from './detectors';

const snap = (over: Partial<TokenSnapshot>): TokenSnapshot => ({
  unit: 'u', ticker: 'SNEK', held: true, priceChange24h: 0, priceChange7d: 0, ...over,
});

describe('detectPriceMoves', () => {
  it('flags a 24h up-move beyond the threshold', () => {
    const events = detectPriceMoves([snap({ priceChange24h: 22 })], { pct24h: 15 }, 'day-1');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'priceUp', ticker: 'SNEK', window: '24h', pct: 22 });
    expect(events[0].key).toBe('priceUp:24h:u:day-1');
  });

  it('flags a 24h down-move beyond the threshold', () => {
    const events = detectPriceMoves([snap({ priceChange24h: -30 })], { pct24h: 15 }, 'day-1');
    expect(events[0]).toMatchObject({ kind: 'priceDown', window: '24h', pct: 30 });
  });

  it('ignores moves within the threshold', () => {
    expect(detectPriceMoves([snap({ priceChange24h: 5 })], { pct24h: 15 }, 'day-1')).toEqual([]);
  });

  it('reports at most one move per token (largest-magnitude window wins)', () => {
    const events = detectPriceMoves([snap({ priceChange24h: 16, priceChange7d: -40 })], { pct24h: 15, pct7d: 15 }, 'day-1');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ window: '7d', kind: 'priceDown', pct: 40 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/copilot/detectors.spec.ts`
Expected: FAIL with "Cannot find module './detectors'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/services/copilot/detectors.ts
export interface TokenSnapshot {
  unit: string;
  ticker: string;
  held: boolean; // true = in wallet, false = watchlist-only
  priceChange24h: number | null;
  priceChange7d: number | null;
}

export interface PriceThresholds {
  pct24h?: number;
  pct7d?: number;
}

export interface FeedEvent {
  key: string;
  kind: 'priceUp' | 'priceDown';
  unit: string;
  ticker: string;
  held: boolean;
  window: '24h' | '7d';
  pct: number; // absolute magnitude, rounded
}

/**
 * Pure: for each snapshot, emit at most one price-move event - the window with the
 * largest absolute change that clears its threshold. `bucket` is a caller-provided
 * time bucket string used to keep the dedupe key stable within a period (no Date.now here).
 */
export function detectPriceMoves(
  snapshots: TokenSnapshot[],
  thresholds: PriceThresholds,
  bucket: string,
): FeedEvent[] {
  const events: FeedEvent[] = [];
  for (const s of snapshots) {
    const candidates: { window: '24h' | '7d'; change: number; min: number }[] = [];
    if (thresholds.pct24h != null && s.priceChange24h != null) {
      candidates.push({ window: '24h', change: s.priceChange24h, min: thresholds.pct24h });
    }
    if (thresholds.pct7d != null && s.priceChange7d != null) {
      candidates.push({ window: '7d', change: s.priceChange7d, min: thresholds.pct7d });
    }
    const cleared = candidates.filter((c) => Math.abs(c.change) >= c.min);
    if (cleared.length === 0) continue;
    cleared.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    const top = cleared[0];
    events.push({
      key: `${top.change >= 0 ? 'priceUp' : 'priceDown'}:${top.window}:${s.unit}:${bucket}`,
      kind: top.change >= 0 ? 'priceUp' : 'priceDown',
      unit: s.unit,
      ticker: s.ticker,
      held: s.held,
      window: top.window,
      pct: Math.round(Math.abs(top.change)),
    });
  }
  return events;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/copilot/detectors.spec.ts`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add src/services/copilot/detectors.ts src/services/copilot/detectors.spec.ts
git commit -m "feat(copilot): pure price-move detector"
```

---

### Task 3: Friend-voice narrator (event -> i18n key + params)

**Files:**
- Create: `src/services/copilot/narrator.ts`
- Test: `src/services/copilot/narrator.spec.ts`

> The narrator returns an i18n KEY + params (never raw English), so the Feed renders `$t(key, params)`. This keeps it testable and i18n-compliant, and keeps the no-advice rule auditable (a fixed set of observer templates).

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/copilot/narrator.spec.ts
import { describe, it, expect } from 'vitest';
import { narrate } from './narrator';
import type { FeedEvent } from './detectors';

const ev = (over: Partial<FeedEvent>): FeedEvent => ({
  key: 'priceUp:24h:u:day-1', kind: 'priceUp', unit: 'u', ticker: 'SNEK', held: true, window: '24h', pct: 22, ...over,
});

describe('narrate', () => {
  it('maps a held up-move to the held-up template with params', () => {
    expect(narrate(ev({ kind: 'priceUp', held: true }))).toEqual({
      key: 'priceUp:24h:u:day-1',
      textKey: 'copilot.feed.heldPriceUp',
      params: { ticker: 'SNEK', pct: 22, window: '24h' },
    });
  });

  it('maps a watched down-move to the watched-down template', () => {
    expect(narrate(ev({ kind: 'priceDown', held: false, pct: 30, window: '7d' }))).toMatchObject({
      textKey: 'copilot.feed.watchedPriceDown',
      params: { ticker: 'SNEK', pct: 30, window: '7d' },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/copilot/narrator.spec.ts`
Expected: FAIL with "Cannot find module './narrator'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/services/copilot/narrator.ts
import type { FeedEvent } from './detectors';

export interface NarratedItem {
  key: string;
  textKey: string;
  params: Record<string, string | number>;
}

/** Pure: map a detected event to an i18n template key + params. Observer voice only - no advice. */
export function narrate(event: FeedEvent): NarratedItem {
  const dir = event.kind === 'priceUp' ? 'Up' : 'Down';
  const scope = event.held ? 'held' : 'watched';
  return {
    key: event.key,
    textKey: `copilot.feed.${scope}Price${dir}`,
    params: { ticker: event.ticker, pct: event.pct, window: event.window },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/copilot/narrator.spec.ts`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add src/services/copilot/narrator.ts src/services/copilot/narrator.spec.ts
git commit -m "feat(copilot): deterministic friend-voice narrator (i18n key + params)"
```

---

### Task 4: Market snapshot fetcher (held + watched -> snapshots)

**Files:**
- Create: `src/services/copilot/marketSnapshot.ts`
- Test: `src/services/copilot/marketSnapshot.spec.ts`

> CRITICAL: verify the real `market-api` shape first. It is a DEFAULT export (`import marketApi from '@/api/market-api'`). Confirm `getTokenPrice(assetId)` exists and returns `priceChange24h` / `priceChange7d` fields, and confirm the exact `assetId` argument format vs the `walletStore.tokens` key (`unit`). If `unit` is not directly usable as `assetId`, map it (open `market-api.ts` and an existing caller to see the format). Keep this module's public surface unchanged regardless.

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/copilot/marketSnapshot.spec.ts
import { describe, it, expect, vi } from 'vitest';
import * as market from '@/api/market-api';
import { fetchSnapshots, type TokenRef } from './marketSnapshot';

describe('fetchSnapshots', () => {
  it('fetches a price snapshot per token and marks held vs watched', async () => {
    vi.spyOn(market.default, 'getTokenPrice').mockImplementation(async (assetId: string) => ({
      assetId, priceChange24h: assetId === 'a' ? 22 : 3, priceChange7d: -5,
    }) as never);

    const refs: TokenRef[] = [
      { unit: 'a', ticker: 'SNEK', held: true },
      { unit: 'b', ticker: 'GERO', held: false },
    ];
    const snaps = await fetchSnapshots(refs);

    expect(snaps).toEqual([
      { unit: 'a', ticker: 'SNEK', held: true, priceChange24h: 22, priceChange7d: -5 },
      { unit: 'b', ticker: 'GERO', held: false, priceChange24h: 3, priceChange7d: -5 },
    ]);
  });

  it('skips tokens whose price lookup fails (no throw)', async () => {
    vi.spyOn(market.default, 'getTokenPrice').mockRejectedValue(new Error('404') as never);
    const snaps = await fetchSnapshots([{ unit: 'x', ticker: 'X', held: true }]);
    expect(snaps).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/copilot/marketSnapshot.spec.ts`
Expected: FAIL with "Cannot find module './marketSnapshot'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/services/copilot/marketSnapshot.ts
import marketApi from '@/api/market-api';
import type { TokenSnapshot } from './detectors';

export interface TokenRef {
  unit: string;
  ticker: string;
  held: boolean;
}

/**
 * Fetch a price snapshot for each token ref. Failures per token are swallowed (skipped),
 * so one bad token never breaks the whole feed. If `unit` is not directly usable as the
 * market-api assetId, adapt the call here (verified against market-api.ts).
 */
export async function fetchSnapshots(refs: TokenRef[]): Promise<TokenSnapshot[]> {
  const results = await Promise.all(
    refs.map(async (ref): Promise<TokenSnapshot | null> => {
      try {
        const p = await marketApi.getTokenPrice(ref.unit);
        return {
          unit: ref.unit,
          ticker: ref.ticker,
          held: ref.held,
          priceChange24h: p.priceChange24h ?? null,
          priceChange7d: p.priceChange7d ?? null,
        };
      } catch {
        return null;
      }
    }),
  );
  return results.filter((s): s is TokenSnapshot => s !== null);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/copilot/marketSnapshot.spec.ts`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add src/services/copilot/marketSnapshot.ts src/services/copilot/marketSnapshot.spec.ts
git commit -m "feat(copilot): market snapshot fetcher for held + watched tokens"
```

---

### Task 5: Feed engine (orchestrate fetch -> detect -> narrate)

**Files:**
- Create: `src/services/copilot/feedEngine.ts`
- Test: `src/services/copilot/feedEngine.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/copilot/feedEngine.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { buildFeedItems } from './feedEngine';
import type { TokenRef } from './marketSnapshot';

describe('buildFeedItems', () => {
  it('fetches, detects, and narrates into FeedItems with a stable id/key', async () => {
    const fetchSnapshots = vi.fn().mockResolvedValue([
      { unit: 'u1', ticker: 'SNEK', held: true, priceChange24h: 22, priceChange7d: -5 },
      { unit: 'u2', ticker: 'GERO', held: false, priceChange24h: 4, priceChange7d: 3 },
    ]);
    const refs: TokenRef[] = [
      { unit: 'u1', ticker: 'SNEK', held: true },
      { unit: 'u2', ticker: 'GERO', held: false },
    ];

    const items = await buildFeedItems(refs, { pct24h: 15 }, 'day-1', 1000, fetchSnapshots);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: 'priceUp:24h:u1:day-1',
      id: 'priceUp:24h:u1:day-1',
      ts: 1000,
      textKey: 'copilot.feed.heldPriceUp',
      params: { ticker: 'SNEK', pct: 22, window: '24h' },
    });
  });

  it('returns no items when there are no refs', async () => {
    const fetchSnapshots = vi.fn();
    expect(await buildFeedItems([], { pct24h: 15 }, 'day-1', 1000, fetchSnapshots)).toEqual([]);
    expect(fetchSnapshots).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/copilot/feedEngine.spec.ts`
Expected: FAIL with "Cannot find module './feedEngine'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/services/copilot/feedEngine.ts
import { detectPriceMoves, type PriceThresholds, type TokenSnapshot } from './detectors';
import { narrate } from './narrator';
import { fetchSnapshots as defaultFetch, type TokenRef } from './marketSnapshot';
import type { FeedItem } from './feedReducer';

/**
 * Orchestrate one detection pass: fetch snapshots for the refs, run detectors,
 * narrate, and return FeedItems. `bucket` keeps dedupe keys stable within a period;
 * `now` is the caller-supplied timestamp (no Date.now here). `fetchSnapshots` is
 * injectable for tests.
 */
export async function buildFeedItems(
  refs: TokenRef[],
  thresholds: PriceThresholds,
  bucket: string,
  now: number,
  fetchSnapshots: (refs: TokenRef[]) => Promise<TokenSnapshot[]> = defaultFetch,
): Promise<FeedItem[]> {
  if (refs.length === 0) return [];
  const snapshots = await fetchSnapshots(refs);
  const events = detectPriceMoves(snapshots, thresholds, bucket);
  return events.map((e) => {
    const n = narrate(e);
    return { id: n.key, key: n.key, ts: now, textKey: n.textKey, params: n.params };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/copilot/feedEngine.spec.ts`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add src/services/copilot/feedEngine.ts src/services/copilot/feedEngine.spec.ts
git commit -m "feat(copilot): feed engine (fetch -> detect -> narrate)"
```

---

### Task 6: Persisted feed store + `useCopilotFeed` composable

**Files:**
- Create: `src/stores/copilotFeedStore.ts`
- Create: `src/sidepanel/composables/useCopilotFeed.ts`
- Test: `src/sidepanel/composables/useCopilotFeed.spec.ts`

> The store glue uses `chrome.storage.local` and runs in the sidepanel (browser) context (v1 detection is UI-side; background-generated push is a later plan). `chrome` is unavailable in Vitest, so the store itself is verified by build; the composable is tested with injected deps. Confirm `walletStore.tokens` shape and `useWatchlist()` return (`watchlist: Ref<string[]>`) against the real files before writing the ref-building logic.

- [ ] **Step 1: Write the failing test (composable, with injected builder + store)**

```typescript
// src/sidepanel/composables/useCopilotFeed.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { createCopilotFeed } from './useCopilotFeed';
import type { FeedItem, FeedState } from '@/services/copilot/feedReducer';

function fakeStore() {
  const state: FeedState = { items: [], seen: [] };
  return {
    state,
    get items() { return state.items; },
    merge(incoming: FeedItem[]) {
      const seen = new Set(state.seen);
      const fresh = incoming.filter((i) => !seen.has(i.key));
      state.items = [...fresh].concat(state.items);
      state.seen = [...state.seen, ...fresh.map((i) => i.key)];
    },
  };
}

describe('useCopilotFeed', () => {
  it('refresh() builds items and merges them into the store', async () => {
    const store = fakeStore();
    const build = vi.fn().mockResolvedValue([
      { id: 'k1', key: 'k1', ts: 1, textKey: 'copilot.feed.heldPriceUp', params: {} },
    ]);
    const feed = createCopilotFeed({
      store,
      build,
      getRefs: () => [{ unit: 'u1', ticker: 'SNEK', held: true }],
    });

    await feed.refresh();

    expect(build).toHaveBeenCalledTimes(1);
    expect(store.items.map((i) => i.key)).toEqual(['k1']);
    expect(feed.busy.value).toBe(false);
  });

  it('refresh() is a no-op while already busy', async () => {
    const store = fakeStore();
    let resolve!: (v: FeedItem[]) => void;
    const build = vi.fn().mockReturnValue(new Promise<FeedItem[]>((r) => { resolve = r; }));
    const feed = createCopilotFeed({ store, build, getRefs: () => [{ unit: 'u', ticker: 'T', held: true }] });

    const first = feed.refresh();
    await feed.refresh(); // should be ignored while busy
    resolve([]);
    await first;

    expect(build).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sidepanel/composables/useCopilotFeed.spec.ts`
Expected: FAIL with "Cannot find module './useCopilotFeed'".

- [ ] **Step 3a: Create the store**

```typescript
// src/stores/copilotFeedStore.ts
import Vue from 'vue';
import { addFeedItems, type FeedItem, type FeedState } from '@/services/copilot/feedReducer';

const STORE_KEY = 'copilotFeedStore';
const MAX_ITEMS = 50;

export const copilotFeedState = Vue.observable<FeedState>({ items: [], seen: [] });

const hasChromeStorage = typeof chrome !== 'undefined' && !!chrome.storage?.local;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

if (hasChromeStorage) {
  chrome.storage.local.get(STORE_KEY, (res) => {
    const saved = res[STORE_KEY] as FeedState | undefined;
    if (saved) {
      copilotFeedState.items = saved.items ?? [];
      copilotFeedState.seen = saved.seen ?? [];
    }
  });
}

function persist() {
  if (!hasChromeStorage) return;
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    chrome.storage.local.set({ [STORE_KEY]: { items: copilotFeedState.items, seen: copilotFeedState.seen } });
  }, 300);
}

export const copilotFeedStore = {
  state: copilotFeedState,
  get items(): FeedItem[] { return copilotFeedState.items; },
  merge(incoming: FeedItem[]): void {
    const next = addFeedItems({ items: copilotFeedState.items, seen: copilotFeedState.seen }, incoming, MAX_ITEMS);
    copilotFeedState.items = next.items;
    copilotFeedState.seen = next.seen;
    persist();
  },
  clear(): void {
    copilotFeedState.items = [];
    copilotFeedState.seen = [];
    persist();
  },
};
```

- [ ] **Step 3b: Create the composable**

```typescript
// src/sidepanel/composables/useCopilotFeed.ts
import { ref, type Ref } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { useWatchlist } from '@/modules/market/composables/useWatchlist';
import { buildFeedItems } from '@/services/copilot/feedEngine';
import { copilotFeedStore } from '@/stores/copilotFeedStore';
import type { FeedItem } from '@/services/copilot/feedReducer';
import type { TokenRef } from '@/services/copilot/marketSnapshot';
import type { PriceThresholds } from '@/services/copilot/detectors';

const THRESHOLDS: PriceThresholds = { pct24h: 15, pct7d: 25 };

interface FeedStoreLike {
  items: FeedItem[];
  merge(incoming: FeedItem[]): void;
}

interface CopilotFeedDeps {
  store?: FeedStoreLike;
  build?: (refs: TokenRef[], thresholds: PriceThresholds, bucket: string, now: number) => Promise<FeedItem[]>;
  getRefs?: () => TokenRef[];
}

/** Build the held + watched token refs from wallet state. Verify field names against walletStore.tokens. */
function defaultGetRefs(): TokenRef[] {
  const refs: TokenRef[] = [];
  const seen = new Set<string>();
  const tokens = (walletStore.tokens || {}) as Record<string, { metadata?: { ticker?: string }; name?: string }>;
  for (const [unit, t] of Object.entries(tokens)) {
    if (unit === 'lovelace' || seen.has(unit)) continue;
    seen.add(unit);
    refs.push({ unit, ticker: t.metadata?.ticker || t.name || unit.slice(0, 6), held: true });
  }
  const { watchlist } = useWatchlist();
  for (const unit of watchlist.value) {
    if (unit === 'lovelace' || seen.has(unit)) continue;
    seen.add(unit);
    refs.push({ unit, ticker: unit.slice(0, 6), held: false });
  }
  return refs;
}

export function createCopilotFeed(deps: CopilotFeedDeps = {}) {
  const store = deps.store ?? copilotFeedStore;
  const build = deps.build ?? ((refs, th, bucket, now) => buildFeedItems(refs, th, bucket, now));
  const getRefs = deps.getRefs ?? defaultGetRefs;
  const busy: Ref<boolean> = ref(false);

  async function refresh(): Promise<void> {
    if (busy.value) return;
    busy.value = true;
    try {
      const now = Date.now();
      const bucket = new Date(now).toISOString().slice(0, 10); // YYYY-MM-DD day bucket
      const items = await build(getRefs(), THRESHOLDS, bucket, now);
      if (items.length) store.merge(items);
    } finally {
      busy.value = false;
    }
  }

  return { busy, items: () => store.items, refresh };
}

export const copilotFeed = createCopilotFeed();
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run src/sidepanel/composables/useCopilotFeed.spec.ts`
Expected: PASS (2 passed).

Run: `npm run typecheck`
Expected: no new errors referencing `copilotFeedStore` / `useCopilotFeed`. (Confirm `walletStore.tokens` and `useWatchlist` field names compile; adjust the ref-builder to the real shapes if typecheck flags them - keep the public API the same.)

- [ ] **Step 5: Commit**

```bash
git add src/stores/copilotFeedStore.ts src/sidepanel/composables/useCopilotFeed.ts src/sidepanel/composables/useCopilotFeed.spec.ts
git commit -m "feat(copilot): persisted feed store + useCopilotFeed composable"
```

---

### Task 7: Feed page + route + nav tab + i18n + build

**Files:**
- Create: `src/sidepanel/pages/FeedPage.vue`
- Modify: `src/sidepanel/router.ts` (add `/feed` route)
- Modify: `src/sidepanel/composables/useMiniNavigation.ts` (add Feed tab to `CARDANO_TABS`)
- Modify: `src/sidepanel/layouts/MiniLayout.vue` (add `/feed` to `tabOrder` if such a map exists)
- Modify: `src/plugins/i18n/us.ts` and `src/plugins/i18n/de.ts` (feed keys)

- [ ] **Step 1: Add i18n keys (English) to `src/plugins/i18n/us.ts`**

Match the file's existing flat-key style; add:

```typescript
'copilot.feedTitle': 'Feed',
'copilot.feed.empty': 'Nothing notable yet. Pull to refresh.',
'copilot.feed.refresh': 'Refresh',
'copilot.feed.clear': 'Clear',
'copilot.feed.disclaimer': 'Observations, not financial advice. DYOR.',
'copilot.feed.heldPriceUp': '{ticker} is up {pct}% ({window}). just a heads up, it is in your bags.',
'copilot.feed.heldPriceDown': '{ticker} is down {pct}% ({window}) - one of your bags moved.',
'copilot.feed.watchedPriceUp': '{ticker} (on your watchlist) is up {pct}% ({window}).',
'copilot.feed.watchedPriceDown': '{ticker} (on your watchlist) is down {pct}% ({window}).',
```

- [ ] **Step 2: Add i18n keys (German) to `src/plugins/i18n/de.ts`**

```typescript
'copilot.feedTitle': 'Feed',
'copilot.feed.empty': 'Noch nichts Bemerkenswertes. Zum Aktualisieren ziehen.',
'copilot.feed.refresh': 'Aktualisieren',
'copilot.feed.clear': 'Leeren',
'copilot.feed.disclaimer': 'Beobachtungen, keine Finanzberatung. DYOR.',
'copilot.feed.heldPriceUp': '{ticker} ist {pct}% gestiegen ({window}) - liegt in deinem Wallet.',
'copilot.feed.heldPriceDown': '{ticker} ist {pct}% gefallen ({window}) - eine deiner Positionen hat sich bewegt.',
'copilot.feed.watchedPriceUp': '{ticker} (auf deiner Watchlist) ist {pct}% gestiegen ({window}).',
'copilot.feed.watchedPriceDown': '{ticker} (auf deiner Watchlist) ist {pct}% gefallen ({window}).',
```

- [ ] **Step 3: Create `src/sidepanel/pages/FeedPage.vue`**

```vue
<template>
  <div class="feed-page">
    <header class="feed-page__head">
      <h2>{{ $t('copilot.feedTitle') }}</h2>
      <div class="feed-page__actions">
        <button :disabled="feed.busy.value" @click="feed.refresh()">{{ $t('copilot.feed.refresh') }}</button>
      </div>
    </header>

    <p class="feed-page__disclaimer">{{ $t('copilot.feed.disclaimer') }}</p>

    <div v-if="items.length === 0" class="feed-page__empty">{{ $t('copilot.feed.empty') }}</div>
    <ul v-else class="feed-page__list">
      <li v-for="item in items" :key="item.id" class="feed-page__item">
        <span class="feed-page__time">{{ formatTime(item.ts) }}</span>
        <p class="feed-page__text">{{ $t(item.textKey, item.params) }}</p>
      </li>
    </ul>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed, onMounted } from 'vue';
import { copilotFeed } from '@/sidepanel/composables/useCopilotFeed';
import { copilotFeedStore } from '@/stores/copilotFeedStore';

export default defineComponent({
  name: 'FeedPage',
  setup() {
    const feed = copilotFeed;
    const items = computed(() => copilotFeedStore.items);
    function formatTime(ts: number): string {
      return new Date(ts).toLocaleTimeString();
    }
    onMounted(() => { feed.refresh(); });
    return { feed, items, formatTime };
  },
});
</script>

<style scoped>
.feed-page { padding: 12px 16px; }
.feed-page__head { display: flex; justify-content: space-between; align-items: center; }
.feed-page__disclaimer { font-size: 10px; opacity: 0.5; margin: 2px 0 10px; }
.feed-page__list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.feed-page__item { padding: 10px 12px; border-radius: 12px; background: rgba(255,255,255,0.04); }
.feed-page__time { font-size: 11px; opacity: 0.55; }
.feed-page__text { margin: 2px 0 0; font-size: 13px; }
.feed-page__empty { opacity: 0.6; text-align: center; padding: 28px 12px; font-size: 13px; }
</style>
```

- [ ] **Step 4: Add the route in `src/sidepanel/router.ts`**

Add to the `routes` array (before the `*` redirect), matching the existing lazy-import style:

```typescript
{ path: '/feed', name: 'feed', component: () => import('./pages/FeedPage.vue') },
```

- [ ] **Step 5: Add the nav tab in `src/sidepanel/composables/useMiniNavigation.ts`**

Add to `CARDANO_TABS` (choose a sensible position; match the `NavTab` shape exactly):

```typescript
{ name: 'feed', icon: 'mdi-bell-outline', activeIcon: 'mdi-bell', route: '/feed' },
```

If `MiniLayout.vue` has a `tabOrder` map for transition direction, add `'/feed': <next index>` there too.

- [ ] **Step 6: Typecheck, lint, build, manual**

Run: `npm run typecheck`
Expected: no new errors from the files in this plan.

Run: `npm run lint`
Expected: clean for touched files (fix per the repo rule).

Run: `npm run build`
Expected: build succeeds.

Manual (`npm run dev`, load extension, open sidepanel):
- A "Feed" tab appears in the bottom nav and opens the Feed page.
- On open, if you hold/watch a token that moved >= the threshold, a friend-voice item appears with the time and the `$t` message; otherwise the empty state shows.
- "Refresh" re-runs detection; the same move does not duplicate within the same day (dedupe).
- The "Observations, not financial advice. DYOR." line is visible; no message contains buy/sell/should/will/moon/dump.

- [ ] **Step 7: Commit**

```bash
git add src/sidepanel/pages/FeedPage.vue src/sidepanel/router.ts src/sidepanel/composables/useMiniNavigation.ts src/sidepanel/layouts/MiniLayout.vue src/plugins/i18n/us.ts src/plugins/i18n/de.ts
git commit -m "feat(copilot): proactive Feed page + route + nav tab + i18n"
```

---

## Self-Review

- **Spec coverage (Plan 2 v1):** deterministic detection (Task 2) over held + watched tokens (Task 6 ref-builder + Task 4 fetch), friend-voice non-advisory narration (Task 3), dedupe + cap + persistence (Tasks 1, 6), in-app feed surface (Task 7), on-open + manual-refresh trigger (Tasks 6, 7). Honors the design's "deterministic detection + (deterministic) narration" and the no-advice rule.
- **Deferrals are explicit** (top of doc): background push/notifications, digest, tuning dial, LLM narration, baseline-diff detectors (liquidity/volume/holder), chat+feed history unification, Mode-3 receipts.
- **Type consistency:** `FeedItem` (Task 1) flows through narrator output (Task 3 -> `NarratedItem` mapped to `FeedItem` in Task 5), the store (Task 6), and the page (Task 7). `TokenSnapshot` (Task 2) is produced by Task 4 and consumed by Task 5. `TokenRef` (Task 4) is built in Task 6. `PriceThresholds` (Task 2) is set in Task 6.
- **Verification flags for execution:** confirm the `market-api` `getTokenPrice` `assetId` format vs `walletStore.tokens` unit (Task 4); confirm `walletStore.tokens` token shape (`metadata.ticker`) and `useWatchlist().watchlist: Ref<string[]>` (Task 6); confirm `useMiniNavigation` `NavTab` shape and whether `MiniLayout` has a `tabOrder` map (Task 7). Each is flagged inline.
- **No-advice audit:** the only user-facing strings are the fixed i18n templates in Task 7 - all observational; no imperative/predictive language.
