// src/sidepanel/composables/useCopilotFeed.ts
import { ref, type Ref } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { useWatchlist } from '@/modules/market/composables/useWatchlist';
import { buildFeedItems, buildTokenAnomalyItems } from '@/services/copilot/feedEngine';
import { buildRefs } from '@/services/copilot/refBuilder';
import { thresholdsForVibe, type CopilotVibe, type CopilotCategoryFlags } from '@/services/copilot/preferences';
import { copilotFeedStore } from '@/stores/copilotFeedStore';
import { copilotPrefsStore } from '@/stores/copilotPrefsStore';
import type { FeedItem } from '@/services/copilot/feedReducer';
import type { TokenRef } from '@/services/copilot/marketSnapshot';
import type { PriceThresholds, TokenSnapshot, ActivitySpikeOptions } from '@/services/copilot/detectors';

/**
 * Token-anomaly thresholds for the (identity-free) "big moves" category: a token's
 * 24h volume must be >= 4x its recent daily average AND clear a 50k-ADA floor; cap to
 * the 5 loudest so the feed stays high-signal.
 */
const ANOMALY_OPTS: ActivitySpikeOptions = { spikeMultiple: 4, minVolume24h: 50000, limit: 5 };

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
  readonly categories?: CopilotCategoryFlags;
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
  buildAnomalies?: (
    options: ActivitySpikeOptions,
    bucket: string,
    now: number,
    fetchActivity?: undefined,
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
  // default closures pass `undefined` for the fetch (so the real default fetch is used) then the vibe
  const build =
    deps.build ?? ((refs, th, bucket, now, fetch, vibe) => buildFeedItems(refs, th, bucket, now, fetch, vibe));
  const buildAnomalies =
    deps.buildAnomalies ?? ((opts, bucket, now, _f, vibe) => buildTokenAnomalyItems(opts, bucket, now, undefined, vibe));
  const getRefs = deps.getRefs ?? defaultGetRefs;
  const busy: Ref<boolean> = ref(false);

  async function refresh(): Promise<void> {
    if (busy.value) return;
    busy.value = true;
    try {
      const now = Date.now();
      const bucket = new Date(now).toISOString().slice(0, 10); // YYYY-MM-DD day bucket
      const vibe = prefs.vibe;
      // Held/watched price moves always run; the identity-free "big moves" anomaly
      // pass only runs when the user opted into the whales/big-moves category.
      const whalesOn = (prefs.categories ?? copilotPrefsStore.categories).whales;
      const [priceItems, anomalyItems] = await Promise.all([
        build(getRefs(), thresholdsForVibe(vibe), bucket, now, undefined, vibe),
        whalesOn ? buildAnomalies(ANOMALY_OPTS, bucket, now, undefined, vibe) : Promise.resolve([]),
      ]);
      const merged = [...priceItems, ...anomalyItems];
      if (merged.length) store.merge(merged);
    } finally {
      busy.value = false;
    }
  }

  return { busy, items: () => store.items, refresh };
}

export const copilotFeed = createCopilotFeed();
