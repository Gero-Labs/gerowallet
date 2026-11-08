/** The fields that decide whether a token gets a row in the side panel's token list. */
export interface ListableToken {
  policy_id?: string;
  isScam?: boolean;
  verified?: boolean;
  isProgrammable?: boolean;
  /** Locked at the PLB address AND listed in the CIP-113 registry (issue 1267). */
  cip113Registered?: boolean;
}

/** Where a side-panel token row can state its decimals. */
export interface DecimalsRow {
  decimals?: unknown;
  metadata?: { decimals?: unknown } | null;
}

function decimalsCount(value: unknown): number | undefined {
  const n = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value;
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : undefined;
}

/**
 * A side-panel token row's decimals, or undefined when the row states none. The pinned ADA row
 * carries them at the top level; a wallet token only in its metadata. The list, the token sheet
 * and the sheet's Send all read them here (issue 1441: the sheet read the top level alone and
 * divided every token by 10^6), and each caller picks its own default for undefined.
 */
export function tokenRowDecimals(row: DecimalsRow | null | undefined): number | undefined {
  return decimalsCount(row?.decimals) ?? decimalsCount(row?.metadata?.decimals);
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
