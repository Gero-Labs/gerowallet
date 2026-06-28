// src/sidepanel/composables/useCopilotFeed.ts
import { ref, type Ref } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { useWatchlist } from '@/modules/market/composables/useWatchlist';
import { buildFeedItems } from '@/services/copilot/feedEngine';
import { buildRefs } from '@/services/copilot/refBuilder';
import { thresholdsForVibe, type CopilotVibe } from '@/services/copilot/preferences';
import { copilotFeedStore } from '@/stores/copilotFeedStore';
import { copilotPrefsStore } from '@/stores/copilotPrefsStore';
import type { FeedItem } from '@/services/copilot/feedReducer';
import type { TokenRef } from '@/services/copilot/marketSnapshot';
import type { PriceThresholds, TokenSnapshot } from '@/services/copilot/detectors';

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

interface PrefsLike {
  readonly vibe: CopilotVibe;
}

interface CopilotFeedDeps {
  store?: FeedStoreLike;
  prefs?: PrefsLike;
  build?: (
    refs: TokenRef[],
    thresholds: PriceThresholds,
    bucket: string,
    now: number,
    fetchSnapshots?: (refs: TokenRef[]) => Promise<TokenSnapshot[]>,
    vibe?: CopilotVibe,
  ) => Promise<FeedItem[]>;
  getRefs?: () => TokenRef[];
}

/**
 * Build the held + watched token refs from wallet state, gated by the user's active
 * categories. Delegates to the pure, unit-tested buildRefs (category gating lives
 * there); this wrapper only supplies the live wallet/watchlist data.
 *
 * walletStore.tokens is keyed BY unit (Cardano AssetId); value carries name + metadata.
 * useWatchlist() returns { watchlist: Ref<string[]>, ... }.
 */
function defaultGetRefs(): TokenRef[] {
  const tokens = (walletStore.tokens || {}) as Record<string, WalletToken>;
  const { watchlist } = useWatchlist();
  return buildRefs(tokens, watchlist.value, copilotPrefsStore.categories);
}

export function createCopilotFeed(deps: CopilotFeedDeps = {}) {
  const store = deps.store ?? copilotFeedStore;
  const prefs = deps.prefs ?? copilotPrefsStore;
  // default closure passes `undefined` for fetch (so defaultFetch is used) then the vibe
  const build =
    deps.build ?? ((refs, th, bucket, now, fetch, vibe) => buildFeedItems(refs, th, bucket, now, fetch, vibe));
  const getRefs = deps.getRefs ?? defaultGetRefs;
  const busy: Ref<boolean> = ref(false);

  async function refresh(): Promise<void> {
    if (busy.value) return;
    busy.value = true;
    try {
      const now = Date.now();
      const bucket = new Date(now).toISOString().slice(0, 10); // YYYY-MM-DD day bucket
      const vibe = prefs.vibe;
      const items = await build(getRefs(), thresholdsForVibe(vibe), bucket, now, undefined, vibe);
      if (items.length) store.merge(items);
    } finally {
      busy.value = false;
    }
  }

  return { busy, items: () => store.items, refresh };
}

export const copilotFeed = createCopilotFeed();
