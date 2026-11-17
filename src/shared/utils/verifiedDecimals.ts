import { chunkArray } from 'array-chunk-by-size';
import { Api } from '@/api/api';
import i18n from '@/plugins/i18n';
import networks from '@/utils/networks';
import { debugLog } from '@/utils/debug';

/**
 * Token decimals confirmed by gero-backend before a typed amount becomes the quantity the
 * wallet signs.
 *
 * A token's decimals reach the wallet through gero-sync (the asset rows it pushes carry
 * `metadata.decimals`) and, for a swap, through the swap token catalogue. The Send flows and
 * the swap spend bound turn what the user types into base units with them, and every later
 * check (the built-transaction guard, the swap spend bound) compares against those base units.
 * A forged, larger value makes "send 10" send 10^k times more, and the review shows the same
 * forged number, so nothing downstream notices. Neither gero-sync nor the path to it is
 * authenticated.
 *
 * So before a flow converts a typed token amount it asks gero-backend's own
 * `POST /api/assets/info` for the token's decimals and converts with that answer. The
 * answer is authenticated as gero-backend's once that path is signed and the build enforces
 * signatures (`src/api/signedResponses.ts`, through the `Api` client). When the decimals the
 * flow was about to use differ, the flow stops ('mismatch'); when the backend cannot answer
 * for a token, it stops too ('unverified'). Nothing falls back to the unauthenticated value
 * and nothing asks a third party. ADA is always 6 and is never looked up.
 */

export type TokenDecimalsProblem = 'mismatch' | 'unverified';

/** The decimals a flow is about to convert a typed amount of `unit` with. */
export interface UsedDecimals {
  unit: string;
  /** As the flow holds it: token metadata may carry a number, a bigint (a CIP-68 datum) or a string. */
  decimals: number | bigint | string | null | undefined;
}

/** The wallet the tokens belong to: the chain and network gero-backend is asked about. */
export interface DecimalsTarget {
  chain?: string;
  network?: string;
}

/**
 * The decimals gero-backend states for each unit it answered for, keyed by lower-case unit.
 * A unit it gave no usable answer for is left out. Throws when it could not answer at all.
 */
export type DecimalsSource = (units: string[]) => Promise<Map<string, number>>;

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

const LOVELACE = 'lovelace';
const ADA_DECIMALS = 6;
/** A Cardano asset unit: a 28-byte policy id and an asset name of at most 32 bytes, in hex. */
const UNIT_PATTERN = /^[0-9a-f]{56}(?:[0-9a-f]{2}){0,32}$/;

/** A decimals value as a small whole number, or null for anything else. */
function decimalsValue(value: unknown): number | null {
  let n: unknown = value;
  if (typeof value === 'bigint') n = Number(value);
  else if (typeof value === 'string' && /^\d+$/.test(value.trim())) n = Number(value.trim());
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= 255 ? n : null;
}

/** Hex of "decimals", the CIP-68 metadata key. */
const DECIMALS_KEY_HEX = '646563696d616c73';
/**
 * CIP-67 asset-name prefixes of the CIP-68 tokens whose reference datum may carry decimals,
 * mapped to the label the datum is keyed by: 333 (fungible) and 444 (rich fungible).
 */
const CIP68_FUNGIBLE_PREFIXES: Readonly<Record<string, string>> = { '0014df10': '333', '001bc280': '444' };

/**
 * The decimals in a CIP-68 fungible token's reference datum, as gero-backend's asset row
 * carries it in `onchain_metadata_extra` (the datums keyed by label, as a JSON string or
 * already parsed), or null when the unit is not such a token or the datum says nothing usable.
 */
export function cip68Decimals(unit: string, onchainMetadataExtra: unknown): number | null {
  const label = CIP68_FUNGIBLE_PREFIXES[unit.slice(56, 64)];
  if (!label) return null;
  let extra: unknown = onchainMetadataExtra;
  if (typeof extra === 'string') {
    try {
      extra = JSON.parse(extra);
    } catch {
      return null;
    }
  }
  if (!extra || typeof extra !== 'object') return null;
  const datum = (extra as Record<string, unknown>)[label] as
    { fields?: Array<{ map?: Array<{ k?: { bytes?: unknown }; v?: { int?: unknown } }> }> } | undefined;
  const entries = datum?.fields?.[0]?.map;
  if (!Array.isArray(entries)) return null;
  const entry = entries.find((e) => String(e?.k?.bytes ?? '').toLowerCase() === DECIMALS_KEY_HEX);
  return entry ? decimalsValue(entry.v?.int) : null;
}

/**
 * The decimals gero-backend's asset row states for `unit`, or null when the row states
 * nothing usable (no row, or a malformed one: the flow then refuses as 'unverified').
 *
 * What "no decimals" means, from the backend model and the wallet's own asset mapping:
 * gero-backend answers with a list of cardano-client-lib `Asset` rows (snake_case JSON), one
 * per asset its provider knows. Decimals sit in two places in a row:
 *  - `metadata`, the token's off-chain registry entry (CIP-26) as the provider returned it or
 *    the backend's registry backfill filled it (`RegistryMetadataEnricher`): a JSON object
 *    whose `decimals` is a nullable Integer. `metadata` is null when the token has no entry.
 *  - `onchain_metadata_extra`, a CIP-68 token's reference datums keyed by label: a fungible
 *    (333, or 444) datum may carry `decimals`.
 * Both standards define a token that publishes no decimals as having none (0), and the wallet
 * maps every asset row the same way (`metadata?.decimals ?? 0` in the flows; resolver.ts
 * replaces `metadata` with a 333 datum and keeps its decimals when they are set). So a row
 * present for the unit with no decimals in it is the backend explicitly stating 0, while a
 * unit with no row at all is the backend stating nothing about it.
 *
 * Precedence, as the wallet's mapping: a CIP-68 datum's non-zero decimals; otherwise the
 * registry entry's (where resolver.ts reads the swap catalogue, whose figure comes from the
 * same registry but is not part of this signed answer); otherwise 0.
 *
 * A degraded backend (its registry backfill swallows failures and leaves `metadata` null)
 * can only lower the stated figure to 0. That refuses a send whose true decimals are larger,
 * but never confirms a value larger than the token's own: the direction that sends more.
 */
export function decimalsFromAssetInfo(unit: string, row: unknown): number | null {
  if (!row || typeof row !== 'object') return null;
  const asset = row as { metadata?: unknown; onchain_metadata_extra?: unknown };
  const datum = cip68Decimals(unit.toLowerCase(), asset.onchain_metadata_extra);
  if (datum !== null && datum > 0) return datum;
  const registry = asset.metadata;
  if (registry === null || registry === undefined) return 0;
  if (typeof registry !== 'object') return null;
  const declared = (registry as { decimals?: unknown }).decimals;
  if (declared === null || declared === undefined) return 0;
  return decimalsValue(declared);
}

/** Request bytes per asset-info call, as the wallet's asset sync batches them. */
const ASSET_INFO_BATCH_BYTES = 4000;
/** The `Api` client waits two minutes; a send waiting on this check gives up sooner. */
const ASSET_INFO_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`asset info timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * gero-backend's `POST /api/assets/info` for the target's chain and network, through the
 * `Api` client (which carries the response-signature check). Only rows for units that were
 * asked are read; a unit answered twice with different decimals is left out.
 */
export function geroBackendDecimalsSource(
  target: DecimalsTarget,
  api?: Pick<Api, 'getAssetsInfo'>,
): DecimalsSource {
  return async (units) => {
    const client = api ?? new Api(
      { chain: target.chain, network: target.network },
      networks.resolveDefaultProvider(target.chain ?? '', target.network ?? ''),
    );
    const stated = new Map<string, number>();
    const conflicted = new Set<string>();
    const batches: string[][] = chunkArray({ input: units, bytesSize: ASSET_INFO_BATCH_BYTES });
    for (const batch of batches) {
      const { status, data } = await withTimeout(client.getAssetsInfo(batch), ASSET_INFO_TIMEOUT_MS);
      if (status !== 200 || !Array.isArray(data)) throw new Error(`asset info answered ${status}`);
      const asked = new Set(batch.map((unit) => unit.toLowerCase()));
      for (const row of data as unknown[]) {
        const unit = typeof (row as { asset?: unknown })?.asset === 'string' ? (row as { asset: string }).asset.toLowerCase() : '';
        if (!asked.has(unit)) continue;
        const decimals = decimalsFromAssetInfo(unit, row);
        if (decimals === null) continue;
        if (stated.has(unit) && stated.get(unit) !== decimals) conflicted.add(unit);
        stated.set(unit, decimals);
      }
    }
    for (const unit of conflicted) stated.delete(unit);
    return stated;
  };
}

/** Confirmed answers for this page, per chain, network and unit. A token's decimals do not change. */
const confirmed = new Map<string, { decimals: number; at: number }>();
const CONFIRMED_TTL_MS = 60 * 60 * 1000;

/** For tests. */
export function clearConfirmedDecimals(): void {
  confirmed.clear();
}

/**
 * The decimals gero-backend confirms for each token in `used`, keyed by the unit as given
 * (ADA as 6, never looked up). The flow converts the typed amounts with these.
 *
 * Throws {@link TokenDecimalsError} unless every token's decimals equal the backend's:
 * 'mismatch' when they differ, 'unverified' when the backend could not answer for the token
 * (it failed or timed out, gave no row, or the unit is malformed). Answers are kept for an
 * hour; a kept answer that disagrees with the flow is asked again before the flow is refused,
 * so an answer kept from earlier never blocks a send on its own.
 */
export async function confirmTokenDecimals(
  used: readonly UsedDecimals[],
  target: DecimalsTarget | null | undefined,
  source?: DecimalsSource,
  now: () => number = Date.now,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const wanted = new Map<string, { units: string[]; decimals: (number | null)[] }>();
  const malformed: string[] = [];
  let adaMismatch = false;
  for (const { unit, decimals } of used) {
    const given = String(unit ?? '');
    const key = given.toLowerCase();
    const value = decimalsValue(decimals);
    if (key === LOVELACE) {
      result.set(given, ADA_DECIMALS);
      if (value !== ADA_DECIMALS) adaMismatch = true;
      continue;
    }
    if (!UNIT_PATTERN.test(key)) {
      malformed.push(given);
      continue;
    }
    const entry = wanted.get(key) ?? { units: [], decimals: [] };
    entry.units.push(given);
    entry.decimals.push(value);
    wanted.set(key, entry);
  }

  const scope = `${target?.chain ?? ''}|${target?.network ?? ''}`;
  const cacheKey = (unit: string) => `${scope}|${unit}`;
  const fresh = (unit: string) => {
    const hit = confirmed.get(cacheKey(unit));
    return hit && now() - hit.at <= CONFIRMED_TTL_MS ? hit.decimals : undefined;
  };
  const ask = [...wanted].filter(([unit, { decimals }]) => {
    const known = fresh(unit);
    return known === undefined || decimals.some((d) => d !== known);
  }).map(([unit]) => unit);
  if (ask.length > 0) {
    let answers = new Map<string, number>();
    try {
      answers = await (source ?? geroBackendDecimalsSource(target ?? {}))(ask);
    } catch (e) {
      debugLog('Token decimals: gero-backend could not answer', e);
    }
    for (const [unit, decimals] of answers) confirmed.set(cacheKey(unit.toLowerCase()), { decimals, at: now() });
  }

  const unverified = [...malformed];
  const mismatched: string[] = adaMismatch ? [LOVELACE] : [];
  for (const [unit, { units, decimals }] of wanted) {
    const known = fresh(unit);
    if (known === undefined) {
      unverified.push(unit);
      continue;
    }
    if (decimals.some((d) => d !== known)) mismatched.push(unit);
    for (const given of units) result.set(given, known);
  }
  if (mismatched.length > 0) throw new TokenDecimalsError('mismatch', mismatched);
  if (unverified.length > 0) throw new TokenDecimalsError('unverified', unverified);
  return result;
}
