/**
 * Bitcoin API Client
 *
 * Calls Blockstream Esplora API directly (no backend proxy).
 * Mainnet: https://blockstream.info/api
 * Testnet: https://blockstream.info/testnet/api
 */

import { Api } from './api';
import axios, { AxiosInstance } from 'axios';
import { Provider } from '@/models/types';

export interface BitcoinUtxo {
  txid: string;
  vout: number;
  value: number;           // Satoshis
  status: {
    confirmed: boolean;
    block_height?: number;
    block_hash?: string;
    block_time?: number;
  };
}

export interface BitcoinBalance {
  confirmed: number;       // Confirmed balance in satoshis
  unconfirmed: number;     // Unconfirmed balance in satoshis
  total: number;           // Total balance
}

export interface BitcoinFeeEstimates {
  fastestFee: number;      // sat/vB (next block)
  halfHourFee: number;     // sat/vB (~3 blocks)
  hourFee: number;         // sat/vB (~6 blocks)
  economyFee: number;      // sat/vB (low priority)
  minimumFee: number;      // sat/vB (minimum relay fee)
}

export interface BitcoinTransaction {
  txid: string;
  version: number;
  locktime: number;
  vin: Array<{
    txid: string;
    vout: number;
    prevout?: {
      scriptpubkey: string;
      scriptpubkey_asm: string;
      scriptpubkey_type: string;
      scriptpubkey_address: string;
      value: number;
    };
    scriptsig: string;
    scriptsig_asm: string;
    witness?: string[];
    is_coinbase: boolean;
    sequence: number;
  }>;
  vout: Array<{
    scriptpubkey: string;
    scriptpubkey_asm: string;
    scriptpubkey_type: string;
    scriptpubkey_address?: string;
    value: number;
  }>;
  size: number;
  weight: number;
  fee: number;
  status: {
    confirmed: boolean;
    block_height?: number;
    block_hash?: string;
    block_time?: number;
  };
}

// Esplora-compatible providers in priority order.
// mempool.space is primary — higher rate limits, no auth required.
// blockstream.info is kept as fallback.
const ESPLORA_PROVIDERS = {
  MAINNET: [
    'https://mempool.space/api',
    'https://blockstream.info/api',
  ],
  // testnet3 is tried first because most faucets still fund it.
  // testnet4 is the newer chain — tried second.
  TESTNET: [
    'https://mempool.space/testnet/api',   // testnet3 (most faucets)
    'https://mempool.space/testnet4/api',  // testnet4 (newer)
  ],
};

export class BitcoinApi extends Api {
  constructor(wallet: any, provider: Provider) {
    super(wallet, provider);
  }

  /**
   * Retry a request against fallback Esplora providers when the primary
   * returns 429 (rate-limited) or 5xx (server error).
   */
  private async withFallback<T>(
    request: (api: AxiosInstance) => Promise<T>
  ): Promise<T> {
    const providers = this.network === 'MAINNET'
      ? ESPLORA_PROVIDERS.MAINNET
      : ESPLORA_PROVIDERS.TESTNET;

    let lastError: unknown;
    for (const baseURL of providers) {
      try {
        const api = axios.create({ baseURL, timeout: 30000, headers: { 'Content-Type': 'application/json' } });
        return await request(api);
      } catch (err: any) {
        const status = err?.response?.status;
        if (status === 429 || (status >= 500 && status < 600)) {
          console.warn(`⛓ Bitcoin API: ${baseURL} returned ${status}, trying next provider…`);
          lastError = err;
          continue;
        }
        throw err; // Non-retryable error — propagate immediately
      }
    }
    throw lastError;
  }
  /**
   * Get UTXOs for a Bitcoin address.
   *
   * For testnet, testnet3 and testnet4 are independent chains — a 200 []
   * from the primary provider just means no funds there, so we fall through
   * to the next provider before giving up.
   */
  async getUtxos(address: string): Promise<BitcoinUtxo[]> {
    const providers = this.network === 'MAINNET'
      ? ESPLORA_PROVIDERS.MAINNET
      : ESPLORA_PROVIDERS.TESTNET;

    for (const baseURL of providers) {
      try {
        const api = axios.create({ baseURL, timeout: 30000, headers: { 'Content-Type': 'application/json' } });
        const { data } = await api.get<BitcoinUtxo[]>(`/address/${address}/utxo`);
        if (data.length > 0) return data;
      } catch (err: any) {
        const status = err?.response?.status;
        // Only skip to next provider for rate-limit / server errors
        if (status === 429 || (status >= 500 && status < 600)) continue;
        throw err;
      }
    }

    return []; // Address has no UTXOs on any provider
  }

  /**
   * Get balance for a Bitcoin address
   *
   * @param address Bitcoin address
   * @returns Promise<BitcoinBalance> Balance information
   */
  async getBalance(address: string): Promise<BitcoinBalance> {
    // Blockstream doesn't have a direct balance endpoint
    // Calculate from UTXOs instead
    const utxos = await this.getUtxos(address);

    let confirmed = 0;
    let unconfirmed = 0;

    for (const utxo of utxos) {
      if (utxo.status.confirmed) {
        confirmed += utxo.value;
      } else {
        unconfirmed += utxo.value;
      }
    }

    return {
      confirmed,
      unconfirmed,
      total: confirmed + unconfirmed,
    };
  }

  /**
   * Get current fee estimates
   *
   * @returns Promise<BitcoinFeeEstimates> Fee estimates in sat/vB
   */
  async getFeeEstimates(): Promise<BitcoinFeeEstimates> {
    const response = await this.withFallback(api => api.get('/fee-estimates'));
    const estimates = response.data;

    // Blockstream returns: { "1": 5, "2": 4, "3": 3, ... } where key is block target
    // Map to our interface
    return {
      fastestFee: estimates['1'] || 5,      // Next block
      halfHourFee: estimates['3'] || 3,     // ~3 blocks (30 min)
      hourFee: estimates['6'] || 2,         // ~6 blocks (60 min)
      economyFee: estimates['24'] || 1,     // ~24 blocks (4 hours)
      minimumFee: 1,                        // Minimum relay fee
    };
  }

  /**
   * Get Bitcoin blockchain tip
   *
   * @returns Promise<{ height: number; hash: string; time: number }> Latest block info
   */
  override async getTip(): Promise<{ height: number; hash: string; time: number }> {
    return this.withFallback(async (api) => {
      const { data: height } = await api.get('/blocks/tip/height');
      const { data: hash }   = await api.get(`/block-height/${height}`);
      const { data: block }  = await api.get(`/block/${hash}`);
      return { height, hash, time: block.timestamp };
    });
  }

  /**
   * Get transaction details
   *
   * @param txid Transaction ID
   * @returns Promise<BitcoinTransaction> Transaction details
   */
  async getTransaction(txid: string): Promise<BitcoinTransaction> {
    const response = await this.withFallback(api => api.get(`/tx/${txid}`));
    return response.data;
  }

  /**
   * Get transaction history for an address.
   *
   * Same fall-through logic as getUtxos — testnet3 and testnet4 are
   * separate chains so an empty 200 response triggers trying the next provider.
   */
  async getTransactions(address: string, afterHeight?: number): Promise<BitcoinTransaction[]> {
    const providers = this.network === 'MAINNET'
      ? ESPLORA_PROVIDERS.MAINNET
      : ESPLORA_PROVIDERS.TESTNET;

    let transactions: BitcoinTransaction[] = [];

    for (const baseURL of providers) {
      try {
        const api = axios.create({ baseURL, timeout: 30000, headers: { 'Content-Type': 'application/json' } });
        const { data } = await api.get<BitcoinTransaction[]>(`/address/${address}/txs`);
        if (data.length > 0) {
          transactions = data;
          break;
        }
      } catch (err: any) {
        const status = err?.response?.status;
        if (status === 429 || (status >= 500 && status < 600)) continue;
        throw err;
      }
    }

    if (afterHeight !== undefined) {
      transactions = transactions.filter(tx =>
        tx.status.confirmed && tx.status.block_height! > afterHeight
      );
    }

    return transactions;
  }

  /**
   * Broadcast a Bitcoin transaction.
   *
   * For testnet, UTXOs fetched from testnet3 must be broadcast to testnet3.
   * We try each provider in order and return on the first success.
   */
  async broadcastTransaction(txHex: string): Promise<string> {
    const providers = this.network === 'MAINNET'
      ? ESPLORA_PROVIDERS.MAINNET
      : ESPLORA_PROVIDERS.TESTNET;

    let lastError: unknown;
    for (const baseURL of providers) {
      try {
        const api = axios.create({ baseURL, timeout: 30000 });
        const { data } = await api.post<string>('/tx', txHex, { headers: { 'Content-Type': 'text/plain' } });
        return data;
      } catch (err) {
        lastError = err;
        // Try next provider — the inputs may belong to a different testnet
      }
    }
    throw lastError;
  }

  /**
   * Get recommended fee for transaction size
   *
   * @param vsize Transaction virtual size in vbytes
   * @param priority 'fast' | 'medium' | 'slow'
   * @returns Promise<number> Recommended fee in satoshis
   */
  async getRecommendedFee(vsize: number, priority: 'fast' | 'medium' | 'slow' = 'medium'): Promise<number> {
    const estimates = await this.getFeeEstimates();
    let feeRate: number;

    switch (priority) {
      case 'fast':
        feeRate = estimates.fastestFee;
        break;
      case 'medium':
        feeRate = estimates.halfHourFee;
        break;
      case 'slow':
        feeRate = estimates.economyFee;
        break;
      default:
        feeRate = estimates.halfHourFee;
    }

    return Math.ceil(vsize * feeRate);
  }
}
