// src/services/agent/tokenResolver.ts
import marketApi from '@/api/market-api';

/** Resolve a ticker/symbol to a market-api assetId by matching ascii name. Returns null if unknown. */
export async function resolveSymbolToAssetId(symbol: string): Promise<string | null> {
  const needle = (symbol || '').trim().toLowerCase();
  if (!needle) return null;
  const tokens = await marketApi.getTopByVolume(100);
  const hit = tokens.find(
    (t) => (t.assetNameAscii || '').toLowerCase() === needle,
  );
  return hit ? hit.assetId : null;
}
