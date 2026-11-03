import marketApi, { type NftCollectionStats } from '@/api/market-api';

/** How many collections the top list asks for. */
export const TOP_NFT_COLLECTIONS_LIMIT = 200;

/** How long an answer is reused. The ranking moves slowly; a name does not move at all. */
const FRESH_MS = 10 * 60_000;

let cached: { at: number; list: NftCollectionStats[] } | null = null;
let inflight: Promise<NftCollectionStats[] | null> | null = null;

/**
 * The top collections by volume, one request shared by everyone who needs them: the collectibles
 * table (market data for the wallet's own collections) and the market page's lookalike warning
 * (names to compare against, ruling R8). A good answer is reused for ten minutes; callers that
 * ask while a request is out share it. Resolves to null when the market API cannot be read or
 * answers with something that is not a list, and a failure is not kept, so the next caller asks
 * again.
 */
export function loadTopNftCollections(): Promise<NftCollectionStats[] | null> {
  if (cached && Date.now() - cached.at < FRESH_MS) return Promise.resolve(cached.list);
  if (inflight) return inflight;
  inflight = marketApi
    .getNftCollections('volume', TOP_NFT_COLLECTIONS_LIMIT)
    .then((list) => {
      if (!Array.isArray(list)) return null;
      cached = { at: Date.now(), list };
      return list;
    })
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Test seam: forget the answer and any request in flight. */
export function resetTopNftCollections(): void {
  cached = null;
  inflight = null;
}
