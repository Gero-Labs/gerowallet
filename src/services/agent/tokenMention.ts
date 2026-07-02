// Detects when a chat message mentions a token the user HOLDS, so the dock can attach a
// price chart. Matching against the user's holdings (rather than the whole market) is
// reliable + synchronous, and the held token's unit IS the market-api assetId, so no
// resolver round-trip is needed. Tickers shorter than 3 chars are ignored to avoid
// false positives on short words.

interface TokenLike {
  unit: string;
  name?: string;
  metadata?: { ticker?: string; name?: string } | null;
}

export interface TokenMention {
  symbol: string;
  assetId: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Return the held token whose ticker appears as a whole word in the message, preferring the
 * longest (most specific) match. Returns null if no held token is mentioned.
 */
export function detectHeldTokenMention(
  text: string,
  tokens: Record<string, TokenLike>,
): TokenMention | null {
  const msg = (text || '').trim();
  if (!msg) return null;
  let best: TokenMention | null = null;
  let bestLen = 0;
  for (const t of Object.values(tokens || {})) {
    if (!t || t.unit === 'lovelace') continue;
    const ticker = String(t.metadata?.ticker || t.name || t.metadata?.name || '').trim();
    if (ticker.length < 3) continue;
    const re = new RegExp(`\\b${escapeRegExp(ticker)}\\b`, 'i');
    if (re.test(msg) && ticker.length > bestLen) {
      best = { symbol: ticker.toUpperCase(), assetId: t.unit };
      bestLen = ticker.length;
    }
  }
  return best;
}
