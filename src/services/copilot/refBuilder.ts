// src/services/copilot/refBuilder.ts
// Pure: turn the user's holdings + watchlist into the token refs the feed engine
// fetches snapshots for, gated by the active category flags. Extracted from
// useCopilotFeed.defaultGetRefs so the category gating is unit-tested (the
// composable itself is only build-verified). Coming-soon categories never enter
// here: they have no source and no detector yet.
import type { TokenRef } from './marketSnapshot';
import type { CopilotCategoryFlags } from './preferences';

interface WalletTokenLike {
  unit?: string;
  name?: string;
  metadata?: { ticker?: string; name?: string } | null;
}

/**
 * Held refs come from walletStore.tokens (gated by `bags`), watched refs from the
 * watchlist units (gated by `watchlist`). lovelace is excluded; a unit that is both
 * held and watched appears once (as held). Ticker resolution mirrors TokenList.vue:
 * metadata.ticker || name || metadata.name || unit prefix.
 */
export function buildRefs(
  tokens: Record<string, WalletTokenLike>,
  watchlistUnits: string[],
  categories: CopilotCategoryFlags,
): TokenRef[] {
  const refs: TokenRef[] = [];
  const seen = new Set<string>();

  if (categories.bags) {
    for (const [unit, t] of Object.entries(tokens || {})) {
      if (unit === 'lovelace' || seen.has(unit)) continue;
      seen.add(unit);
      const ticker = t.metadata?.ticker || t.name || t.metadata?.name || unit.slice(0, 6);
      refs.push({ unit, ticker, held: true });
    }
  }

  if (categories.watchlist) {
    for (const unit of watchlistUnits || []) {
      if (unit === 'lovelace' || seen.has(unit)) continue;
      seen.add(unit);
      refs.push({ unit, ticker: unit.slice(0, 6), held: false });
    }
  }

  return refs;
}
