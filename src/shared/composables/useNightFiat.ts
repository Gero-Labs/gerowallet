/**
 * NIGHT fiat price (USD/EUR + 24h change) from CoinGecko's public API.
 *
 * CoinGecko id is `midnight-3` — the real Midnight Network token
 * (homepage docs.midnight.network; the bare `midnight` id is an unrelated
 * dead token). Endpoint (public, no key):
 *   https://api.coingecko.com/api/v3/simple/price?ids=midnight-3&vs_currencies=usd,eur&include_24hr_change=true
 *
 * Only meaningful on MAINNET — testnet tNIGHT has no market. Callers gate on
 * network; this module just fetches lazily with a shared 5-minute cache
 * (module-scope, one fetch per context regardless of consumer count).
 * CSP: api.coingecko.com is already in manifest connect-src.
 */
import { computed, ref, type ComputedRef } from 'vue';
import axios from 'axios';
import { debugLog } from '@/utils/debug';

const NIGHT_COINGECKO_ID = 'midnight-3';
const CACHE_TTL_MS = 5 * 60 * 1000;

const usd = ref<number | null>(null);
const eur = ref<number | null>(null);
const change24h = ref<number | null>(null);
let fetchedAt = 0;
let inflight: Promise<void> | null = null;

async function refresh(): Promise<void> {
  if (Date.now() - fetchedAt < CACHE_TTL_MS) return;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { data } = await axios.get(
        'https://api.coingecko.com/api/v3/simple/price',
        {
          params: {
            ids: NIGHT_COINGECKO_ID,
            vs_currencies: 'usd,eur',
            include_24hr_change: 'true',
          },
          timeout: 10_000,
        },
      );
      const entry = data?.[NIGHT_COINGECKO_ID];
      if (entry) {
        usd.value = typeof entry.usd === 'number' ? entry.usd : null;
        eur.value = typeof entry.eur === 'number' ? entry.eur : null;
        change24h.value = typeof entry.usd_24h_change === 'number' ? entry.usd_24h_change : null;
        fetchedAt = Date.now();
      }
    } catch (e) {
      debugLog('NIGHT price fetch failed (non-fatal)', e);
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export interface NightFiat {
  readonly usd: ComputedRef<number | null>;
  readonly eur: ComputedRef<number | null>;
  readonly change24h: ComputedRef<number | null>;
  readonly hasPrice: ComputedRef<boolean>;
  /** Kick a (cached) refresh; safe to call from any consumer/mount. */
  refresh: () => Promise<void>;
}

export function useNightFiat(): NightFiat {
  return {
    usd: computed(() => usd.value),
    eur: computed(() => eur.value),
    change24h: computed(() => change24h.value),
    hasPrice: computed(() => usd.value !== null && usd.value > 0),
    refresh,
  };
}
