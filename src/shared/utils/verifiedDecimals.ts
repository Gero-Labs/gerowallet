import i18n from '@/plugins/i18n';
import { debugLog } from '@/utils/debug';
import { koiosBaseUrl } from '@/shared/utils/provenInputs';

/**
 * Token decimals the wallet confirms outside Gero's backend before a typed amount
 * becomes the quantity it signs.
 *
 * A token's decimals reach the wallet from Gero's backend (asset metadata, the
 * token catalogue). The send and swap flows turn what the user types into base
 * units with them, and every later check (the built-transaction guard, the swap
 * spend bound) compares against those base units. So a backend that reports 0
 * decimals for a 6-decimal token makes "10" send 10 base units, and one that
 * reports 12 makes it send a million times what the user meant, with nothing
 * downstream able to tell.
 *
 * Decimals are published in exactly two places: the Cardano Token Registry
 * (CIP-26) and a CIP-68 fungible token's reference datum. Koios, a public indexer
 * independent of Gero's backend, serves both. The decimals a flow used must be one
 * of the published values (0 when none is published), or the flow stops.
 */

export type TokenDecimalsProblem = 'mismatch' | 'unverified';

/** The decimals a flow used for a typed amount. */
export interface UsedDecimals {
  unit: string;
  decimals: number;
}

/** Published decimals for each unit the source knows; units it does not know are left out. */
export type DecimalsSource = (units: string[]) => Promise<Map<string, ReadonlySet<number>>>;

export class TokenDecimalsError extends Error {
  readonly problem: TokenDecimalsProblem;
  readonly units: string[];
  constructor(problem: TokenDecimalsProblem, units: string[]) {
    super(String(i18n.t(problem === 'mismatch' ? 'txGuard.tokenDecimalsMismatch' : 'txGuard.tokenDecimalsUnverified')));
    this.name = 'TokenDecimalsError';
    this.problem = problem;
    this.units = units;
  }
}

/** Hex of "decimals", the CIP-68 metadata key. */
const DECIMALS_KEY_HEX = '646563696d616c73';
/** The CIP-68 label of a fungible user token, as Koios keys its reference datum. */
const CIP68_FT_LABEL = '333';

function decimalsValue(value: unknown): number | null {
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= 255 ? n : null;
}

/** The decimals in a CIP-68 333 reference datum as Koios returns it, or null. */
export function cip68Decimals(cip68Metadata: unknown): number | null {
  const datum = (cip68Metadata as Record<string, unknown> | null | undefined)?.[CIP68_FT_LABEL] as
    { fields?: Array<{ map?: Array<{ k?: { bytes?: unknown }; v?: { int?: unknown } }> }> } | undefined;
  const entries = datum?.fields?.[0]?.map;
  if (!Array.isArray(entries)) return null;
  const entry = entries.find((e) => String(e?.k?.bytes ?? '').toLowerCase() === DECIMALS_KEY_HEX);
  return entry ? decimalsValue(entry.v?.int) : null;
}

/** Every value an asset_info row publishes for its decimals; none published means 0. */
export function publishedDecimals(row: { token_registry_metadata?: unknown; cip68_metadata?: unknown }): Set<number> {
  const published = new Set<number>();
  const registry = decimalsValue((row.token_registry_metadata as { decimals?: unknown } | null | undefined)?.decimals);
  if (registry !== null) published.add(registry);
  const cip68 = cip68Decimals(row.cip68_metadata);
  if (cip68 !== null) published.add(cip68);
  if (published.size === 0) published.add(0);
  return published;
}

const KOIOS_BATCH = 50;
const KOIOS_TIMEOUT_MS = 15_000;

/** Koios `asset_info`. No source for a network Koios does not serve. */
export function koiosDecimalsSource(network: string | undefined, fetchImpl: typeof fetch = fetch): DecimalsSource {
  const base = koiosBaseUrl(network);
  return async (units) => {
    const found = new Map<string, ReadonlySet<number>>();
    if (!base) return found;
    for (let i = 0; i < units.length; i += KOIOS_BATCH) {
      const batch = units.slice(i, i + KOIOS_BATCH);
      const response = await fetchImpl(`${base}/asset_info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ _asset_list: batch.map((unit) => [unit.slice(0, 56), unit.slice(56)]) }),
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(KOIOS_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Koios asset_info answered ${response.status}`);
      const rows = (await response.json()) as unknown;
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        const r = row as { policy_id?: unknown; asset_name?: unknown };
        if (typeof r?.policy_id !== 'string') continue;
        const unit = `${r.policy_id}${typeof r.asset_name === 'string' ? r.asset_name : ''}`.toLowerCase();
        found.set(unit, publishedDecimals(row as Parameters<typeof publishedDecimals>[0]));
      }
    }
    return found;
  };
}

/** Confirmed answers, per network and unit, for this page. Decimals are set once by their issuer. */
const confirmed = new Map<string, { published: ReadonlySet<number>; at: number }>();
const CONFIRMED_TTL_MS = 60 * 60 * 1000;

/** For tests. */
export function clearConfirmedDecimals(): void {
  confirmed.clear();
}

/**
 * Throws {@link TokenDecimalsError} unless every token's `decimals` is one its issuer
 * published: 'mismatch' when the source disagrees, 'unverified' when it could not
 * answer (it failed, or does not know the unit yet). ADA needs no check.
 */
export async function assertTokenDecimals(
  used: readonly UsedDecimals[],
  network: string | undefined,
  source: DecimalsSource = koiosDecimalsSource(network),
  now: () => number = Date.now,
): Promise<void> {
  const wanted = new Map<string, number[]>();
  for (const { unit, decimals } of used) {
    const key = String(unit).toLowerCase();
    if (!key || key === 'lovelace') continue;
    wanted.set(key, [...(wanted.get(key) ?? []), decimals]);
  }
  if (wanted.size === 0) return;

  const cacheKey = (unit: string) => `${network ?? ''}|${unit}`;
  const missing = [...wanted.keys()].filter((unit) => {
    const hit = confirmed.get(cacheKey(unit));
    return !hit || now() - hit.at > CONFIRMED_TTL_MS;
  });
  if (missing.length > 0) {
    let answers = new Map<string, ReadonlySet<number>>();
    try {
      answers = await source(missing);
    } catch (e) {
      debugLog('Token decimals: the independent source failed', e);
    }
    for (const [unit, published] of answers) confirmed.set(cacheKey(unit.toLowerCase()), { published, at: now() });
  }

  const unverified: string[] = [];
  const mismatched: string[] = [];
  for (const [unit, decimalsUsed] of wanted) {
    const published = confirmed.get(cacheKey(unit))?.published;
    if (!published) unverified.push(unit);
    else if (decimalsUsed.some((d) => !published.has(d))) mismatched.push(unit);
  }
  if (mismatched.length > 0) throw new TokenDecimalsError('mismatch', mismatched);
  if (unverified.length > 0) throw new TokenDecimalsError('unverified', unverified);
}
