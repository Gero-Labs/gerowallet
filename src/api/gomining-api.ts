/**
 * GoMining API Client
 *
 * Calls gero-backend, which proxies to the GoMining Partner API
 * with HMAC SHA256 S2S authentication.
 *
 * Backend base path: /api/gomining
 * GoMining sandbox: https://api.sandbox.gmt.io
 * GoMining production: https://api.gomining.com
 */

import axios from 'axios';
import { parseHttpError } from '@/shared/utils/parser';

const axiosInstance = axios.create({
  baseURL: import.meta.env['VITE_BACKEND_URL'],
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  },
});

// ─── Response types ───────────────────────────────────────────────────────────

export interface GoMiningUser {
  userId: string;
  btcAddress: string;
  createdAt: string;
}

export interface GoMiningUserStats {
  userId: string;
  totalHashrate: number;     // TH/s
  activeMiners: number;
  totalMiners: number;
  dailyIncomeBtc: number;    // BTC per day
  totalEarnedBtc: number;    // All-time BTC earned
}

export interface GoMiningNft {
  id: string;
  name: string;
  imageUrl: string;
  hashrate: number;          // TH/s
  status: 'active' | 'inactive';
  dailyIncomeBtc: number;
  collectionId: string;
}

export interface GoMiningCollection {
  id: string;
  name: string;
  imageUrl: string;
  hashrate: number;          // TH/s per NFT
  price: number;
  currency: string;          // 'USDT', 'BTC', etc.
  available: number;
  efficiency: number;        // USD/TH
}

export interface GoMiningBalance {
  btc: number;               // Available balance in BTC
  pendingBtc: number;        // Pending (being confirmed)
}

export interface GoMiningIncomeRecord {
  date: string;              // ISO date
  amount: number;            // BTC
  currency: string;
  nftId?: string;
}

export interface GoMiningEarningsPoint {
  date: string;              // ISO date
  amount: number;            // BTC earned that day
}

export interface GoMiningCommission {
  commission: number;        // BTC fee
  net: number;               // BTC you'll receive
}

export interface GoMiningPaymentInit {
  paymentUrl: string;        // Redirect URL to complete payment
  orderId: string;
}

// ─── API methods ──────────────────────────────────────────────────────────────

export default {
  /**
   * Initialize / create a GoMining account linked to the user's BTC address.
   * This is idempotent — calling it again returns the existing user.
   */
  async initUser(btcAddress: string): Promise<GoMiningUser> {
    try {
      const { data, status } = await axiosInstance.post('/api/gomining/auth/init', { btcAddress });
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  },

  /**
   * Get stats for the current user (hashrate, miners, earnings).
   */
  async getUserStats(userId: string): Promise<GoMiningUserStats> {
    try {
      const { data, status } = await axiosInstance.get('/api/gomining/users/stats', { params: { userId } });
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  },

  /**
   * Get the user's owned NFT miners.
   */
  async getMyNfts(userId: string): Promise<GoMiningNft[]> {
    try {
      const { data, status } = await axiosInstance.get('/api/gomining/nft/my', { params: { userId } });
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  },

  /**
   * Get available NFT miner collections for purchase.
   */
  async getCollections(): Promise<GoMiningCollection[]> {
    try {
      const { data, status } = await axiosInstance.get('/api/gomining/nft/collections');
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  },

  /**
   * Get the user's GoMining wallet balances.
   */
  async getBalances(userId: string): Promise<GoMiningBalance> {
    try {
      const { data, status } = await axiosInstance.get('/api/gomining/wallet/balances', { params: { userId } });
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  },

  /**
   * Bind a BTC wallet address to receive mining payouts.
   * Called automatically during initUser if not already set.
   */
  async bindBtcWallet(userId: string, btcAddress: string): Promise<void> {
    try {
      const { data, status } = await axiosInstance.post('/api/gomining/wallet/bind-btc', { userId, btcAddress });
      if (status === 200) return;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  },

  /**
   * Estimate the commission for a withdrawal.
   */
  async getCommission(userId: string, amount: number, currency: string): Promise<GoMiningCommission> {
    try {
      const { data, status } = await axiosInstance.get('/api/gomining/wallet/commission', {
        params: { userId, amount, currency },
      });
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  },

  /**
   * Initiate a fast (order-based) withdrawal to the bound BTC address.
   */
  async withdrawFast(userId: string, amount: number): Promise<void> {
    try {
      const { data, status } = await axiosInstance.post('/api/gomining/wallet/withdraw/fast', {
        userId,
        amount,
        currency: 'BTC',
      });
      if (status === 200) return;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  },

  /**
   * Initiate a standard 24-hour withdrawal to the bound BTC address.
   */
  async withdraw24h(userId: string, amount: number): Promise<void> {
    try {
      const { data, status } = await axiosInstance.post('/api/gomining/wallet/withdraw/24h', {
        userId,
        amount,
        currency: 'BTC',
      });
      if (status === 200) return;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  },

  /**
   * Get the user's per-NFT mining income history.
   */
  async getIncomeHistory(userId: string): Promise<GoMiningIncomeRecord[]> {
    try {
      const { data, status } = await axiosInstance.get('/api/gomining/nft/income/history', { params: { userId } });
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  },

  /**
   * Get daily earnings aggregated by date for charting.
   */
  async getEarningsChart(
    userId: string,
    dateStart: string,
    dateEnd: string,
  ): Promise<GoMiningEarningsPoint[]> {
    try {
      const { data, status } = await axiosInstance.get('/api/gomining/income/chart', {
        params: { userId, dateStart, dateEnd },
      });
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  },

  /**
   * Initiate an NFT purchase payment.
   * Returns a payment URL to redirect the user to for checkout.
   */
  async initPayment(userId: string, collectionId: string, quantity: number): Promise<GoMiningPaymentInit> {
    try {
      const { data, status } = await axiosInstance.post('/api/gomining/nft/payment/init', {
        userId,
        collectionId,
        quantity,
      });
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  },
};