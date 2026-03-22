/**
 * Mempool.space API
 * https://mempool.space/api
 * Provides Bitcoin fee estimates, block data, transaction acceleration, mempool visualization
 */

import axios from 'axios';

const MAINNET_BASE = 'https://mempool.space/api';
const TESTNET_BASE = 'https://mempool.space/testnet/api';

export interface MempoolFeeEstimates {
  fastestFee: number;    // sat/vB - next block
  halfHourFee: number;   // sat/vB - ~30 min
  hourFee: number;       // sat/vB - ~60 min
  economyFee: number;    // sat/vB - economy
  minimumFee: number;    // sat/vB - minimum
}

export interface MempoolStats {
  funded_txo_count: number;
  funded_txo_sum: number;
  spent_txo_count: number;
  spent_txo_sum: number;
  tx_count: number;
}

export interface MempoolBlock {
  id: string;
  height: number;
  version: number;
  timestamp: number;
  tx_count: number;
  size: number;
  weight: number;
  merkle_root: string;
  previousblockhash: string;
  mediantime: number;
  nonce: number;
  bits: number;
  difficulty: number;
}

export interface MempoolTransaction {
  txid: string;
  version: number;
  locktime: number;
  vin: Array<{
    txid: string;
    vout: number;
    prevout: {
      scriptpubkey: string;
      scriptpubkey_asm: string;
      scriptpubkey_type: string;
      scriptpubkey_address: string;
      value: number;
    };
    sequence: number;
    is_coinbase: boolean;
  }>;
  vout: Array<{
    scriptpubkey: string;
    scriptpubkey_asm: string;
    scriptpubkey_type: string;
    scriptpubkey_address: string;
    value: number;
  }>;
  size: number;
  weight: number;
  fee: number;
  status: {
    confirmed: boolean;
    block_height: number;
    block_hash: string;
    block_time: number;
  };
}

export interface MempoolHistogram {
  [feeRate: string]: number;  // feeRate (sat/vB) -> vsize in that fee bucket
}

class MempoolApi {
  private baseUrl(isTestnet: boolean): string {
    return isTestnet ? TESTNET_BASE : MAINNET_BASE;
  }

  async getFeeEstimates(isTestnet = false): Promise<MempoolFeeEstimates> {
    const { data } = await axios.get(`${this.baseUrl(isTestnet)}/v1/fees/recommended`);
    return data as MempoolFeeEstimates;
  }

  async getMempoolStats(isTestnet = false): Promise<{ count: number; vsize: number; total_fee: number; fee_histogram: [number, number][] }> {
    const { data } = await axios.get(`${this.baseUrl(isTestnet)}/mempool`);
    return data;
  }

  async getRecentBlocks(isTestnet = false, startHeight?: number): Promise<MempoolBlock[]> {
    const url = startHeight
      ? `${this.baseUrl(isTestnet)}/v1/blocks/${startHeight}`
      : `${this.baseUrl(isTestnet)}/v1/blocks`;
    const { data } = await axios.get(url);
    return data as MempoolBlock[];
  }

  async getTransaction(txid: string, isTestnet = false): Promise<MempoolTransaction> {
    const { data } = await axios.get(`${this.baseUrl(isTestnet)}/tx/${txid}`);
    return data as MempoolTransaction;
  }

  async getAddressStats(address: string, isTestnet = false): Promise<MempoolStats> {
    const { data } = await axios.get(`${this.baseUrl(isTestnet)}/address/${address}`);
    return data;
  }

  /** Get the block explorer URL for a transaction */
  getTxUrl(txid: string, isTestnet = false): string {
    return isTestnet
      ? `https://mempool.space/testnet/tx/${txid}`
      : `https://mempool.space/tx/${txid}`;
  }

  /** Get the block explorer URL for an address */
  getAddressUrl(address: string, isTestnet = false): string {
    return isTestnet
      ? `https://mempool.space/testnet/address/${address}`
      : `https://mempool.space/address/${address}`;
  }

  /** Get the block explorer URL for a block */
  getBlockUrl(blockHashOrHeight: string | number, isTestnet = false): string {
    return isTestnet
      ? `https://mempool.space/testnet/block/${blockHashOrHeight}`
      : `https://mempool.space/block/${blockHashOrHeight}`;
  }

  /** Convert fee histogram to chart-friendly format */
  feeHistogramToChartData(histogram: [number, number][]): { x: number; y: number }[] {
    return histogram.map(([fee, vsize]) => ({ x: fee, y: vsize }));
  }
}

export const mempoolApi = new MempoolApi();
export default mempoolApi;