/**
 * RealFi read client — the single boundary between this module and the network.
 *
 * Every read goes to Nexus (`/api/realfi/*`) through gero-backend's Nexus proxy, which
 * injects the API key. The wallet never calls RealFi or loads its SDK. That keeps the
 * user's address and IP away from a third party, lets one server-side cache serve the
 * protocol read for everybody, and means the extension build needs no credential for
 * RealFi's private npm package.
 *
 * Reads only. Order building (stake, unstake, claim, cancel) lives in `realfiOrders.ts`.
 */

import axios, { type AxiosInstance } from 'axios';
import { toNexusNetwork } from '@/api/nexus-tx-api';
import { installSignedResponses } from '@/api/signedResponses';
import {
  EMPTY_POINTS,
  EMPTY_REFERRALS,
  ORDER_ACTION_VALUES,
  ORDER_STATUS_VALUES,
  type RealFiOrder,
  type RealFiOrderAction,
  type RealFiOrderStatus,
  type RealFiPoints,
  type RealFiPosition,
  type RealFiApyPoint,
  type RealFiProtocol,
  type RealFiRateInputs,
  type RealFiReferrals,
  type RealFiReserveCustodian,
  type RealFiReserveHolding,
  type RealFiReserves,
  type RealFiReservesReport,
  type RealFiReserveSleeve,
  type RealFiUnavailableReason,
  type SmallestUnit,
} from '../types';

export interface RealFiReadClient {
  getPosition(address: string): Promise<RealFiPosition | null>;
  getPoints(address: string): Promise<RealFiPoints>;
  /**
   * `issueCode` makes RealFi MINT a referral code if the wallet has none — reading the
   * code is joining their referral programme. Only ever true on an explicit user tap.
   */
  getReferrals(address: string, issueCode?: boolean): Promise<RealFiReferrals>;
  getOrders(address: string): Promise<RealFiOrder[]>;
  getProtocol(): Promise<RealFiProtocol | null>;
  /** What backs USDrf. Protocol-wide; no address leaves the wallet for it. */
  getReserves(): Promise<RealFiReservesReport | null>;
}

/**
 * Discriminated on a STRING, not a boolean.
 *
 * This project compiles with `strictNullChecks: false`, under which TypeScript does
 * not narrow a `{ ok: true } | { ok: false }` union reliably — the accessor on the
 * narrowed branch fails to resolve. A string tag narrows correctly regardless.
 */
export type RealFiClientResult =
  | { status: 'ok'; client: RealFiReadClient }
  | { status: 'unavailable'; reason: RealFiUnavailableReason };

/* ── Defensive reading ────────────────────────────────────────────────────────
 * Nexus's shapes are typed on its side, but a proxy error page or a partial body
 * must still never render as NaN or "[object Object]" where a balance belongs.
 * ────────────────────────────────────────────────────────────────────────────── */

type UnknownRecord = Record<string, unknown>;

/** Index-signature reads go through one helper (`noPropertyAccessFromIndexSignature`). */
function get(record: UnknownRecord | null, key: string): unknown {
  return record ? record[key] : undefined;
}

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function toSmallestUnit(value: unknown): SmallestUnit {
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value).toString();
  return '0';
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toNumber(value: unknown, fallback = 0): number {
  return toNumberOrNull(value) ?? fallback;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** A non-negative 64-bit number (slot, smallest-unit amount) kept as its digit string. */
function toDigits(value: unknown): string | null {
  const s = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  return typeof s === 'string' && /^\d+$/.test(s) ? s : null;
}

/**
 * Narrow an unrecognised status to `Validating` rather than dropping the order.
 *
 * If RealFi adds a status we do not know, the safe render is "still working": it keeps
 * the order visible and makes no claim about the funds. Dropping it would tell the user
 * their order vanished, which is the one thing that must never happen here.
 */
function toOrderStatus(value: unknown): RealFiOrderStatus {
  return ORDER_STATUS_VALUES.includes(value as RealFiOrderStatus)
    ? (value as RealFiOrderStatus)
    : 'Validating';
}

function toOrderAction(value: unknown): RealFiOrderAction {
  return ORDER_ACTION_VALUES.includes(value as RealFiOrderAction)
    ? (value as RealFiOrderAction)
    : 'Stake';
}

/* ── Mapping Nexus responses ─────────────────────────────────────────────────── */

export function toPosition(raw: unknown): RealFiPosition | null {
  const r = asRecord(raw);
  if (!r) return null;
  return {
    totalSUSDr: toSmallestUnit(get(r, 'totalSUSDr')),
    totalUSDrValue: toSmallestUnit(get(r, 'totalUSDrValue')),
    principal: toSmallestUnit(get(r, 'principal')),
    earned: toSmallestUnit(get(r, 'earned')),
    yieldPercent: toNumber(get(r, 'yieldPercent')),
  };
}

export function toPoints(raw: unknown): RealFiPoints {
  const r = asRecord(raw);
  if (!r) return EMPTY_POINTS;
  // Nulls are meaningful: they mean "no points record yet", which is NOT zero.
  return {
    pointsBalance: toNumberOrNull(get(r, 'pointsBalance')),
    potentialPoints: toNumberOrNull(get(r, 'potentialPoints')),
    multiplier: toNumberOrNull(get(r, 'multiplier')),
  };
}

export function toReferrals(raw: unknown): RealFiReferrals {
  const r = asRecord(raw);
  if (!r) return EMPTY_REFERRALS;
  return {
    code: toStringOrNull(get(r, 'code')),
    createdAt: toStringOrNull(get(r, 'createdAt')),
    invitedCount: toNumber(get(r, 'invitedCount')),
    rewardPoints: toNumber(get(r, 'rewardPoints')),
  };
}

export function toOrders(raw: unknown): RealFiOrder[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const o = asRecord(entry);
    const txHash = toStringOrNull(get(o, 'txHash'));
    // An order with no id cannot be keyed or acted on later; skip it rather than
    // render a row the user can do nothing with.
    if (!o || !txHash) return [];
    const order: RealFiOrder = {
      txHash,
      outputIndex: toNumber(get(o, 'outputIndex')),
      action: toOrderAction(get(o, 'action')),
      status: toOrderStatus(get(o, 'status')),
    };
    const claimTxHash = toStringOrNull(get(o, 'claimTxHash'));
    if (claimTxHash) order.claimTxHash = claimTxHash;
    // Slots are 64-bit and stay strings; anything that is not all digits is dropped
    // rather than guessed at, because a wrong unlockSlot builds an unclaimable claim.
    const unlockSlot = toDigits(get(o, 'unlockSlot'));
    if (unlockSlot) order.unlockSlot = unlockSlot;
    const resultTxHash = toStringOrNull(get(o, 'resultTxHash'));
    const resultOutputIndex = toNumberOrNull(get(o, 'resultOutputIndex'));
    if (resultTxHash && resultOutputIndex !== null) {
      order.resultTxHash = resultTxHash;
      order.resultOutputIndex = resultOutputIndex;
    }
    const slot = toDigits(get(o, 'slot'));
    if (slot) order.slot = slot;
    const amount = toDigits(get(o, 'amount'));
    if (amount) order.amount = amount;
    const resultAmount = toDigits(get(o, 'resultAmount'));
    if (resultAmount) order.resultAmount = resultAmount;
    return [order];
  });
}

/** Days with a date and a positive rate; anything else would draw a false point. */
function toApyHistory(raw: unknown): RealFiApyPoint[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const p = asRecord(entry);
    const date = toStringOrNull(get(p, 'date'));
    const apyPercent = toNumberOrNull(get(p, 'apyPercent'));
    return date && apyPercent !== null && apyPercent > 0 ? [{ date, apyPercent }] : [];
  });
}

/** All five rate inputs as digit strings, or null: a partial set gives a wrong rate. */
function toRateInputs(r: UnknownRecord): RealFiRateInputs | null {
  const vaultUsdr = toDigits(get(r, 'vaultUsdr'));
  const circulatingSusdr = toDigits(get(r, 'circulatingSusdr'));
  const pendingYield = toDigits(get(r, 'pendingYield'));
  const diffusionStart = toDigits(get(r, 'diffusionStartUnixMilli'));
  const diffusionEnd = toDigits(get(r, 'diffusionEndUnixMilli'));
  if (!vaultUsdr || !circulatingSusdr || !pendingYield || !diffusionStart || !diffusionEnd) {
    return null;
  }
  return { vaultUsdr, circulatingSusdr, pendingYield, diffusionStart, diffusionEnd };
}

export function toProtocol(raw: unknown): RealFiProtocol | null {
  const r = asRecord(raw);
  if (!r) return null;
  const apyPercent = toNumberOrNull(get(r, 'apyPercent'));
  return {
    stablecoinAssetId: toStringOrNull(get(r, 'stablecoinAssetId')),
    fees: {
      mintBps: toNumber(get(r, 'mintBps')),
      redeemBps: toNumber(get(r, 'redeemBps')),
    },
    limits: {
      mintMinUsd: toNumber(get(r, 'mintMinUsd')),
      redeemMinUsd: toNumber(get(r, 'redeemMinUsd')),
    },
    apyPercent,
    // A rate without its date is worse than no rate: drop both unless both are there.
    apyAsOf: apyPercent === null ? null : toStringOrNull(get(r, 'apyAsOf')),
    nextCooldownSlot: toDigits(get(r, 'nextCooldownSlot')),
    apyAvg90Percent: toNumberOrNull(get(r, 'apyAvg90Percent')),
    apyHistory: toApyHistory(get(r, 'apyHistory')),
    rateInputs: toRateInputs(r),
  };
}

/** A calendar date as RealFi publishes it; anything else would print as "Invalid Date". */
function toDate(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

/** A dollar figure that can be drawn and summed: finite and not negative. */
function toAmount(value: unknown): number | null {
  const n = toNumberOrNull(value);
  return n !== null && n >= 0 ? n : null;
}

function toHolding(raw: unknown): RealFiReserveHolding[] {
  const h = asRecord(raw);
  const symbol = toStringOrNull(get(h, 'symbol'));
  const usd = toAmount(get(h, 'usd'));
  if (!h || !symbol || usd === null) return [];
  return [
    {
      symbol,
      assetClass: toStringOrNull(get(h, 'assetClass')) ?? '',
      sleeve: toStringOrNull(get(h, 'sleeve')) ?? '',
      quantity: toAmount(get(h, 'quantity')),
      usd,
      valuedAsOf: toDate(get(h, 'valuedAsOf')),
    },
  ];
}

function toCustodian(raw: unknown): RealFiReserveCustodian[] {
  const c = asRecord(raw);
  const custodian = toStringOrNull(get(c, 'custodian'));
  const usd = toAmount(get(c, 'usd'));
  if (!c || !custodian || usd === null) return [];
  const holdings = get(c, 'holdings');
  return [
    {
      custodian,
      usd,
      share: toAmount(get(c, 'share')) ?? 0,
      valuedAsOf: toDate(get(c, 'valuedAsOf')),
      holdings: Array.isArray(holdings) ? holdings.flatMap(toHolding) : [],
    },
  ];
}

function toSleeve(raw: unknown): RealFiReserveSleeve[] {
  const s = asRecord(raw);
  const sleeve = toStringOrNull(get(s, 'sleeve'));
  const usd = toAmount(get(s, 'usd'));
  return s && sleeve && usd !== null ? [{ sleeve, usd, share: toAmount(get(s, 'share')) ?? 0 }] : [];
}

/** Each part stands alone: a missing date or total drops that part, never the report. */
export function toReserves(raw: unknown): RealFiReservesReport | null {
  const r = asRecord(raw);
  if (!r) return null;

  const res = asRecord(get(r, 'reserves'));
  const resAsOf = toDate(get(res, 'asOf'));
  const resTotal = toAmount(get(res, 'totalUsd'));
  const sleeves = get(res, 'sleeves');
  const custodians = get(res, 'custodians');
  const reserves: RealFiReserves | null =
    res && resAsOf && resTotal !== null && resTotal > 0
      ? {
          asOf: resAsOf,
          totalUsd: resTotal,
          sleeves: Array.isArray(sleeves) ? sleeves.flatMap(toSleeve) : [],
          custodians: Array.isArray(custodians) ? custodians.flatMap(toCustodian) : [],
        }
      : null;

  const sup = asRecord(get(r, 'supply'));
  const supAsOf = toDate(get(sup, 'asOf'));
  const usdr = toAmount(get(sup, 'usdr'));
  const supply =
    supAsOf && usdr !== null ? { asOf: supAsOf, usdr, susdr: toAmount(get(sup, 'susdr')) } : null;

  const n = asRecord(get(r, 'nav'));
  const navAsOf = toDate(get(n, 'asOf'));
  const navTotal = toAmount(get(n, 'totalUsd'));
  const perToken = toAmount(get(n, 'perToken'));
  const nav =
    navAsOf && navTotal !== null && perToken !== null && perToken > 0
      ? {
          asOf: navAsOf,
          totalUsd: navTotal,
          perToken,
          tokensOutstanding: toAmount(get(n, 'tokensOutstanding')),
          source: toStringOrNull(get(n, 'source')),
        }
      : null;

  const cov = asRecord(get(r, 'coverage'));
  const covAsOf = toDate(get(cov, 'asOf'));
  const ratio = toAmount(get(cov, 'ratio'));
  const coverage = covAsOf && ratio !== null && ratio > 0 ? { asOf: covAsOf, ratio } : null;

  const hist = asRecord(get(r, 'history'));
  const supplyHistory = get(hist, 'supply');
  const navHistory = get(hist, 'nav');
  return {
    publishedAt: toStringOrNull(get(r, 'publishedAt')),
    reserves,
    supply,
    nav,
    coverage,
    history: {
      supply: Array.isArray(supplyHistory)
        ? supplyHistory.flatMap((entry) => {
            const p = asRecord(entry);
            const date = toDate(get(p, 'date'));
            const value = toAmount(get(p, 'usdr'));
            return date && value !== null ? [{ date, usdr: value }] : [];
          })
        : [],
      nav: Array.isArray(navHistory)
        ? navHistory.flatMap((entry) => {
            const p = asRecord(entry);
            const date = toDate(get(p, 'date'));
            const total = toAmount(get(p, 'totalUsd'));
            const per = toAmount(get(p, 'perToken'));
            return date && total !== null && per !== null ? [{ date, totalUsd: total, perToken: per }] : [];
          })
        : [],
    },
  };
}

/* ── The Nexus-backed implementation ─────────────────────────────────────────── */

const nexusAxios = axios.create({
  baseURL: import.meta.env['VITE_NEXUS_URL'],
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});
// gero-backend relays Nexus and signs what it relays (build-time mode; off by default).
installSignedResponses(nexusAxios, 'gero-backend');

export function createNexusReadClient(http: AxiosInstance, network: string): RealFiReadClient {
  async function read(view: string, params: Record<string, unknown>): Promise<unknown> {
    const res = await http.get(`/api/realfi/${view}`, { params: { network, ...params } });
    return res.data;
  }

  return {
    async getPosition(address) {
      return toPosition(await read('position', { address }));
    },
    async getPoints(address) {
      return toPoints(await read('points', { address }));
    },
    async getReferrals(address, issueCode = false) {
      // Omitted entirely unless true, so no default can ever leak through as a mint.
      const params: Record<string, unknown> = { address };
      if (issueCode) params['issueCode'] = true;
      return toReferrals(await read('referrals', params));
    },
    async getOrders(address) {
      return toOrders(await read('orders', { address }));
    },
    async getProtocol() {
      return toProtocol(await read('protocol', {}));
    },
    async getReserves() {
      return toReserves(await read('reserves', {}));
    },
  };
}

/**
 * Resolve a read client for a wallet's network, or the reason there isn't one.
 *
 * Callers should surface `reason` rather than collapsing it to "something went wrong":
 * a user with funds staked needs to know whether RealFi is unreachable or simply not
 * offered on their network.
 */
export async function resolveRealFiReadClient(
  network: string,
  http: AxiosInstance = nexusAxios,
): Promise<RealFiClientResult> {
  const slug = toNexusNetwork(network);
  if (!slug) return { status: 'unavailable', reason: 'unsupported-network' };
  return { status: 'ok', client: createNexusReadClient(http, slug) };
}
