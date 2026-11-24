// Nexus's Midnight token catalog, loaded once per network and kept for ten
// minutes in the page that asked. Verified tokens feed midnightTokenMeta()
// (midnightTokenRegistry.ts), so every Midnight screen names them; the full
// list (unverified tokens included) feeds the swap's token picker.
//
// Fails soft: no catalog (Nexus unreachable, or a Nexus without the route)
// leaves the built-in names in place and the picker with the wallet's own
// tokens. Pages only: the worker never needs a token's name.

import { shallowRef } from 'vue';
import { getMidnightApi } from '@/api/midnight-api';
import type { MidnightCatalogToken } from '@/api/midnightSwapWire';
import { setMidnightCatalogTokens } from './midnightTokenRegistry';
import { debugLog } from '@/utils/debug';

const CATALOG_FRESH_MS = 10 * 60_000;
const PAGE_SIZE = 200;
const MAX_PAGES = 5;

/** Every catalog token of the network last loaded (verified or not); empty when there is no catalog. */
export const midnightCatalogTokens = shallowRef<readonly MidnightCatalogToken[]>([]);

let loaded: { network: string; at: number } | null = null;
let inflight: { network: string; promise: Promise<void> } | null = null;

/** Load `network`'s catalog unless a fresh copy is held. Never throws. */
export function ensureMidnightTokenCatalog(network: string, opts: { force?: boolean } = {}): Promise<void> {
  if (!opts.force && loaded?.network === network && Date.now() - loaded.at < CATALOG_FRESH_MS) return Promise.resolve();
  if (inflight?.network === network) return inflight.promise;
  const promise = (async () => {
    try {
      const api = getMidnightApi(network);
      const tokens: MidnightCatalogToken[] = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const result = await api.getTokenCatalog({ limit: PAGE_SIZE, offset: page * PAGE_SIZE });
        if (!result) break;
        tokens.push(...result.tokens);
        if (result.tokens.length < PAGE_SIZE || tokens.length >= result.total) break;
      }
      midnightCatalogTokens.value = tokens;
      setMidnightCatalogTokens(network, tokens);
      loaded = { network, at: Date.now() };
      debugLog('🌙 token catalog loaded', { tokens: tokens.length });
    } catch (error) {
      // Keep whatever was there: the built-in names still render.
      debugLog('🌙 token catalog unavailable', { error: error instanceof Error ? error.message : String(error) });
    } finally {
      inflight = null;
    }
  })();
  inflight = { network, promise };
  return promise;
}

/** A catalog token by colour, if the loaded catalog has it. */
export function catalogToken(tokenType: string): MidnightCatalogToken | undefined {
  const key = tokenType.toLowerCase();
  return midnightCatalogTokens.value.find(token => token.tokenType === key);
}

/** For tests: forget the loaded catalog. */
export function resetMidnightTokenCatalogForTests(): void {
  loaded = null;
  inflight = null;
  midnightCatalogTokens.value = [];
}
