import marketApi from '@/api/market-api';
import type { TokenSnapshot } from './detectors';

export interface TokenRef {
  unit: string;
  ticker: string;
  held: boolean;
}

/**
 * Fetch a price snapshot for each token ref. Failures per token are swallowed (skipped),
 * so one bad token never breaks the whole feed. `unit` is passed straight to `getTokenPrice`
 * as the assetId (Task 6 owns building refs with the correct unit format).
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
