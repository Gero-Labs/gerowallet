import TokenMetadataStore from '@/stores/tokenMetadataStore';
import NetworkStore from '@/stores/networkStore';
import { resolveAsset } from '@/shared/utils/resolver';
import { getTokenByUnit } from '@/modules/market/composables/useMarketData';
import { walletStore } from '@/stores/walletStore';

/**
 * Minimal token-metadata shape consumed by the embedded <gero-swap> widget's
 * `resolveToken` host hook. Mirrors the widget's `TokenMeta` type.
 */
export interface TokenMetaLike {
  unit: string;
  decimals: number;
  ticker?: string;
  name?: string;
  img?: string | null;
  verified?: boolean;
  price?: number;
  /** Base-units integer string (e.g. lovelace amount). Omitted (undefined) when unheld. */
  balance?: string;
}

/** Shape of an entry in `tokenMetadataStore.state.tokens`, as set by `loadTokens()`. */
interface StoredTokenMeta {
  name?: string;
  ticker?: string;
  decimals?: number | string;
  verified?: boolean;
  price?: number;
}

/** Shape of an entry in `walletStore.tokens`, as set by `walletBg.ts`'s `setAssets()`. */
interface HeldToken {
  quantity?: bigint | string;
}

/**
 * Base-units balance for a single unit, read directly off the wallet's current
 * holdings. `'lovelace'` reads `walletStore.account.controlled_amount` (the
 * same field `SwapCard.vue`'s `getHeldAmount` uses); every other unit reads
 * `walletStore.tokens[unit].quantity`. Returns `undefined` (never `'0'`) when
 * the wallet doesn't hold the unit.
 */
function getHeldBalance(unit: string): string | undefined {
  if (unit === 'lovelace') {
    const amt = walletStore.account?.controlled_amount;
    return amt ? String(amt) : undefined;
  }
  const tokens = walletStore.tokens as Record<string, HeldToken> | undefined;
  const q = tokens?.[unit]?.quantity;
  if (q === undefined || q === null) return undefined;
  return typeof q === 'bigint' ? q.toString() : String(q);
}

/**
 * Builds a unit → base-units-balance lookup from the wallet's full current
 * holdings in one pass. Exported for `GeroSwapEmbed.vue`'s token-catalog
 * enrichment, which needs to annotate every catalog entry with `balance` and
 * should build this once rather than re-deriving it per token.
 */
export function buildHeldBalanceMap(): Map<string, string> {
  const map = new Map<string, string>();
  const lovelace = getHeldBalance('lovelace');
  if (lovelace) map.set('lovelace', lovelace);
  const tokens = (walletStore.tokens as Record<string, HeldToken>) || {};
  for (const [unit, token] of Object.entries(tokens)) {
    if (unit === 'lovelace') continue; // covered by controlled_amount above
    const q = token?.quantity;
    if (q === undefined || q === null) continue;
    map.set(unit, typeof q === 'bigint' ? q.toString() : String(q));
  }
  return map;
}

/**
 * Produces `TokenMeta` for the embedded swap widget from gerowallet's existing
 * token metadata sources.
 *
 * Decimals source decision:
 * - Primary: `tokenMetadataStore` (DexHunter's swap-tradable token registry,
 *   populated via `loadTokens()`). Every token that can actually be swapped is
 *   keyed by unit here with decimals/verified/price/ticker already resolved —
 *   this is the cleanest, most complete source and needs no async on-chain work.
 * - Fallback: `resolveAsset` (on-chain / CIP-68 metadata + image), used only for
 *   tokens the wallet holds (`NetworkStore.hasAsset`) but that are absent from
 *   the swap registry (e.g. not currently DEX-listed). Decimals default to 0
 *   when no explicit metadata.decimals is found — this matches the wallet's
 *   own display convention for known-but-unregistered tokens (see
 *   `useMarketData`'s `enrichWithStores`: `apiToken.decimals ?? dhToken?.decimals ?? 0`).
 *
 * Known-vs-unknown contract:
 * - `'lovelace'` always resolves to `null` — the widget seeds ADA (decimals 6) itself.
 * - A token is "known" to the wallet if it's present in the swap registry OR the
 *   wallet has ever seen it as a held asset. Known tokens NEVER resolve to `null`
 *   — decimals fall back to 0 rather than blocking the swap.
 * - `null` is returned ONLY for tokens absent from both sources (genuinely
 *   unknown), since the widget treats `null` as UNKNOWN_TOKEN_DECIMALS and blocks.
 *
 * Hydration race (see `walletManager.service.ts` / `loadTokens()`):
 * `tokenMetadataStore.state.tokens` is populated asynchronously (~100ms after
 * login, via a DexHunter network fetch) and is `{}` right after login/reload.
 * If we resolved "not stored and not held" to `null` immediately, we'd wrongly
 * block a swap into any token the wallet doesn't already hold — i.e. most
 * "buy" tokens — during that window. So before concluding a token is
 * genuinely unknown, we hydrate the registry once (only if it's still empty,
 * to avoid a redundant fetch on every resolve) and re-check.
 *
 * One-shot guard: if that hydration attempt fails (or otherwise leaves the map
 * empty), `hydrationAttempted` stops every subsequent unknown-token resolve in
 * this composable's lifetime from re-triggering `loadTokens()` — a single
 * failed fetch shouldn't turn into a full network round-trip per resolve. A
 * later successful populate (e.g. a background retry elsewhere) is still
 * picked up normally, since the `stored` lookup above always runs first.
 *
 * img: store entries (see `loadTokens()` above) never carry an image field
 * themselves — DexHunter's swap-tradable registry only has name/ticker/
 * decimals/verified/price. `resolveAsset({unit})` is synchronous and reads
 * from the already-in-memory `NetworkStore.state.assets` cache (populated by
 * `AssetsLoader` from the local blockchain DB), so calling it for `.img` on
 * every resolve is a local cache lookup, not a network round trip — safe to
 * do unconditionally for both the store and held-only paths. When the asset
 * isn't cached (e.g. not held, not previously seen), `resolveAsset` simply
 * returns `img: undefined`, which we normalize to `null` per the widget's
 * `TokenMeta` contract.
 *
 * balance: sourced from the wallet's own holdings (`walletStore.tokens` /
 * `walletStore.account.controlled_amount`, the same fields
 * `SwapCard.vue`'s `getHeldAmount` already reads for this exact purpose) via
 * `getHeldBalance()` below, always as a base-units integer string. Left
 * `undefined` (not `'0'`) when the wallet doesn't hold the unit at all — the
 * widget hides the balance row gracefully in that case.
 */
export function useSwapTokenResolver() {
  // One-shot guard (per composable lifetime): once a hydration attempt has been
  // made for an empty map, don't attempt it again — see the doc comment above.
  let hydrationAttempted = false;

  // Token logos come from market-data (market.gerowallet.io via Nexus), the app's
  // single source of truth for token images. `getTokenByUnit(unit)?.img` returns
  // the market logo (or undefined); we deliberately avoid getTokenImage()'s
  // chainLogo fallback so an unknown token doesn't render the ADA logo.
  // `getTokenByUnit` is imported as a module-level PASSIVE reader — it does NOT
  // call useMarketData(), so the swap never starts/sustains the 15s price poll;
  // it just reads whatever the shared cache already holds.

  async function resolveToken(unit: string): Promise<TokenMetaLike | null> {
    if (unit === 'lovelace') return null; // widget seeds ADA (decimals 6) itself

    let stored = (TokenMetadataStore.state.tokens as Record<string, StoredTokenMeta>)[unit];
    const heldByWallet = NetworkStore.hasAsset(unit);

    if (!stored && !heldByWallet) {
      // Not yet in the swap-tradable registry and never seen in the wallet's
      // holdings. Before declaring this genuinely unknown, make sure the
      // registry has actually finished hydrating — hydrate once if it's
      // still empty, then re-check. `loadTokens()` already swallows its own
      // errors, but we guard the await anyway so a failure here can never
      // crash resolution; it just falls through to the unknown/null path.
      if (!hydrationAttempted && Object.keys(TokenMetadataStore.state.tokens).length === 0) {
        hydrationAttempted = true;
        try {
          await TokenMetadataStore.loadTokens();
        } catch {
          // no-op: treat a hydration failure the same as "still unknown"
        }
        stored = (TokenMetadataStore.state.tokens as Record<string, StoredTokenMeta>)[unit];
      }

      if (!stored && !heldByWallet) {
        // Still absent after hydration — genuinely unknown. The widget
        // blocks on this.
        return null;
      }
    }

    if (stored) {
      const decimals = Number(stored.decimals);
      // Synchronous local-cache lookup (see doc comment above) — safe to call
      // unconditionally, even on this hot/common path.
      const cached = resolveAsset({ unit } as never);
      return {
        unit,
        decimals: Number.isFinite(decimals) ? decimals : 0,
        ticker: stored.ticker,
        name: stored.name,
        verified: stored.verified ?? false,
        price: stored.price,
        img: getTokenByUnit(unit)?.img || cached?.img || null,
        balance: getHeldBalance(unit),
      };
    }

    // Held by the wallet but absent from the swap registry: best-effort
    // on-chain/CIP-68 metadata + image, defaulting decimals to 0 rather than
    // ever returning null for a token the wallet already knows about.
    try {
      const asset = await resolveAsset({ unit } as never);
      return {
        unit,
        decimals: Number(asset?.metadata?.decimals ?? 0),
        ticker: asset?.metadata?.ticker,
        name: asset?.metadata?.name ?? asset?.name,
        img: getTokenByUnit(unit)?.img || asset?.img || null,
        verified: asset?.verified ?? false,
        balance: getHeldBalance(unit),
      };
    } catch {
      return {
        unit,
        decimals: 0,
        verified: false,
        img: null,
        balance: getHeldBalance(unit),
      };
    }
  }

  return { resolveToken };
}
