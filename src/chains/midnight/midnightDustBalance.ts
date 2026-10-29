/**
 * The merged DUST balance (Path A + Path B), read once, for code that cannot use
 * `useMidnightDustLive`: the background, answering a dApp's `getDustBalance` (issue 1118).
 *
 * `midnightStore.dustState` is Nexus's Path-A figure, computed from native NIGHT
 * registrations only, so a wallet whose DUST comes from a Cardano cNIGHT registration
 * (Path B) reads `{ cap: 0, balance: 0 }` there. Handed to a dApp, that zero reads as
 * "cannot pay fees" and the dApp refuses to proceed. Anything that answers a third party
 * must read both paths, combined by the rule `useMidnightDustLive` applies; the rule lives
 * here so the two cannot drift:
 *   - Path B's `dust/destination` totals already contain native NIGHT registered to the
 *     same dust address, so once Path B reports a registration with destination-wide
 *     figures, Path B alone is the balance (adding Path A would count that NIGHT twice);
 *   - in every other case Path A is added.
 *
 * Never a confident zero before both paths have reported: {@link readMergedDustBalance}
 * returns null instead, and the caller says "not loaded yet".
 */
import type { MidnightDustState } from './midnightTypes';
import {
  DustDestinationUnsupportedError,
  type MidnightApi,
  type MidnightDustRegistrationStatusDto,
} from '@/api/midnight-api';

/** Nexus caps the status batch; matches `useDustPathB`. Fallback path only. */
const STATUS_BATCH_LIMIT = 50;

export interface DustFigures {
  /** DUST balance in base units. */
  readonly balance: bigint;
  /** Capacity in base units. */
  readonly cap: bigint;
}

export interface DustPathBFigures extends DustFigures {
  /** At least one stake is live-registered to this wallet's dust address. */
  readonly registered: boolean;
  /** The figures are destination-wide totals from `dust/destination` (false on the per-stake fallback). */
  readonly destinationWide: boolean;
}

/** Path B's figures already contain Path A's, so Path A must be dropped, not added. */
export function pathBSupersedesPathA(pathB: Pick<DustPathBFigures, 'registered' | 'destinationWide'>): boolean {
  return pathB.registered && pathB.destinationWide;
}

export function mergeDustFigures(pathA: DustFigures, pathB: DustPathBFigures): DustFigures {
  const a = pathBSupersedesPathA(pathB) ? { balance: 0n, cap: 0n } : pathA;
  return { balance: a.balance + pathB.balance, cap: a.cap + pathB.cap };
}

/** How full a DUST battery is, 0 to 100, or null when there is no capacity to show. */
export function dustBatteryPercent(balance: bigint, cap: bigint): { percent: number } | null {
  if (cap <= 0n) return null;
  const raw = Number((balance * 10000n) / cap) / 100;
  return { percent: Math.max(0, Math.min(100, Math.round(raw))) };
}

export interface DustAccountStateFigures extends DustFigures {
  readonly generating: bigint;
  readonly nightRegistered: bigint;
  readonly registrationStatus: string;
}

/**
 * Whether a `dust/account-state` answer says anything. The all-zero 'Unregistered' shape is
 * normal for a Path-B-only wallet (no NIGHT UTxOs indexed for its Midnight address), and must
 * not outrank a real figure in the gero-sync snapshot.
 */
export function dustAccountStateHasSignal(state: DustAccountStateFigures): boolean {
  return state.balance > 0n
    || state.generating > 0n
    || state.cap > 0n
    || state.nightRegistered > 0n
    || state.registrationStatus === 'Registered';
}

/** Registered `dust/status` rows pointing at this dust address. Each carries the address's total. */
export function statusRowsForDustAddress(
  rows: readonly MidnightDustRegistrationStatusDto[],
  dustAddress: string,
): MidnightDustRegistrationStatusDto[] {
  const dustLower = dustAddress.toLowerCase();
  return rows.filter((r) => r.registered === true && (r.dustAddress ?? '').toLowerCase() === dustLower);
}

export interface MergedDustReadInput {
  readonly api: Pick<MidnightApi, 'getDustAccountState' | 'getDustDestination' | 'getDustStatusBatch'>;
  readonly unshieldedAddress: string;
  readonly dustAddress: string;
  /** gero-sync's Path-A snapshot, used when the account-state poll fails or is hollow. */
  readonly storeDustState: MidnightDustState | null | undefined;
  /** Fallback only (a Nexus without `dust/destination`): the Cardano stakes this profile holds. */
  readonly enumerateStakes: () => Promise<string[]>;
}

/**
 * Both paths, read now and combined. Null while either path has not reported, unless Path B
 * alone supplies the balance.
 */
export async function readMergedDustBalance(input: MergedDustReadInput): Promise<DustFigures | null> {
  const [pathA, pathB] = await Promise.all([readPathA(input), readPathB(input)]);
  if (!pathB) return null;
  if (pathBSupersedesPathA(pathB)) return mergeDustFigures({ balance: 0n, cap: 0n }, pathB);
  return pathA ? mergeDustFigures(pathA, pathB) : null;
}

function toBig(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value !== 'string' || !value) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function storedPathA(state: MidnightDustState | null | undefined): DustFigures | null {
  if (!state || typeof state.current !== 'bigint' || typeof state.cap !== 'bigint') return null;
  return { balance: state.current, cap: state.cap };
}

/** As `useMidnightDustLive`: the poll when it says something, else the snapshot; a hollow poll with no snapshot is a zero that has reported. */
async function readPathA(input: MergedDustReadInput): Promise<DustFigures | null> {
  const stored = storedPathA(input.storeDustState);
  try {
    const res = await input.api.getDustAccountState(input.unshieldedAddress);
    const polled: DustAccountStateFigures = {
      balance: toBig(res.dust_balance),
      cap: toBig(res.dust_cap),
      generating: toBig(res.dust_generating),
      nightRegistered: toBig(res.night_registered),
      registrationStatus: res.dust_registration_status ?? 'Unregistered',
    };
    if (dustAccountStateHasSignal(polled)) return { balance: polled.balance, cap: polled.cap };
    return stored ?? { balance: 0n, cap: 0n };
  } catch {
    return stored;
  }
}

/** As `useDustPathB`: the destination's totals, or on an older Nexus one matching `dust/status` row. */
async function readPathB(input: MergedDustReadInput): Promise<DustPathBFigures | null> {
  try {
    const destination = await input.api.getDustDestination(input.dustAddress);
    return {
      balance: toBig(destination.currentCapacity),
      cap: toBig(destination.maxCapacity),
      registered: destination.registered,
      destinationWide: true,
    };
  } catch (error) {
    if (!(error instanceof DustDestinationUnsupportedError)) return null;
  }
  try {
    const stakes = await input.enumerateStakes();
    // Nothing to ask about: no registration this profile can see, the answer before Path B existed.
    if (stakes.length === 0) return { balance: 0n, cap: 0n, registered: false, destinationWide: false };
    const rows: MidnightDustRegistrationStatusDto[] = [];
    for (let i = 0; i < stakes.length; i += STATUS_BATCH_LIMIT) {
      rows.push(...(await input.api.getDustStatusBatch(stakes.slice(i, i + STATUS_BATCH_LIMIT))));
    }
    // One row, not a sum: every kept row is the same destination.
    const [first] = statusRowsForDustAddress(rows, input.dustAddress);
    return {
      balance: toBig(first?.currentCapacity),
      cap: toBig(first?.maxCapacity),
      registered: !!first,
      destinationWide: false,
    };
  } catch {
    return null;
  }
}

/** How long one merged read answers repeat asks: a dApp may ask on every render. */
export const MERGED_DUST_REUSE_MS = 5_000;

/**
 * Wraps {@link readMergedDustBalance} for a caller that is asked repeatedly: asks for the same
 * `key` within `reuseMs`, including ones made while the read is in flight, share one read. A
 * read that came back null is not reused, so the next ask tries again.
 */
export function reusedDustReader(reuseMs = MERGED_DUST_REUSE_MS, now: () => number = Date.now) {
  let entry: { key: string; at: number; result: Promise<DustFigures | null> } | null = null;
  return (key: string, read: () => Promise<DustFigures | null>): Promise<DustFigures | null> => {
    if (entry && entry.key === key && now() - entry.at < reuseMs) return entry.result;
    const result = read();
    const current = { key, at: now(), result };
    entry = current;
    void result.then((figures) => {
      if (figures === null && entry === current) entry = null;
    }, () => {
      if (entry === current) entry = null;
    });
    return result;
  };
}
