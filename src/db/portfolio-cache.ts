import marketApi from '@/api/market-api';
import type { WalletSnapshot } from '@/api/market-api';
import { walletStore } from '@/stores/walletStore';
import { debugLog } from '@/utils/debug';

/**
 * Map UI timeframe to Market API resolution parameter
 */
function getResolutionForTimeframe(timeframe: string): string {
  switch (timeframe) {
    case '24h': return '1H';
    case '7d': return '6H';
    case '30d':
    case '90d': return '1D';
    case '1y':
    case 'all':
    default: return '1W';
  }
}

/**
 * Transform WalletSnapshot array to PortfolioDataPoint array for a specific currency
 */
function snapshotsToDataPoints(
  snapshots: WalletSnapshot[],
  currency: 'ADA' | 'USD' | 'EUR',
  usdToEurRate: number = 1
): PortfolioDataPoint[] {
  return snapshots
    .filter(s => s.timestamp > 0)
    .map(s => {
      const timestamp = s.timestamp * 1000; // API returns seconds, we store milliseconds
      let value: number;
      switch (currency) {
        case 'ADA': value = s.totalValueAda; break;
        case 'USD': value = s.totalValueUsd; break;
        case 'EUR': value = s.totalValueEur ?? s.totalValueUsd * usdToEurRate; break;
      }
      return [timestamp, value] as PortfolioDataPoint;
    })
    .sort((a, b) => a[0] - b[0]);
}

// TypeScript types for portfolio data points
export type PortfolioDataPoint = [timestamp: number, value: number];

export interface PortfolioCacheOptions {
  cacheTimeMs?: number;
  enableCache?: boolean;
}

interface PortfolioResult {
  adaData: PortfolioDataPoint[];
  usdData: PortfolioDataPoint[];
  eurData: PortfolioDataPoint[];
}

export class PortfolioCacheService {
  public usdToEurRate: number = 1;

  /**
   * Fetch portfolio data from Market API for a given timeframe and adaOnly mode
   */
  async loadForTimeframe(address: string, timeframe: string, adaOnly: boolean = false): Promise<PortfolioResult> {
    if (!address) {
      return { adaData: [], usdData: [] };
    }

    const stakeAddress = walletStore.loggedWallet?.stakeAddress;
    if (!stakeAddress) {
      console.warn('No stake address available for portfolio data');
      return { adaData: [], usdData: [] };
    }

    const resolution = getResolutionForTimeframe(timeframe);
    debugLog(`📊 loadForTimeframe: timeframe=${timeframe}, resolution=${resolution}, adaOnly=${adaOnly}`);

    try {
      const snapshots = await marketApi.getWalletHistory(stakeAddress, resolution, adaOnly);
      debugLog(`📊 loadForTimeframe: received ${snapshots.length} snapshots`);

      const adaData = snapshotsToDataPoints(snapshots, 'ADA', this.usdToEurRate);
      const usdData = snapshotsToDataPoints(snapshots, 'USD', this.usdToEurRate);
      const eurData = snapshotsToDataPoints(snapshots, 'EUR', this.usdToEurRate);

      return { adaData, usdData, eurData };
    } catch (error) {
      console.error('Error loading portfolio data:', error);
      return { adaData: [], usdData: [], eurData: [] };
    }
  }

  /**
   * Refresh portfolio data (same as loadForTimeframe, no cache to bust)
   */
  async refreshPortfolioData(address: string, adaOnly: boolean = false): Promise<PortfolioResult> {
    return this.loadForTimeframe(address, '7d', adaOnly);
  }
}
