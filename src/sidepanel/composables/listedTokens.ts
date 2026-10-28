/** The fields that decide whether a token gets a row in the side panel's token list. */
export interface ListableToken {
  policy_id?: string;
  isScam?: boolean;
  verified?: boolean;
  isProgrammable?: boolean;
  /** Locked at the PLB address AND listed in the CIP-113 registry (issue 1267). */
  cip113Registered?: boolean;
}

/**
 * The tokens the side panel lists below the pinned ADA row: the wallet's spendable tokens and
 * its CIP-113 holdings, minus ADA itself, scams and unverified tokens. A registered CIP-113
 * token is exempt from verified-only (it is inherently unverified); a token merely sent to the
 * PLB address, whose policy the registry does not list, is not (issue 1267).
 *
 * The one rule for both the list and the header's count above it, so the two never disagree.
 */
export function listedTokens<T extends ListableToken>(
  tokens: Record<string, T> | null | undefined,
  programmableTokens: Record<string, T> | null | undefined,
): T[] {
  if (!tokens) return [];
  return [...Object.values(tokens), ...Object.values(programmableTokens || {})].filter((token) => {
    if (token.policy_id === '') return false;
    if (token.isScam) return false;
    if (!token.verified && !(token.isProgrammable && token.cip113Registered)) return false;
    return true;
  });
}
