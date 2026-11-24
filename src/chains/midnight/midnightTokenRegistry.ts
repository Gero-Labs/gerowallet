/**
 * Metadata for Midnight unshielded tokens: Nexus's token catalog first
 * (midnightTokenCatalog.ts loads it into {@link setMidnightCatalogTokens}),
 * this file's hand-curated list as the fallback when Nexus is unreachable.
 * Only a VERIFIED catalog token gets a name here: the catalog also carries
 * names a token's issuer asserted on chain (MIP-0018), which anyone can claim,
 * so those never stand in for a listed token.
 *
 * The built-in list is the fallback: it predates the catalog (when Midnight
 * had no token metadata to look up anywhere) and keeps USDM named, and priced,
 * when Nexus cannot be reached.
 *
 * A color that is listed nowhere is not an error. It renders with a truncated
 * color as its ticker and its raw base-unit amount, explicitly labelled as
 * unscaled.
 */

import { shallowRef } from 'vue';

/** Metadata we assert for a known token color. */
export interface MidnightTokenMeta {
  /** Display name shown as the row subtitle. */
  name: string;
  /** Ticker shown as the row title. */
  symbol: string;
  /** Decimal exponent: raw base units / 10^decimals = display amount. */
  decimals: number;
  /**
   * Cardano `unit` whose market price stands in for this token's.
   *
   * ASSUMPTION, NOT A FEED. Pricing Midnight USDM off Cardano USDM asserts the
   * two are economically interchangeable, which holds only while the bridge
   * holds. If either side depegs or the bridge halts, this reports a
   * confidently wrong number and it flows into the portfolio total. Remove this
   * field rather than let it drift if that assumption stops being safe.
   */
  cardanoPriceUnit?: string;
}

/**
 * Token color (32-byte hex `tokenType`) → asserted metadata.
 *
 * USDM confirmed against mainnet on 2026-08-26: token color
 * `8c2c22bc…64e94b`, 6 decimals, observed as a real unshielded output in tx
 * `192c6cc5…69d2` at block 2306712.
 */
export const MIDNIGHT_TOKENS: Readonly<Record<string, MidnightTokenMeta>> = {
  '8c2c22bc0c37fa999d0611cb5c570f587938ac5ffc8b0925143dad4c0764e94b': {
    name: 'Midnight USDM',
    symbol: 'USDM',
    decimals: 6,
    cardanoPriceUnit:
      'c48cbb3d5e57ed56e276bc45f99ab39abe94e6cd7ac39fb402da47ad0014df105553444d',
  },
};

/**
 * Verified tokens of the catalog of the network last loaded (lower-case
 * colour → metadata). A shallow ref so every row re-renders when it arrives.
 */
const catalog = shallowRef<{ network: string | null; tokens: ReadonlyMap<string, MidnightTokenMeta> }>({ network: null, tokens: new Map() });

/** Replace the catalog with `network`'s verified tokens (a token without decimals is shown in base units). */
export function setMidnightCatalogTokens(
  network: string,
  tokens: ReadonlyArray<{ tokenType: string; symbol: string | null; name: string | null; decimals: number | null; verified: boolean }>,
): void {
  const verified = new Map<string, MidnightTokenMeta>();
  for (const token of tokens) {
    if (!token.verified || !token.symbol) continue;
    verified.set(token.tokenType.toLowerCase(), { symbol: token.symbol, name: token.name ?? token.symbol, decimals: token.decimals ?? 0 });
  }
  catalog.value = { network, tokens: verified };
}

/** Which network's catalog is loaded, if any. */
export function midnightCatalogNetwork(): string | null {
  return catalog.value.network;
}

/**
 * Metadata for a token color: the catalog's verified entry, else the built-in
 * one, else `undefined` (shown as a truncated colour in base units). A
 * built-in token keeps its price unit whatever the catalog says.
 */
export function midnightTokenMeta(tokenType: string): MidnightTokenMeta | undefined {
  const builtIn = MIDNIGHT_TOKENS[tokenType] ?? MIDNIGHT_TOKENS[tokenType.toLowerCase()];
  const listed = catalog.value.tokens.get(tokenType.toLowerCase());
  if (listed) return builtIn?.cardanoPriceUnit ? { ...listed, cardanoPriceUnit: builtIn.cardanoPriceUnit } : listed;
  return builtIn;
}

/** Whether a token is listed: verified in the catalog, or built in. */
export function isListedMidnightToken(tokenType: string): boolean {
  return midnightTokenMeta(tokenType) !== undefined;
}
