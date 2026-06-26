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

/**
 * Shape of a token entry in walletStore.tokens at runtime.
 * The store type is `{}` (wide) but in practice resolveAsset returns this structure.
 */
interface WalletToken {
  unit?: string;
  name?: string;
  metadata?: { ticker?: string; name?: string } | null;
}

interface FeedStoreLike {
  items: FeedItem[];
  merge(incoming: FeedItem[]): void;
}

interface CopilotFeedDeps {
  store?: FeedStoreLike;
  build?: (refs: TokenRef[], thresholds: PriceThresholds, bucket: string, now: number) => Promise<FeedItem[]>;
  getRefs?: () => TokenRef[];
}

/**
 * Build the held + watched token refs from wallet state.
 *
 * walletStore.tokens at runtime: Record<string, { unit, name, metadata: { ticker?, name?, ... } | null, ... }>
 * Keys are Cardano AssetId strings (e.g. policy_id + asset_name hex), value carries name + metadata.
 * Ticker resolution mirrors TokenList.vue: metadata.ticker || name || metadata.name || unit prefix.
 *
 * useWatchlist() returns: { watchlist: Ref<string[]>, isWatched, toggleWatchlist, watchlistCount }
 */
function defaultGetRefs(): TokenRef[] {
  const refs: TokenRef[] = [];
  const seen = new Set<string>();
  const tokens = (walletStore.tokens || {}) as Record<string, WalletToken>;
  for (const [unit, t] of Object.entries(tokens)) {
    if (unit === 'lovelace' || seen.has(unit)) continue;
    seen.add(unit);
    const ticker = t.metadata?.ticker || t.name || t.metadata?.name || unit.slice(0, 6);
    refs.push({ unit, ticker, held: true });
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
