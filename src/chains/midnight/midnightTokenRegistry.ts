/**
 * Hand-curated metadata for Midnight unshielded tokens.
 *
 * INTERIM — DELETE THIS FILE when the foundation ships token MIPs.
 *
 * Midnight has no resolvable token metadata today. Verified 2026-08-26: the
 * mainnet indexer's entire query surface is `block`, `transactions`,
 * `contractAction`, the `dust*` family, `dParameterHistory`,
 * `termsAndConditionsHistory` and `spoIdentities` — there is no asset or token
 * query of any kind. Nexus has no `chain=MIDNIGHT` branch either
 * (`POST /api/assets/info?chain=MIDNIGHT` returns 400 where `chain=CARDANO`
 * returns 200). So a name, a symbol and a decimal exponent cannot be looked up
 * from anywhere; they can only be asserted.
 *
 * That is why this is a literal in the extension rather than a registry served
 * by Nexus. With one listed token, a backend resolver would buy nothing and
 * cost a deploy coupling, and MIP-0011-style standards will replace the whole
 * mechanism rather than extend it. One file to delete beats one endpoint to
 * unpick.
 *
 * A color that is NOT listed here is not an error. It renders with a truncated
 * color as its ticker and its raw base-unit amount, explicitly labelled as
 * unscaled. That path is permanent, not a stopgap: with manual curation, every
 * new token starts unlisted.
 */

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

/** Asserted metadata for a token color, or `undefined` when it is not listed. */
export function midnightTokenMeta(tokenType: string): MidnightTokenMeta | undefined {
  return MIDNIGHT_TOKENS[tokenType];
}
