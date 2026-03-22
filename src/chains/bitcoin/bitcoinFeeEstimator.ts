/**
 * Bitcoin Fee Estimator
 *
 * Provides fee estimation for Bitcoin transactions with:
 * - Real-time fee rate fetching from blockchain API
 * - Cached fee rates to reduce API calls
 * - 3-tier fee selector (Fast/Medium/Slow)
 * - Total fee calculation for transactions
 * - Fee rate recommendations based on network conditions
 */

import type { BitcoinApi, BitcoinFeeEstimates } from '@/api/bitcoin-api';
import type { IUnifiedUtxo, IOutput } from '@/chains/common/interfaces';
import { calculateTxFee, calculateTxSize } from './bitcoinCoinSelection';

/**
 * Fee priority levels
 */
export enum FeePriority {
  FAST = 'fast',       // Next block (~10 min)
  MEDIUM = 'medium',   // ~30 minutes (3 blocks)
  SLOW = 'slow',       // ~60 minutes (6 blocks)
  CUSTOM = 'custom'    // User-defined fee rate
}

/**
 * Fee estimate with metadata
 */
export interface FeeEstimate {
  priority: FeePriority;
  feeRate: number;           // Satoshis per vbyte
  estimatedBlocks: number;   // Estimated blocks until confirmation
  estimatedMinutes: number;  // Estimated minutes until confirmation
  description: string;       // User-friendly description
}

/**
 * Transaction fee breakdown
 */
export interface TransactionFeeBreakdown {
  feeRate: number;           // Satoshis per vbyte
  transactionSize: number;   // Virtual bytes
  totalFee: bigint;          // Total fee in satoshis
  totalFeeBtc: string;       // Total fee in BTC (formatted)
  feePercentage: number;     // Fee as percentage of transaction amount
}

/**
 * Fee estimator cache
 */
interface FeeCache {
  estimates: BitcoinFeeEstimates | null;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
}

/**
 * Bitcoin Fee Estimator Service
 */
export class BitcoinFeeEstimator {
  private cache: FeeCache = {
    estimates: null,
    timestamp: 0,
    ttl: 60000, // 60 seconds default
  };

  private api: BitcoinApi | null = null;

  /**
   * Set Bitcoin API client
   */
  setApi(api: BitcoinApi): void {
    this.api = api;
  }

  /**
   * Set cache TTL
   */
  setCacheTtl(ttlMs: number): void {
    this.cache.ttl = ttlMs;
  }

  /**
   * Fetch fresh fee estimates from API
   */
  async fetchFeeEstimates(force: boolean = false): Promise<BitcoinFeeEstimates> {
    if (!this.api) {
      throw new Error('Bitcoin API not initialized. Call setApi() first.');
    }

    // Check cache
    const now = Date.now();
    if (!force && this.cache.estimates && (now - this.cache.timestamp) < this.cache.ttl) {
      return this.cache.estimates;
    }

    // Fetch fresh estimates
    try {
      const estimates = await this.api.getFeeEstimates();

      // Update cache
      this.cache.estimates = estimates;
      this.cache.timestamp = now;

      return estimates;
    } catch (error) {
      console.error('Failed to fetch fee estimates:', error);

      // Return cached estimates if available
      if (this.cache.estimates) {
        console.warn('Using cached fee estimates due to API error');
        return this.cache.estimates;
      }

      // Fallback to default estimates if no cache
      console.warn('Using fallback default fee estimates');
      return this.getDefaultFeeEstimates();
    }
  }

  /**
   * Get default fee estimates (fallback when API is unavailable)
   */
  private getDefaultFeeEstimates(): BitcoinFeeEstimates {
    return {
      fastestFee: 20,      // 20 sat/vB (next block)
      halfHourFee: 10,     // 10 sat/vB (~3 blocks)
      hourFee: 5,          // 5 sat/vB (~6 blocks)
      economyFee: 3,       // 3 sat/vB (low priority)
      minimumFee: 1,       // 1 sat/vB (minimum relay fee)
    };
  }

  /**
   * Get fee estimate for specific priority
   */
  async getFeeEstimate(priority: FeePriority): Promise<FeeEstimate> {
    const estimates = await this.fetchFeeEstimates();

    switch (priority) {
      case FeePriority.FAST:
        return {
          priority: FeePriority.FAST,
          feeRate: estimates.fastestFee,
          estimatedBlocks: 1,
          estimatedMinutes: 10,
          description: 'Fast (~10 min)',
        };

      case FeePriority.MEDIUM:
        return {
          priority: FeePriority.MEDIUM,
          feeRate: estimates.halfHourFee,
          estimatedBlocks: 3,
          estimatedMinutes: 30,
          description: 'Medium (~30 min)',
        };

      case FeePriority.SLOW:
        return {
          priority: FeePriority.SLOW,
          feeRate: estimates.economyFee,
          estimatedBlocks: 6,
          estimatedMinutes: 60,
          description: 'Slow (~1 hour)',
        };

      case FeePriority.CUSTOM:
      default:
        return {
          priority: FeePriority.CUSTOM,
          feeRate: estimates.halfHourFee,
          estimatedBlocks: 3,
          estimatedMinutes: 30,
          description: 'Custom',
        };
    }
  }

  /**
   * Get all fee estimates (Fast/Medium/Slow)
   */
  async getAllFeeEstimates(): Promise<FeeEstimate[]> {
    const estimates = await this.fetchFeeEstimates();

    return [
      {
        priority: FeePriority.FAST,
        feeRate: estimates.fastestFee,
        estimatedBlocks: 1,
        estimatedMinutes: 10,
        description: 'Fast (~10 min)',
      },
      {
        priority: FeePriority.MEDIUM,
        feeRate: estimates.halfHourFee,
        estimatedBlocks: 3,
        estimatedMinutes: 30,
        description: 'Medium (~30 min)',
      },
      {
        priority: FeePriority.SLOW,
        feeRate: estimates.economyFee,
        estimatedBlocks: 6,
        estimatedMinutes: 60,
        description: 'Slow (~1 hour)',
      },
    ];
  }

  /**
   * Calculate transaction fee breakdown
   */
  calculateTransactionFee(
    inputCount: number,
    outputCount: number,
    feeRate: number,
    transactionAmount?: bigint
  ): TransactionFeeBreakdown {
    const txSize = calculateTxSize(inputCount, outputCount);
    const totalFee = calculateTxFee(inputCount, outputCount, feeRate);

    // Format fee in BTC
    const totalFeeBtc = (Number(totalFee) / 100000000).toFixed(8);

    // Calculate fee percentage if transaction amount provided
    let feePercentage = 0;
    if (transactionAmount && transactionAmount > BigInt(0)) {
      feePercentage = (Number(totalFee) / Number(transactionAmount)) * 100;
    }

    return {
      feeRate,
      transactionSize: txSize,
      totalFee,
      totalFeeBtc,
      feePercentage,
    };
  }

  /**
   * Estimate fee for a specific transaction
   * Uses coin selection to determine actual input/output count
   */
  async estimateTransactionFee(
    utxos: IUnifiedUtxo[],
    outputs: IOutput[],
    priority: FeePriority = FeePriority.MEDIUM
  ): Promise<TransactionFeeBreakdown> {
    const estimate = await this.getFeeEstimate(priority);

    // Get confirmed UTXOs only
    const confirmedUtxos = utxos.filter(utxo => utxo.confirmed);

    // Estimate input/output count
    // Use a heuristic: assume we'll need about half the available UTXOs on average
    const estimatedInputCount = Math.min(
      Math.ceil(confirmedUtxos.length / 2),
      confirmedUtxos.length
    );

    // Output count = recipient outputs + possible change output
    const estimatedOutputCount = outputs.length + 1;

    // Calculate transaction amount
    const transactionAmount = outputs.reduce((sum, output) => sum + output.value, BigInt(0));

    return this.calculateTransactionFee(
      estimatedInputCount,
      estimatedOutputCount,
      estimate.feeRate,
      transactionAmount
    );
  }

  /**
   * Get recommended fee rate based on transaction urgency
   */
  async getRecommendedFeeRate(urgency: 'high' | 'medium' | 'low' = 'medium'): Promise<number> {
    const estimates = await this.fetchFeeEstimates();

    switch (urgency) {
      case 'high':
        return estimates.fastestFee;
      case 'low':
        return estimates.economyFee;
      case 'medium':
      default:
        return estimates.halfHourFee;
    }
  }

  /**
   * Validate fee rate (not too low, not unreasonably high)
   */
  validateFeeRate(feeRate: number): { valid: boolean; message?: string } {
    const MIN_FEE_RATE = 1;     // Minimum relay fee
    const MAX_FEE_RATE = 1000;  // Unreasonably high (1000 sat/vB)

    if (feeRate < MIN_FEE_RATE) {
      return {
        valid: false,
        message: `Fee rate too low. Minimum is ${MIN_FEE_RATE} sat/vB`,
      };
    }

    if (feeRate > MAX_FEE_RATE) {
      return {
        valid: false,
        message: `Fee rate too high. Maximum is ${MAX_FEE_RATE} sat/vB`,
      };
    }

    return { valid: true };
  }

  /**
   * Clear fee cache
   */
  clearCache(): void {
    this.cache.estimates = null;
    this.cache.timestamp = 0;
  }
}

// Singleton instance
let feeEstimatorInstance: BitcoinFeeEstimator | null = null;

/**
 * Get singleton fee estimator instance
 */
export function getBitcoinFeeEstimator(): BitcoinFeeEstimator {
  if (!feeEstimatorInstance) {
    feeEstimatorInstance = new BitcoinFeeEstimator();
  }
  return feeEstimatorInstance;
}

/**
 * Initialize fee estimator with API
 */
export function initializeFeeEstimator(api: BitcoinApi): BitcoinFeeEstimator {
  const estimator = getBitcoinFeeEstimator();
  estimator.setApi(api);
  return estimator;
}

/**
 * Format satoshis to BTC string
 */
export function formatSatsToBtc(satoshis: bigint | number): string {
  const value = typeof satoshis === 'bigint' ? Number(satoshis) : satoshis;
  return (value / 100000000).toFixed(8);
}

/**
 * Format fee rate in user-friendly way
 */
export function formatFeeRate(feeRate: number): string {
  return `${feeRate} sat/vB`;
}

/**
 * Calculate fee percentage of transaction amount
 */
export function calculateFeePercentage(fee: bigint, amount: bigint): number {
  if (amount === BigInt(0)) return 0;
  return (Number(fee) / Number(amount)) * 100;
}

/**
 * Estimate confirmation time based on fee rate
 * Simple heuristic based on current network conditions
 */
export function estimateConfirmationTime(
  feeRate: number,
  currentFeeEstimates: BitcoinFeeEstimates
): { blocks: number; minutes: number } {
  if (feeRate >= currentFeeEstimates.fastestFee) {
    return { blocks: 1, minutes: 10 };
  } else if (feeRate >= currentFeeEstimates.halfHourFee) {
    return { blocks: 3, minutes: 30 };
  } else if (feeRate >= currentFeeEstimates.hourFee) {
    return { blocks: 6, minutes: 60 };
  } else {
    // Low priority - estimate based on ratio
    const blocks = Math.ceil(6 * (currentFeeEstimates.hourFee / feeRate));
    return { blocks, minutes: blocks * 10 };
  }
}
