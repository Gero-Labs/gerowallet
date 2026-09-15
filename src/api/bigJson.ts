/**
 * Precision-safe JSON parsing for responses containing large integers.
 *
 * Nexus serializes Java `BigInteger` fields — voting power, deposits, stake
 * totals — as bare JSON numbers, and has no Jackson configuration that would
 * quote them. `JSON.parse` silently rounds anything above 2^53, which is
 * exactly the range Cardano stake figures occupy: total active DRep stake is
 * ~2.5e16 against a MAX_SAFE_INTEGER of 9.007e15.
 *
 * This rewrites long integer literals to strings BEFORE parsing, so the caller
 * receives a lossless decimal string it can hand to `toLovelace()`. Values that
 * are safely representable are left as numbers, so `page`, `index` and the
 * `*Pct` doubles keep their natural types.
 *
 * The regex only matches a number in JSON *value* position — after `:` or `[`
 * or `,` — and the string-skipping alternation consumes whole string literals
 * first, so digits inside a string are never touched.
 */

// Alternation order matters: a complete string literal (including escapes) is
// matched first and echoed back untouched, so the number branch can only ever
// fire outside of strings.
const BIG_INT_IN_VALUE_POSITION = /("(?:[^"\\]|\\.)*")|(?<=[:[,]\s{0,64})(-?\d{16,})(?=\s*[,}\]])/g;

/**
 * Parse a JSON string, converting integers too large for `number` into strings.
 * Returns null for empty or malformed input — an API client must not throw on a
 * bad body, it must surface an error state.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- default for untyped call sites: the parsed body is a dynamic API-response bag; typed callers pass their DTO as T
export function parseBigJson<T = any>(text: string): T | null {
  if (!text) return null;
  try {
    const guarded = text.replace(BIG_INT_IN_VALUE_POSITION, (match, stringLiteral, bigInt) =>
      stringLiteral !== undefined ? stringLiteral : `"${bigInt}"`
    );
    return JSON.parse(guarded) as T;
  } catch {
    return null;
  }
}

/**
 * Drop-in `transformResponse` for an Axios instance. Axios passes the raw body
 * text when `transformResponse` is supplied, so this replaces the default
 * `JSON.parse` entirely.
 */
export const bigJsonTransform = [(data: unknown) => (typeof data === 'string' ? parseBigJson(data) : data)];
