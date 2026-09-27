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
  type RealFiProtocol,
  type RealFiReferrals,
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

function toSlot(value: unknown): string | null {
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
    const unlockSlot = toSlot(get(o, 'unlockSlot'));
    if (unlockSlot) order.unlockSlot = unlockSlot;
    const resultTxHash = toStringOrNull(get(o, 'resultTxHash'));
    const resultOutputIndex = toNumberOrNull(get(o, 'resultOutputIndex'));
    if (resultTxHash && resultOutputIndex !== null) {
      order.resultTxHash = resultTxHash;
      order.resultOutputIndex = resultOutputIndex;
    }
    return [order];
  });
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
    nextCooldownSlot: toSlot(get(r, 'nextCooldownSlot')),
  };
}

/* ── The Nexus-backed implementation ─────────────────────────────────────────── */

const nexusAxios = axios.create({
  baseURL: import.meta.env['VITE_NEXUS_URL'],
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

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
