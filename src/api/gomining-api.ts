/**
 * GoMining client.
 *
 * Talks only to gero-backend's `/api/gomining/v2` routes, never to GoMining. The
 * Partner API answers allowlisted IPs only and its user login (C2S) is TonConnect,
 * so gero-backend holds the partner key and secret, signs every S2S call and keeps
 * each user's GoMining JWT. The wallet proves it owns a Bitcoin address once
 * (BIP-322, see `goMiningLinkMessage`) and gets a short-lived Gero session token.
 * It never sends a GoMining user id, partner user id or payout address: the
 * backend derives them from the session.
 *
 * Amounts arrive as integer satoshis. Every reply is checked before use and a
 * malformed one throws, so a backend or proxy fault cannot surface as a payment
 * address, an amount or a balance.
 */

import axios, { isAxiosError, type AxiosRequestConfig } from 'axios';

const client = axios.create({
  baseURL: `${import.meta.env['VITE_BACKEND_URL'] ?? ''}/api/gomining/v2`,
  timeout: 20000,
  headers: { 'Content-Type': 'application/json' },
});

// ─── Types ────────────────────────────────────────────────────────────────────

export type GoMiningEnvironment = 'sandbox' | 'production';

export interface GoMiningConfig {
  environment: GoMiningEnvironment;
  /** The Bitcoin network the backend links and takes payments on ('Mainnet' | 'Testnet'). */
  bitcoinNetwork: string;
  /** Off until GoMining enables order confirmation for Gero. */
  ordersEnabled: boolean;
  /** Gero's GoMining referral link, for people who already use GoMining. Null hides it. */
  referralUrl: string | null;
}

export interface GoMiningChallenge {
  nonce: string;
  expiresAt: number;
}

export interface GoMiningSession {
  token: string;
  expiresAt: number;
}

export interface GoMiningAccount {
  minerCount: number;
  totalPowerTh: number;
  /** W/TH, averaged over the miners. */
  avgEnergyEfficiency: number;
  totalIncomeSats: number;
  /** The address GoMining pays withdrawals to: the wallet's own linked address. */
  payoutAddress: string | null;
}

export interface GoMiningBalances {
  availableSats: number;
  withdrawnSats: number;
  totalIncomeSats: number;
}

export interface GoMiningMiner {
  id: number;
  name: string;
  powerTh: number;
  energyEfficiency: number;
  imageUrl: string | null;
  createdAt: string;
  /** Net reward of the latest daily payout; null before the first one. */
  lastRewardSats: number | null;
}

export interface GoMiningDay {
  /** ISO timestamp of the daily payout. */
  date: string;
  /** Net reward, after electricity and service fees. */
  rewardSats: number;
  /** Gross reward, before fees. */
  poolRewardSats: number;
  serviceFeeSats: number;
  totalPowerTh: number;
}

export interface GoMiningCollection {
  id: number;
  powerTh: number;
  energyEfficiency: number;
  priceUsd: number;
  /** GoMining's projection, not a promise. */
  annualRoiPercent: number;
  discountPercent: number;
}

export type GoMiningWithdrawalSpeed = 'fast' | 'standard';

export interface GoMiningWithdrawalTerms {
  fastMinSats: number;
  /** GoMining's fast-withdrawal fee, as a percent of the amount; null when it is a fixed fee. */
  fastFeePercent: number | null;
  /** Fixed fast-withdrawal fee; null when it is a percentage. */
  fastFeeSats: number | null;
}

export type GoMiningOrderStatus =
  | 'awaiting_payment'
  | 'payment_detected'
  | 'completed'
  | 'expired'
  | 'under_review'
  | 'failed';

export interface GoMiningOrder {
  id: string;
  collectionId: number;
  powerTh: number;
  energyEfficiency: number;
  priceUsd: number;
  status: GoMiningOrderStatus;
  payment: {
    address: string;
    amountSats: number;
    network: string;
    expiresAt: number;
  };
  txid: string | null;
  createdAt: string;
}

export const OPEN_ORDER_STATUSES: readonly GoMiningOrderStatus[] = ['awaiting_payment', 'payment_detected', 'under_review'];

// ─── Errors ───────────────────────────────────────────────────────────────────

/** A backend refusal or failure, with the backend's stable error code. */
export class GoMiningApiError extends Error {
  constructor(public readonly code: string, public readonly status: number) {
    super(`GoMining request failed: ${code}`);
    this.name = 'GoMiningApiError';
  }
}

/** The session token was refused: the wallet has to sign in again. */
export class GoMiningSessionError extends GoMiningApiError {
  constructor() {
    super('session_expired', 401);
    this.name = 'GoMiningSessionError';
  }
}

function toApiError(error: unknown): GoMiningApiError {
  if (error instanceof GoMiningApiError) return error;
  if (isAxiosError(error)) {
    const status = error.response?.status ?? 0;
    if (status === 401) return new GoMiningSessionError();
    const code = (error.response?.data as { error?: unknown } | undefined)?.error;
    return new GoMiningApiError(typeof code === 'string' && /^[a-z_]{1,64}$/.test(code) ? code : status ? 'request_failed' : 'network_error', status);
  }
  return new GoMiningApiError('request_failed', 0);
}

const malformed = () => new GoMiningApiError('malformed_response', 200);

// ─── Reply checks ─────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;

function obj(value: unknown): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw malformed();
  return value as Json;
}

function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw malformed();
  return value;
}

function str(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) throw malformed();
  return value;
}

function optStr(value: unknown): string | null {
  return value === null || value === undefined || value === '' ? null : str(value);
}

function num(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw malformed();
  return value;
}

function sats(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw malformed();
  return value;
}

function optSats(value: unknown): number | null {
  return value === null || value === undefined ? null : sats(value);
}

function optNum(value: unknown): number | null {
  return value === null || value === undefined ? null : num(value);
}

function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw malformed();
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) throw malformed();
  return value as T;
}

const ORDER_STATUSES: readonly GoMiningOrderStatus[] = [
  'awaiting_payment', 'payment_detected', 'completed', 'expired', 'under_review', 'failed',
];

function readConfig(value: unknown): GoMiningConfig {
  const v = obj(value);
  return {
    environment: oneOf(v['environment'], ['sandbox', 'production'] as const),
    bitcoinNetwork: oneOf(v['bitcoinNetwork'], ['Mainnet', 'Testnet'] as const),
    ordersEnabled: bool(v['ordersEnabled']),
    referralUrl: httpsUrl(v['referralUrl']),
  };
}

/** Only an https link is opened or rendered. Anything else reads as absent. */
function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

function readOrder(value: unknown): GoMiningOrder {
  const v = obj(value);
  const payment = obj(v['payment']);
  const amountSats = sats(payment['amountSats']);
  if (amountSats === 0) throw malformed();
  return {
    id: str(v['id']),
    collectionId: num(v['collectionId']),
    powerTh: num(v['powerTh']),
    energyEfficiency: num(v['energyEfficiency']),
    priceUsd: num(v['priceUsd']),
    status: oneOf(v['status'], ORDER_STATUSES),
    payment: {
      address: str(payment['address']),
      amountSats,
      network: oneOf(payment['network'], ['Mainnet', 'Testnet'] as const),
      expiresAt: num(payment['expiresAt']),
    },
    txid: optStr(v['txid']),
    createdAt: str(v['createdAt']),
  };
}

// ─── Requests ─────────────────────────────────────────────────────────────────

async function request(config: AxiosRequestConfig, token?: string): Promise<unknown> {
  try {
    const { data } = await client.request({
      ...config,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    return data;
  } catch (error) {
    throw toApiError(error);
  }
}

export default {
  async getConfig(): Promise<GoMiningConfig> {
    return readConfig(await request({ method: 'GET', url: '/config' }));
  },

  async getCollections(): Promise<GoMiningCollection[]> {
    const v = obj(await request({ method: 'GET', url: '/collections' }));
    return list(v['collections']).map((item) => {
      const c = obj(item);
      return {
        id: num(c['id']),
        powerTh: num(c['powerTh']),
        energyEfficiency: num(c['energyEfficiency']),
        priceUsd: num(c['priceUsd']),
        annualRoiPercent: num(c['annualRoiPercent']),
        discountPercent: num(c['discountPercent']),
      };
    });
  },

  /** A single-use nonce, bound by the backend to this address and network. */
  async createChallenge(address: string, network: string): Promise<GoMiningChallenge> {
    const v = obj(await request({ method: 'POST', url: '/session/challenge', data: { address, network } }));
    return { nonce: str(v['nonce']), expiresAt: num(v['expiresAt']) };
  },

  /** Trades a BIP-322 signature over `goMiningLinkMessage(address, nonce)` for a session. */
  async createSession(input: { address: string; network: string; nonce: string; signature: string }): Promise<GoMiningSession> {
    const v = obj(await request({ method: 'POST', url: '/session', data: input }));
    return { token: str(v['token']), expiresAt: num(v['expiresAt']) };
  },

  async getAccount(token: string): Promise<GoMiningAccount> {
    const v = obj(await request({ method: 'GET', url: '/me' }, token));
    return {
      minerCount: num(v['minerCount']),
      totalPowerTh: num(v['totalPowerTh']),
      avgEnergyEfficiency: num(v['avgEnergyEfficiency']),
      totalIncomeSats: sats(v['totalIncomeSats']),
      payoutAddress: optStr(v['payoutAddress']),
    };
  },

  async getBalances(token: string): Promise<GoMiningBalances> {
    const v = obj(await request({ method: 'GET', url: '/balances' }, token));
    return {
      availableSats: sats(v['availableSats']),
      withdrawnSats: sats(v['withdrawnSats']),
      totalIncomeSats: sats(v['totalIncomeSats']),
    };
  },

  async getMiners(token: string): Promise<GoMiningMiner[]> {
    const v = obj(await request({ method: 'GET', url: '/miners' }, token));
    return list(v['miners']).map((item) => {
      const m = obj(item);
      return {
        id: num(m['id']),
        name: str(m['name']),
        powerTh: num(m['powerTh']),
        energyEfficiency: num(m['energyEfficiency']),
        imageUrl: httpsUrl(m['imageUrl']),
        createdAt: str(m['createdAt']),
        lastRewardSats: optSats(m['lastRewardSats']),
      };
    });
  },

  /** Daily payouts, oldest first. */
  async getDailyIncome(token: string, days: number): Promise<GoMiningDay[]> {
    const v = obj(await request({ method: 'GET', url: '/income/daily', params: { days } }, token));
    return list(v['days']).map((item) => {
      const d = obj(item);
      return {
        date: str(d['date']),
        rewardSats: sats(d['rewardSats']),
        poolRewardSats: sats(d['poolRewardSats']),
        serviceFeeSats: sats(d['serviceFeeSats']),
        totalPowerTh: num(d['totalPowerTh']),
      };
    });
  },

  async getWithdrawalTerms(token: string): Promise<GoMiningWithdrawalTerms> {
    const v = obj(await request({ method: 'GET', url: '/withdrawals/terms' }, token));
    return {
      fastMinSats: sats(v['fastMinSats']),
      fastFeePercent: optNum(v['fastFeePercent']),
      fastFeeSats: optSats(v['fastFeeSats']),
    };
  },

  /**
   * Withdraws mining income to the linked payout address. The backend picks the
   * destination; `requestId` makes a retried request a no-op.
   */
  async withdraw(token: string, input: { amountSats: number; speed: GoMiningWithdrawalSpeed; requestId: string }): Promise<void> {
    await request({ method: 'POST', url: '/withdrawals', data: input }, token);
  },

  /** Opens an order and its BTC payment quote. `requestId` makes a retried request return the same order. */
  async createOrder(token: string, input: { collectionId: number; requestId: string }): Promise<GoMiningOrder> {
    return readOrder(await request({ method: 'POST', url: '/orders', data: input }, token));
  },

  async getOrders(token: string): Promise<GoMiningOrder[]> {
    const v = obj(await request({ method: 'GET', url: '/orders' }, token));
    return list(v['orders']).map(readOrder);
  },

  async getOrder(token: string, orderId: string): Promise<GoMiningOrder> {
    return readOrder(await request({ method: 'GET', url: `/orders/${encodeURIComponent(orderId)}` }, token));
  },

  /** Tells the backend which transaction paid the order. It also watches the address itself. */
  async reportPayment(token: string, orderId: string, txid: string): Promise<GoMiningOrder> {
    return readOrder(await request({ method: 'POST', url: `/orders/${encodeURIComponent(orderId)}/payment`, data: { txid } }, token));
  },
};
