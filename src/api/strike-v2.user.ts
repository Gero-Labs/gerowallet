// Strike Finance v2 API — User Module (account, positions, history)

import { strikeClient } from './strike-v2.client';
import type {
  AccountResponse,
  BalanceResponse,
  PortfolioSummaryResponse,
  PositionsResponse,
  ClosedPositionsResponse,
  OrderHistoryResult,
  FillHistoryResult,
  FundingHistoryResult,
  TransactionHistoryResult,
} from './strike-v2.types';

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
    return data;
  },

  async getClosedPositions(params: {
    symbol?: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
    vault_id?: string;
  }): Promise<ClosedPositionsResponse> {
    const { data } = await strikeClient.get('/v2/closedPositions', { params });
    return data;
  },

  // ---------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------

  async getOrderHistory(
    params: HistoryParams,
  ): Promise<{ orders: OrderHistoryResult[]; count: number }> {
    const { data } = await strikeClient.get('/v2/history/order', { params });
    return data;
  },

  async getFillHistory(
    params: HistoryParams,
  ): Promise<{ fills: FillHistoryResult[]; count: number }> {
    const { data } = await strikeClient.get('/v2/history/fill', { params });
    return data;
  },

  async getFundingHistory(
    params: HistoryParams,
  ): Promise<{ funding: FundingHistoryResult[]; count: number }> {
    const { data } = await strikeClient.get('/v2/history/funding', { params });
    return data;
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

  // Cardano withdraw batcher step (per STRIKE_V2_INTEGRATOR_GUIDE §16).
  // Before POST /v2/withdraw on Cardano, the caller must build and submit a
  // ~2 ADA batcher-fee transaction to the current validator leader address.

  /** Look up the current validator leader address for a chain (default cardano). */
  async getValidatorLeader(chain = 'cardano'): Promise<{ address: string }> {
    const { data } = await strikeClient.get('/v2/validator/leader', { params: { chain } });
    return data;
  },

  /**
   * Request the unsigned batcher-fee transaction CBOR for a Cardano withdrawal.
   * Returns `txData` (hex CBOR) which the caller must sign with the wallet and
   * submit on-chain BEFORE calling executeWithdraw().
   *
   * NOTE: this endpoint lives under /api/perpetuals (NOT /v2) per the
   * integrator guide, so we pass an absolute-from-root path. The auth
   * interceptor signs the pathname + query as usual.
   */
  async getWithdrawBatcherTx(
    req: { withdraw_id: string; address: string; chain?: string },
  ): Promise<{ txData: string }> {
    const { data } = await strikeClient.post('/api/perpetuals/withdraw-batcher', {
      withdraw_id: req.withdraw_id,
      address: req.address,
      chain: req.chain ?? 'cardano',
    });
    return data;
  },

  // Transaction status
  async getTransactionStatus(requestId: string, type: 'deposit' | 'withdraw'): Promise<import('./strike-v2.types').TransactionStatusResponse> {
    const { data } = await strikeClient.get('/v2/transaction/status', { params: { request_id: requestId, type } });
    return data;
  },
};
