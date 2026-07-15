// Strike Finance v2 API — User Module (account, positions, history)

import { strikeClient } from './strike-v2.client';
import {
  normalizeClosedPosition,
  normalizeFill,
  normalizeFunding,
  normalizeOrderHistory,
  normalizePosition,
} from './strike-v2.normalize';
import type {
  AccountResponse,
  BalanceResponse,
  PortfolioSummaryResponse,
  PositionsResponse,
  PositionWire,
  ClosedPositionsResponse,
  OrderHistoryResult,
  FillHistoryResult,
  FundingHistoryResult,
  TransactionHistoryResult,
} from './strike-v2.types';

/**
 * Extract a list payload from a response body that is either a bare array or
 * an `{ [key]: [...] }` envelope. The live API and the (inconsistent) docs
 * disagree on envelopes the same way they disagree on field casing, so list
 * endpoints tolerate both.
 */
function listFrom<T>(data: unknown, key: string): T[] {
  if (Array.isArray(data)) return data as T[];
  const list = (data as Record<string, unknown> | null | undefined)?.[key];
  return Array.isArray(list) ? (list as T[]) : [];
}

/** Server-supplied count when present, else the (normalized) list length. */
function countFrom(data: unknown, fallback: number): number {
  const count = (data as Record<string, unknown> | null | undefined)?.['count'];
  return typeof count === 'number' ? count : fallback;
}

interface HistoryParams {
  symbol?: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
  vault_id?: string;
  /**
   * Cursor for fill / funding / transaction history — set to the last item's
   * `id` to fetch the next page (cursor-based pagination, guide §17).
   */
  fromId?: number;
  /**
   * Cursor for order history — set to the last order's `id` to fetch the next
   * page (guide §17.1).
   */
  fromOrderID?: number;
}

export const strikeUserApi = {
  // ---------------------------------------------------------------------------
  // Account
  // ---------------------------------------------------------------------------

  async getAccount(vaultId?: string): Promise<AccountResponse> {
    const { data } = await strikeClient.get('/v2/account', {
      params: { vault_id: vaultId },
    });
    return data;
  },

  async getBalances(vaultId?: string): Promise<BalanceResponse[]> {
    const { data } = await strikeClient.get('/v2/balances', {
      params: { vault_id: vaultId },
    });
    return data;
  },

  async getPortfolio(vaultId?: string): Promise<PortfolioSummaryResponse> {
    const { data } = await strikeClient.get('/v2/portfolio', {
      params: { vault_id: vaultId },
    });
    return data;
  },

  // ---------------------------------------------------------------------------
  // Positions
  // ---------------------------------------------------------------------------

  async getPositions(symbol?: string, vaultId?: string): Promise<PositionsResponse> {
    const { data } = await strikeClient.get('/v2/positions', {
      params: { symbol, vault_id: vaultId },
    });
    // Live wire is snake_case with NO side field (docs show PascalCase) —
    // normalize before anything downstream renders or builds close orders.
    const positions = listFrom<PositionWire>(data, 'positions').map(normalizePosition);
    return { positions, count: countFrom(data, positions.length) };
  },

  async getClosedPositions(params: {
    symbol?: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
    vault_id?: string;
  }): Promise<ClosedPositionsResponse> {
    const { data } = await strikeClient.get('/v2/closedPositions', { params });
    const positions = listFrom<Record<string, unknown>>(data, 'positions').map(normalizeClosedPosition);
    return { positions, count: countFrom(data, positions.length) };
  },

  // ---------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------

  async getOrderHistory(
    params: HistoryParams,
  ): Promise<{ orders: OrderHistoryResult[]; count: number }> {
    const { data } = await strikeClient.get('/v2/history/order', { params });
    const orders = listFrom<Record<string, unknown>>(data, 'orders').map(normalizeOrderHistory);
    return { orders, count: countFrom(data, orders.length) };
  },

  async getFillHistory(
    params: HistoryParams,
  ): Promise<{ fills: FillHistoryResult[]; count: number }> {
    const { data } = await strikeClient.get('/v2/history/fill', { params });
    const fills = listFrom<Record<string, unknown>>(data, 'fills').map(normalizeFill);
    return { fills, count: countFrom(data, fills.length) };
  },

  async getFundingHistory(
    params: HistoryParams,
  ): Promise<{ funding: FundingHistoryResult[]; count: number }> {
    const { data } = await strikeClient.get('/v2/history/funding', { params });
    const funding = listFrom<Record<string, unknown>>(data, 'funding').map(normalizeFunding);
    return { funding, count: countFrom(data, funding.length) };
  },

  async getTransactionHistory(
    params: HistoryParams,
  ): Promise<{ transactions: TransactionHistoryResult[]; count: number }> {
    const { data } = await strikeClient.get('/v2/history/transaction', { params });
    return data;
  },

  // Deposit
  async getDepositQuote(req: import('./strike-v2.types').DepositQuoteRequest): Promise<import('./strike-v2.types').DepositQuoteResponse> {
    const { data } = await strikeClient.post('/v2/deposit/quote', req);
    return data;
  },

  // Step 2 of the deposit flow: ask Strike to BUILD the unsigned deposit tx.
  // Strike constructs the real vault deposit (correct script/datum + builder fee)
  // and returns an unsigned CBOR for the wallet to sign + submit. The client must
  // NOT build its own transfer to the deposit address.
  async buildDepositTx(req: import('./strike-v2.types').BuildDepositTxRequest): Promise<import('./strike-v2.types').BuildDepositTxResponse> {
    const { data } = await strikeClient.post('/v2/deposit/build-tx', req);
    return data;
  },

  async confirmDeposit(requestId: string, txHash: string): Promise<{ request_id: string; status: string }> {
    const { data } = await strikeClient.post('/v2/deposit', { request_id: requestId, tx_hash: txHash });
    return data;
  },

  // Withdraw
  async getWithdrawQuote(req: import('./strike-v2.types').WithdrawQuoteRequest): Promise<import('./strike-v2.types').WithdrawQuoteResponse> {
    const { data } = await strikeClient.post('/v2/withdraw/quote', req);
    return data;
  },

  async executeWithdraw(withdrawId: string, walletSignature: string): Promise<{ request_id: string; status: string }> {
    const { data } = await strikeClient.post('/v2/withdraw', { withdraw_id: withdrawId, wallet_signature: walletSignature });
    return data;
  },

  // NOTE: Strike has NO transaction-status / poll endpoint. Deposit and
  // withdraw both finish at their confirm/submit step; the previous
  // `/v2/transaction/status` poll hit a route that doesn't exist (401 →
  // key-wipe). Don't re-add it — verify against strike-builder-reference.
};
