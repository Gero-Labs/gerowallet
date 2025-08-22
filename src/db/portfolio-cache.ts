import { 
  getPortfolioChart, 
  savePortfolioChart, 
  removePortfolioChart,
  clearPortfolioChartsByAddress,
  clearAllPortfolioCharts,
  cleanupExpiredPortfolioCharts,
  getPortfolioChartsStats,
  getPortfolioChartsStatus
} from '@/db/wallet-db';
import tapToolsApi from '@/api/tap-tools-api';
import { walletStore } from '@/stores/walletStore';

export interface PortfolioChartsEntry {
  id?: number;
  address: string;
  currency: 'ADA' | 'USD' | 'EUR';
  data: string; // JSON stringified data to save memory
  timestamp: number;
  expiresAt: number;
}

export interface PortfolioCacheOptions {
  cacheTimeMs?: number;
  enableCache?: boolean;
}

const DEFAULT_CACHE_TIME = 4 * 60 * 60 * 1000; // 4 hours

export class PortfolioCacheService {
  private cacheTimeMs: number;
  private enableCache: boolean;

  constructor(options: PortfolioCacheOptions = {}) {
    this.cacheTimeMs = options.cacheTimeMs || DEFAULT_CACHE_TIME;
    this.enableCache = options.enableCache !== false;
  }

  /**
   * Get cached portfolio data for address and currency
   */
  async getCachedData(address: string, currency: 'ADA' | 'USD' | 'EUR'): Promise<any[] | null> {
    if (!this.enableCache || !address) {
      return null;
    }

    try {
      const walletId = walletStore.loggedWallet?.id;
      if (!walletId) {
        console.warn('No wallet ID available for portfolio cache');
        return null;
      }
      const now = Date.now();
      const entry = await getPortfolioChart(walletId, address, currency);

      if (!entry) {
        return null;
      }

      // Check if cache is expired
      if (entry.expiresAt <= now) {
        await removePortfolioChart(walletId, address, currency);
        return null;
      }

      // Parse JSON string back to array
      try {
        // Check if data is already an array (old format)
        if (Array.isArray(entry.data)) {
          return entry.data;
        }

        // Try to parse as JSON string (new format)
        if (typeof entry.data === 'string') {
          return JSON.parse(entry.data);
        }

        // If it's neither array nor string, return null
        return null;
      } catch (parseError) {
        console.error('Error parsing cached data:', parseError);
        return null;
      }
    } catch (error) {
      console.error('Error getting cached portfolio data:', error);
      return null;
    }
  }

  /**
   * Save portfolio data to cache
   */
  async saveToCache(address: string, currency: 'ADA' | 'USD' | 'EUR', data: any[]): Promise<void> {
    if (!this.enableCache || !address || !data) {
      return;
    }

    try {
      const walletId = walletStore.loggedWallet?.id;
      if (!walletId) {
        console.warn('No wallet ID available for portfolio cache');
        return;
      }
      const now = Date.now();
      const expiresAt = now + this.cacheTimeMs;

      // Limit data size to prevent memory issues (keep only last 1000 points)
      const limitedData = data.length > 1000 ? data.slice(-1000) : data;

      const entry: PortfolioChartsEntry = {
        address,
        currency,
        data: JSON.stringify(limitedData), // Convert to JSON string to save memory
        timestamp: now,
        expiresAt,
      };

      // Remove existing entry if exists
      await removePortfolioChart(walletId, address, currency);

      // Add new entry
      await savePortfolioChart(walletId, entry);
    } catch (error) {
      console.error('Error saving portfolio data to cache:', error);
    }
  }

  /**
   * Remove cached data for specific address and currency
   */
  async removeCachedData(address: string, currency: 'ADA' | 'USD' | 'EUR'): Promise<void> {
    try {
      const walletId = walletStore.loggedWallet?.id;
      if (!walletId) {
        console.warn('No wallet ID available for portfolio cache');
        return;
      }
      await removePortfolioChart(walletId, address, currency);
    } catch (error) {
      console.error('Error removing cached portfolio data:', error);
    }
  }

  /**
   * Clear all cache for specific address
   */
  async clearAddressCache(address: string): Promise<void> {
    try {
      const walletId = walletStore.loggedWallet?.id;
      if (!walletId) {
        console.warn('No wallet ID available for portfolio cache');
        return;
      }
      await clearPortfolioChartsByAddress(walletId, address);
    } catch (error) {
      console.error('Error clearing address cache:', error);
    }
  }

  /**
   * Clear all portfolio cache
   */
  async clearAllCache(): Promise<void> {
    try {
      const walletId = walletStore.loggedWallet?.id;
      if (!walletId) {
        console.warn('No wallet ID available for portfolio cache');
        return;
      }
      await clearAllPortfolioCharts(walletId);
    } catch (error) {
      console.error('Error clearing all portfolio cache:', error);
    }
  }

  /**
   * Clean up expired cache entries
   */
  async cleanupExpiredCache(): Promise<number> {
    try {
      const walletId = walletStore.loggedWallet?.id;
      if (!walletId) {
        console.warn('No wallet ID available for portfolio cache');
        return 0;
      }
      return await cleanupExpiredPortfolioCharts(walletId);
    } catch (error) {
      console.error('Error cleaning up expired cache:', error);
      return 0;
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<{
    totalEntries: number;
    validEntries: number;
    expiredEntries: number;
    oldestEntry: number | null;
    newestEntry: number | null;
    cacheTimeMs: number;
    enableCache: boolean;
  }> {
    try {
      const walletId = walletStore.loggedWallet?.id;
      if (!walletId) {
        console.warn('No wallet ID available for portfolio cache');
        return {
          totalEntries: 0,
          validEntries: 0,
          expiredEntries: 0,
          oldestEntry: null,
          newestEntry: null,
          cacheTimeMs: this.cacheTimeMs,
          enableCache: this.enableCache,
        };
      }
      const stats = await getPortfolioChartsStats(walletId);
      
      return {
        totalEntries: stats.totalEntries,
        validEntries: stats.validEntries,
        expiredEntries: stats.expiredEntries,
        oldestEntry: stats.oldestEntry,
        newestEntry: stats.newestEntry,
        cacheTimeMs: this.cacheTimeMs,
        enableCache: this.enableCache,
      };
    } catch (error) {
      console.error('Error getting cache stats:', error);
      return {
        totalEntries: 0,
        validEntries: 0,
        expiredEntries: 0,
        oldestEntry: null,
        newestEntry: null,
        cacheTimeMs: this.cacheTimeMs,
        enableCache: this.enableCache,
      };
    }
  }

  /**
   * Load portfolio data with caching
   */
  async loadPortfolioData(address: string, currency: 'ADA' | 'USD' | 'EUR'): Promise<any[]> {
    if (!address) {
      console.warn('No address provided for portfolio data');
      return [];
    }

    // Check cache first
    const cachedData = await this.getCachedData(address, currency);
    if (cachedData) {
      return cachedData;
    }

    // Load from API
    try {
      const { data } = await tapToolsApi.getPortfolioTrendedValue(address, currency);

      // Limit data size to prevent memory issues
      const limitedData = data.length > 1000 ? data.slice(-1000) : data;

      // Simple conversion to array format
      const processedData = limitedData.map((item: any) => [item.time * 1000, item.value]);

      // Save to cache
      await this.saveToCache(address, currency, processedData);

      return processedData;
    } catch (error) {
      console.error(`Error loading ${currency} portfolio data:`, error);
      return [];
    }
  }

  /**
   * Load all portfolio data for address with smart caching
   */
  async loadAllPortfolioData(address: string): Promise<{
    adaData: any[];
    usdData: any[];
    eurData: any[];
  }> {
    if (!address) {
      console.warn('No address provided for loading all portfolio data');
      return { adaData: [], usdData: [], eurData: [] };
    }

    try {
      const walletId = walletStore.loggedWallet?.id;
      if (!walletId) {
        console.warn('No wallet ID available for portfolio cache');
        return { adaData: [], usdData: [], eurData: [] };
      }
      
      // Load cache data in parallel for better performance
      const [cachedAda, cachedUsd, cachedEur] = await Promise.all([
        getPortfolioChart(walletId, address, 'ADA'),
        getPortfolioChart(walletId, address, 'USD'),
        getPortfolioChart(walletId, address, 'EUR')
      ]);

      // Determine what needs to be loaded
      const now = Date.now();
      const currenciesToLoad: ('ADA' | 'USD' | 'EUR')[] = [];
      
      const isValidEntry = (entry: any) => entry && entry.expiresAt > now;
      
      if (!isValidEntry(cachedAda)) currenciesToLoad.push('ADA');
      if (!isValidEntry(cachedUsd)) currenciesToLoad.push('USD');
      if (!isValidEntry(cachedEur)) currenciesToLoad.push('EUR');

      // Parse cached data
      const parseData = (entry: any) => {
        if (!entry || !entry.data) return [];
        try {
          return Array.isArray(entry.data) ? entry.data : JSON.parse(entry.data);
        } catch (e) {
          console.error('Error parsing cached data:', e);
          return [];
        }
      };

      let adaData = parseData(cachedAda);
      let usdData = parseData(cachedUsd);
      let eurData = parseData(cachedEur);

      // Load missing data in parallel for better performance
      if (currenciesToLoad.length > 0) {
        try {
          const loadPromises = currenciesToLoad.map(async (currency) => {
            try {
              const { data } = await tapToolsApi.getPortfolioTrendedValue(address, currency);
              
              // Simple conversion to array format
              const processedData = data.map((item: any) => [item.time * 1000, item.value]);
              
              // Save to cache
              await this.saveToCache(address, currency, processedData);
              
              return { currency, data: processedData };
            } catch (error) {
              console.error(`Error loading ${currency} portfolio data:`, error);
              return { currency, data: [] };
            }
          });

          const results = await Promise.all(loadPromises);
          
          // Update data arrays with results
          results.forEach(result => {
            switch (result.currency) {
              case 'ADA':
                adaData = result.data;
                break;
              case 'USD':
                usdData = result.data;
                break;
              case 'EUR':
                eurData = result.data;
                break;
            }
          });
        } catch (error) {
          console.error('Error loading portfolio data in parallel:', error);
        }
      }

      return {
        adaData: Array.isArray(adaData) ? adaData : [],
        usdData: Array.isArray(usdData) ? usdData : [],
        eurData: Array.isArray(eurData) ? eurData : [],
      };
    } catch (error) {
      console.error('Error loading all portfolio data:', error);
      return { adaData: [], usdData: [], eurData: [] };
    }
  }

  /**
   * Refresh portfolio data (ignores cache)
   */
  async refreshPortfolioData(address: string): Promise<{
    adaData: any[];
    usdData: any[];
    eurData: any[];
  }> {
    await this.clearAddressCache(address);
    return await this.loadAllPortfolioData(address);
  }

  /**
   * Check cache status for address
   */
  async getCacheStatus(address: string): Promise<{
    ada: { hasData: boolean; dataPoints: number; expiresAt: number | null };
    usd: { hasData: boolean; dataPoints: number; expiresAt: number | null };
    eur: { hasData: boolean; dataPoints: number; expiresAt: number | null };
  }> {
    try {
      const walletId = walletStore.loggedWallet?.id;
      if (!walletId) {
        console.warn('No wallet ID available for portfolio cache');
        return {
          ada: { hasData: false, dataPoints: 0, expiresAt: null },
          usd: { hasData: false, dataPoints: 0, expiresAt: null },
          eur: { hasData: false, dataPoints: 0, expiresAt: null },
        };
      }
      return await getPortfolioChartsStatus(walletId, address);
    } catch (error) {
      console.error('Error getting cache status:', error);
      return {
        ada: { hasData: false, dataPoints: 0, expiresAt: null },
        usd: { hasData: false, dataPoints: 0, expiresAt: null },
        eur: { hasData: false, dataPoints: 0, expiresAt: null },
      };
    }
  }

  /**
   * Force load specific currency data (ignores cache)
   */
  async forceLoadCurrencyData(address: string, currency: 'ADA' | 'USD' | 'EUR'): Promise<any[]> {
    try {
      // Remove existing cache for this currency
      await this.removeCachedData(address, currency);

      // Load from API
      const { data } = await tapToolsApi.getPortfolioTrendedValue(address, currency);

      // Simple conversion to array format
      const processedData = data.map((item: any) => [item.time * 1000, item.value]);

      // Save to cache
      await this.saveToCache(address, currency, processedData);

      return processedData;
    } catch (error) {
      console.error(`Error force loading ${currency} portfolio data:`, error);
      return [];
    }
  }

  /**
   * Load missing data only (doesn't touch existing cache)
   */
  async loadMissingData(address: string): Promise<{
    adaData: any[];
    usdData: any[];
    eurData: any[];
  }> {
    const status = await this.getCacheStatus(address);
    const currenciesToLoad: ('ADA' | 'USD' | 'EUR')[] = [];

    if (!status.ada.hasData) currenciesToLoad.push('ADA');
    if (!status.usd.hasData) currenciesToLoad.push('USD');
    if (!status.eur.hasData) currenciesToLoad.push('EUR');

    // Load data in parallel for better performance
    const loadPromises = currenciesToLoad.map(currency => 
      this.forceLoadCurrencyData(address, currency)
    );
    
    // Get existing data from cache in parallel
    const existingDataPromises = [
      status.ada.hasData ? this.getCachedData(address, 'ADA') : Promise.resolve([]),
      status.usd.hasData ? this.getCachedData(address, 'USD') : Promise.resolve([]),
      status.eur.hasData ? this.getCachedData(address, 'EUR') : Promise.resolve([])
    ];

    // Wait for all operations to complete
    const [loadedResults, existingAda, existingUsd, existingEur] = await Promise.all([
      Promise.all(loadPromises),
      ...existingDataPromises
    ]);

    return {
      adaData: status.ada.hasData ? existingAda : loadedResults[currenciesToLoad.indexOf('ADA')] || [],
      usdData: status.usd.hasData ? existingUsd : loadedResults[currenciesToLoad.indexOf('USD')] || [],
      eurData: status.eur.hasData ? existingEur : loadedResults[currenciesToLoad.indexOf('EUR')] || [],
    };
  }
}

// Export singleton instance with default settings (4 hours cache)
export const portfolioCacheService = new PortfolioCacheService();

// Export utility functions for common use cases
export const createPortfolioCacheService = (cacheTimeHours: number = 4, enableCache: boolean = true) => {
  return new PortfolioCacheService({
    cacheTimeMs: cacheTimeHours * 60 * 60 * 1000,
    enableCache,
  });
};

// Predefined services for common use cases
export const portfolioCache1h = createPortfolioCacheService(1);
export const portfolioCache8h = createPortfolioCacheService(8);
export const portfolioCache24h = createPortfolioCacheService(24);
export const portfolioCacheNoCache = createPortfolioCacheService(0, false);
