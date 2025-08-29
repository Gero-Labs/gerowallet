import { getDb } from '@/db/wallet-db';
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

/**
 * Get wallet database for current logged wallet
 */
async function getWalletDb(): Promise<any> {
  const walletId = walletStore.loggedWallet?.id;
  if (!walletId) {
    throw new Error('No wallet logged in');
  }
  return await getDb(walletId);
}

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
      const db = await getWalletDb();
      const now = Date.now();
      
      // Try composite index first, fallback to individual queries if schema mismatch
      let entry;
      try {
        entry = await db
          .table('portfolio_charts')
          .where(['address', 'currency'])
          .equals([address, currency])
          .first();
      } catch (schemaError: any) {
        if (schemaError.name === 'SchemaError') {
          console.warn('Composite index not available, using fallback method for cache lookup');
          // Fallback: query by address and filter by currency
          const entries = await db.table('portfolio_charts').where('address').equals(address).toArray();
          entry = entries.find(e => e.currency === currency);
        } else {
          throw schemaError;
        }
      }

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
      const db = await getWalletDb();
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
      const db = await getWalletDb();
      
      // Try composite index first, fallback to individual queries if schema mismatch
      try {
        await db.table('portfolio_charts').where(['address', 'currency']).equals([address, currency]).delete();
      } catch (schemaError: any) {
        if (schemaError.name === 'SchemaError') {
          console.warn('Composite index not available, using fallback method for cache removal');
          // Fallback: query by address and filter by currency
          const entries = await db.table('portfolio_charts').where('address').equals(address).toArray();
          const entriesToDelete = entries.filter(entry => entry.currency === currency);
          for (const entry of entriesToDelete) {
            await db.table('portfolio_charts').delete(entry.id);
          }
        } else {
          throw schemaError;
        }
      }
    } catch (error) {
      console.error('Error removing cached portfolio data:', error);
    }
  }

  /**
   * Clear all cache for specific address
   */
  async clearAddressCache(address: string): Promise<void> {
    try {
      const db = await getWalletDb();
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
      // Note: This clears cache for a specific address only since we're using address-based portfolio DBs
      console.warn('clearAllCache: Cannot clear all caches across addresses with current architecture');
    } catch (error) {
      console.error('Error clearing all portfolio cache:', error);
    }
  }

  /**
   * Clean up expired cache entries
   */
  async cleanupExpiredCache(address: string): Promise<number> {
    try {
      const db = await getWalletDb();
      const now = Date.now();
      const expiredEntries = await db.table('portfolio_charts').where('expiresAt').belowOrEqual(now).toArray();
      
      if (expiredEntries.length > 0) {
        await db.table('portfolio_charts').where('expiresAt').belowOrEqual(now).delete();
      }
      
      return expiredEntries.length;
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
      // Note: Stats for specific address only
      console.warn('getCacheStats: Can only provide stats for specific address with current architecture');
      return {
        totalEntries: 0,
        validEntries: 0,
        expiredEntries: 0,
        oldestEntry: null,
        newestEntry: null,
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
      const db = await getWalletDb();
      
      // Load cache data in parallel for better performance
      const [cachedAda, cachedUsd, cachedEur] = await Promise.all([
        db.table('portfolio_charts').where(['address', 'currency']).equals([address, 'ADA']).first(),
        db.table('portfolio_charts').where(['address', 'currency']).equals([address, 'USD']).first(),
        db.table('portfolio_charts').where(['address', 'currency']).equals([address, 'EUR']).first()
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
      const db = await getWalletDb();
      const now = Date.now();

      // Load data for all currencies
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
          hasData: !!adaEntry && adaEntry.expiresAt > now,
          dataPoints: adaEntry ? (Array.isArray(adaEntry.data) ? adaEntry.data.length : 
                                  typeof adaEntry.data === 'string' ? JSON.parse(adaEntry.data).length : 0) : 0,
          expiresAt: adaEntry?.expiresAt || null,
        },
        usd: {
          hasData: !!usdEntry && usdEntry.expiresAt > now,
          dataPoints: usdEntry ? (Array.isArray(usdEntry.data) ? usdEntry.data.length : 
                                  typeof usdEntry.data === 'string' ? JSON.parse(usdEntry.data).length : 0) : 0,
          expiresAt: usdEntry?.expiresAt || null,
        },
        eur: {
          hasData: !!eurEntry && eurEntry.expiresAt > now,
          dataPoints: eurEntry ? (Array.isArray(eurEntry.data) ? eurEntry.data.length : 
                                  typeof eurEntry.data === 'string' ? JSON.parse(eurEntry.data).length : 0) : 0,
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
