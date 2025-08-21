import { getDb } from '@/db/gero-db';
import tapToolsApi from '@/api/tap-tools-api';

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
      const db = await getDb();
      const now = Date.now();
      const entry = await db
        .table('portfolio_charts')
        .where(['address', 'currency'])
        .equals([address, currency])
        .first();

      if (!entry) {
        return null;
      }

      // Check if cache is expired
      if (entry.expiresAt <= now) {
        await this.removeCachedData(address, currency);
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
      const db = await getDb();
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
      await this.removeCachedData(address, currency);

      // Add new entry
      await db.table('portfolio_charts').add(entry);
    } catch (error) {
      console.error('Error saving portfolio data to cache:', error);
    }
  }

  /**
   * Remove cached data for specific address and currency
   */
  async removeCachedData(address: string, currency: 'ADA' | 'USD' | 'EUR'): Promise<void> {
    try {
      const db = await getDb();
      await db.table('portfolio_charts').where(['address', 'currency']).equals([address, currency]).delete();
    } catch (error) {
      console.error('Error removing cached portfolio data:', error);
    }
  }

  /**
   * Clear all cache for specific address
   */
  async clearAddressCache(address: string): Promise<void> {
    try {
      const db = await getDb();
      await db.table('portfolio_charts').where('address').equals(address).delete();
    } catch (error) {
      console.error('Error clearing address cache:', error);
    }
  }

  /**
   * Clear all portfolio cache
   */
  async clearAllCache(): Promise<void> {
    try {
      const db = await getDb();
      await db.table('portfolio_charts').clear();
    } catch (error) {
      console.error('Error clearing all portfolio cache:', error);
    }
  }

  /**
   * Clean up expired cache entries
   */
  async cleanupExpiredCache(): Promise<number> {
    try {
      const db = await getDb();
      const now = Date.now();
      const expiredEntries = await db.table('portfolio_charts').where('expiresAt').belowOrEqual(now).toArray();

      if (expiredEntries.length > 0) {
        await db.table('portfolio_charts').where('expiresAt').belowOrEqual(now).delete();

        return expiredEntries.length;
      }

      return 0;
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
      const db = await getDb();
      const allEntries = await db.table('portfolio_charts').toArray();
      const now = Date.now();

      const validEntries = allEntries.filter(entry => entry.expiresAt > now);
      const expiredEntries = allEntries.filter(entry => entry.expiresAt <= now);

      return {
        totalEntries: allEntries.length,
        validEntries: validEntries.length,
        expiredEntries: expiredEntries.length,
        oldestEntry: allEntries.length > 0 ? Math.min(...allEntries.map(e => e.timestamp)) : null,
        newestEntry: allEntries.length > 0 ? Math.max(...allEntries.map(e => e.timestamp)) : null,
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
      // Load cache data sequentially to reduce memory usage
      const cachedAda = await this.getCachedData(address, 'ADA');
      const cachedUsd = await this.getCachedData(address, 'USD');
      const cachedEur = await this.getCachedData(address, 'EUR');

      // Determine what needs to be loaded
      const currenciesToLoad: ('ADA' | 'USD' | 'EUR')[] = [];
      if (!cachedAda || !Array.isArray(cachedAda)) currenciesToLoad.push('ADA');
      if (!cachedUsd || !Array.isArray(cachedUsd)) currenciesToLoad.push('USD');
      if (!cachedEur || !Array.isArray(cachedEur)) currenciesToLoad.push('EUR');

      let adaData = cachedAda && Array.isArray(cachedAda) ? cachedAda : [];
      let usdData = cachedUsd && Array.isArray(cachedUsd) ? cachedUsd : [];
      let eurData = cachedEur && Array.isArray(cachedEur) ? cachedEur : [];

      // Load missing data sequentially
      for (const currency of currenciesToLoad) {
        try {
          const { data } = await tapToolsApi.getPortfolioTrendedValue(address, currency);

          // Simple conversion to array format
          const processedData = data.map((item: any) => [item.time * 1000, item.value]);

          // Save to cache
          await this.saveToCache(address, currency, processedData);

          // Update data arrays
          switch (currency) {
            case 'ADA':
              adaData = processedData;
              break;
            case 'USD':
              usdData = processedData;
              break;
            case 'EUR':
              eurData = processedData;
              break;
          }
        } catch (error) {
          console.error(`Error loading ${currency} portfolio data:`, error);
          // Keep existing data or empty array
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
      const db = await getDb();
      const now = Date.now();

      // Load sequentially to reduce memory usage
      const adaEntry = await db
        .table('portfolio_charts')
        .where(['address', 'currency'])
        .equals([address, 'ADA'])
        .first();

      const usdEntry = await db
        .table('portfolio_charts')
        .where(['address', 'currency'])
        .equals([address, 'USD'])
        .first();

      const eurEntry = await db
        .table('portfolio_charts')
        .where(['address', 'currency'])
        .equals([address, 'EUR'])
        .first();

      return {
        ada: {
          hasData: !!(adaEntry && adaEntry.expiresAt > now),
          dataPoints: adaEntry?.data?.length || 0,
          expiresAt: adaEntry?.expiresAt || null,
        },
        usd: {
          hasData: !!(usdEntry && usdEntry.expiresAt > now),
          dataPoints: usdEntry?.data?.length || 0,
          expiresAt: usdEntry?.expiresAt || null,
        },
        eur: {
          hasData: !!(eurEntry && eurEntry.expiresAt > now),
          dataPoints: eurEntry?.data?.length || 0,
          expiresAt: eurEntry?.expiresAt || null,
        },
      };
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

    // Load data sequentially to reduce memory pressure
    const results: any[] = [];
    for (const currency of currenciesToLoad) {
      const data = await this.forceLoadCurrencyData(address, currency);
      results.push(data);
    }

    // Get existing data from cache sequentially
    const existingAda = status.ada.hasData ? await this.getCachedData(address, 'ADA') : [];
    const existingUsd = status.usd.hasData ? await this.getCachedData(address, 'USD') : [];
    const existingEur = status.eur.hasData ? await this.getCachedData(address, 'EUR') : [];

    return {
      adaData: status.ada.hasData ? existingAda : results[currenciesToLoad.indexOf('ADA')] || [],
      usdData: status.usd.hasData ? existingUsd : results[currenciesToLoad.indexOf('USD')] || [],
      eurData: status.eur.hasData ? existingEur : results[currenciesToLoad.indexOf('EUR')] || [],
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
