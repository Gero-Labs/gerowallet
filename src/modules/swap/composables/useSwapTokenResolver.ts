import TokenMetadataStore from '@/stores/tokenMetadataStore';
import NetworkStore from '@/stores/networkStore';
import { resolveAsset } from '@/shared/utils/resolver';

/**
 * Minimal token-metadata shape consumed by the embedded <gero-swap> widget's
 * `resolveToken` host hook. Mirrors the widget's `TokenMeta` type.
 */
export interface TokenMetaLike {
  unit: string;
  decimals: number;
  ticker?: string;
  name?: string;
  img?: string;
  verified?: boolean;
  price?: number;
}

/** Shape of an entry in `tokenMetadataStore.state.tokens`, as set by `loadTokens()`. */
interface StoredTokenMeta {
  name?: string;
  ticker?: string;
  decimals?: number | string;
  verified?: boolean;
  price?: number;
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
 */
export function useSwapTokenResolver() {
  async function resolveToken(unit: string): Promise<TokenMetaLike | null> {
    if (unit === 'lovelace') return null; // widget seeds ADA (decimals 6) itself

    const stored = (TokenMetadataStore.state.tokens as Record<string, StoredTokenMeta>)[unit];
    const heldByWallet = NetworkStore.hasAsset(unit);

    if (!stored && !heldByWallet) {
      // Not in the swap-tradable registry and never seen in the wallet's
      // holdings — genuinely unknown. The widget blocks on this.
      return null;
    }

    if (stored) {
      return {
        unit,
        decimals: Number(stored.decimals ?? 0),
        ticker: stored.ticker,
        name: stored.name,
        verified: stored.verified ?? false,
        price: stored.price,
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
        img: asset?.img,
        verified: asset?.verified ?? false,
      };
    } catch {
      return {
        unit,
        decimals: 0,
        verified: false,
      };
    }
  }

  return { resolveToken };
}
