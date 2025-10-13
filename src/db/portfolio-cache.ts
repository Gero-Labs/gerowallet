import { getDb } from '@/db/wallet-db';
import tapToolsApi from '@/api/tap-tools-api';
import { walletStore } from '@/stores/walletStore';
import { getTimeframeBasedOnExpiry } from '@/shared/utils/timeframe';

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
  try {
    const walletId = walletStore.loggedWallet?.id;
    if (!walletId) {
      console.debug('No wallet logged in for portfolio cache');
      return null;
    }
    return await getDb(walletId);
  } catch (error) {
    console.warn('Error getting wallet database for portfolio cache:', error);
    return null;
  }
}

/**
 * Check if portfolio_charts table exists in the database
 * This is needed for old users who might not have the table yet
 */
async function hasPortfolioChartsTable(db: any): Promise<boolean> {
  try {
    if (!db) return false;
    
    // Check if the table exists in the database schema
    const tableNames = db.tables.map((table: any) => table.name);
    return tableNames.includes('portfolio_charts');
  } catch (error) {
    console.warn('Error checking for portfolio_charts table:', error);
    return false;
  }
}

/**
 * Safely access portfolio_charts table with error handling
 * Returns null if table doesn't exist (for old users)
 */
async function safeGetPortfolioTable(db: any): Promise<any> {
  try {
    if (!db) return null;
    
    const hasTable = await hasPortfolioChartsTable(db);
    if (!hasTable) {
      console.debug('portfolio_charts table does not exist yet (old wallet database)');
      return null;
    }
    
    return db.table('portfolio_charts');
  } catch (error) {
    console.warn('Error accessing portfolio_charts table:', error);
    return null;
  }
}

export class PortfolioCacheService {
  private cacheTimeMs: number;
  private enableCache: boolean;

  constructor(options: PortfolioCacheOptions = {}) {
    this.cacheTimeMs = options.cacheTimeMs || DEFAULT_CACHE_TIME;
    this.enableCache = options.enableCache !== false;
  }

  /**
   * Validates if a data point is valid
   */
  private isValidDataPoint(timestamp: number, value: number): boolean {
    return (
      typeof timestamp === 'number' &&
      timestamp > 0 &&
      !isNaN(timestamp) &&
      typeof value === 'number' &&
      !isNaN(value) &&
      value >= 0
    );
  }

  /**
   * Professional data merging with deduplication and validation
   */
  private mergePortfolioData(existingData: any[], newData: any[]): any[] {
    const dataMap = new Map<number, number>();

    // Add existing data first (preserve history)
    existingData.forEach(([timestamp, value]) => {
      if (this.isValidDataPoint(timestamp, value)) {
        dataMap.set(timestamp, value);
      }
    });

    // Add new data (overwrites duplicates, adds new points)
    newData.forEach(([timestamp, value]) => {
      if (this.isValidDataPoint(timestamp, value)) {
        dataMap.set(timestamp, value);
      }
    });

    // Convert to sorted array
    return Array.from(dataMap.entries())
      .map(([timestamp, value]) => [timestamp, value])
      .sort((a, b) => a[0] - b[0]);
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
      
      // Guard against undefined db
      if (!db) {
        console.debug('Database not available for cache retrieval');
        return null;
      }
      
      const now = Date.now();

      // Safely get the portfolio table
      const portfolioTable = await safeGetPortfolioTable(db);
      if (!portfolioTable) {
        return null; // Table doesn't exist for old users
      }

      // Try composite index first, fallback to individual queries if schema mismatch
      let entry;
      try {
        entry = await portfolioTable.where(['address', 'currency']).equals([address, currency]).first();
      } catch (schemaError: any) {
        if (schemaError.name === 'SchemaError') {
          console.warn('Composite index not available, using fallback method for cache lookup');
          // Fallback: query by address and filter by currency
          const entries = await portfolioTable.where('address').equals(address).toArray();
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

        // Don't remove expired data here - let loadPortfolioData handle it
        // This way we can still access expiresAt for timeframe calculation
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

      // Guard against undefined db
      if (!db) {
        console.warn('Database not available for cache save');
        return;
      }
      const now = Date.now();
      const expiresAt = now + this.cacheTimeMs;

      // Limit data size to prevent memory issues (keep only last 5000 points)
      const limitedData = data.length > 5000 ? data.slice(-5000) : data;

      const entry: PortfolioChartsEntry = {
        address,
        currency,
        data: JSON.stringify(limitedData), // Convert to JSON string to save memory
        timestamp: now,
        expiresAt,
      };



      // Safely get the portfolio table
      const portfolioTable = await safeGetPortfolioTable(db);
      if (!portfolioTable) {
        console.debug('portfolio_charts table not available, skipping cache save');
        return; // Table doesn't exist for old users
      }

      // Remove existing entry if exists
      await this.removeCachedData(address, currency);

      // Add new entry
      await portfolioTable.add(entry);
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

      // Guard against undefined db
      if (!db) {
        console.warn('Database not available for cache removal');
        return;
      }

      // Safely get the portfolio table
      const portfolioTable = await safeGetPortfolioTable(db);
      if (!portfolioTable) {
        console.debug('portfolio_charts table not available, skipping cache removal');
        return; // Table doesn't exist for old users
      }

      // Try composite index first, fallback to individual queries if schema mismatch
      try {
        await portfolioTable.where(['address', 'currency']).equals([address, currency]).delete();
      } catch (schemaError: any) {
        if (schemaError.name === 'SchemaError') {
          console.warn('Composite index not available, using fallback method for cache removal');
          // Fallback: query by address and filter by currency
          const entries = await portfolioTable.where('address').equals(address).toArray();
          const entriesToDelete = entries.filter(entry => entry.currency === currency);
          for (const entry of entriesToDelete) {
            await portfolioTable.delete(entry.id);
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
      
      // Guard against undefined db
      if (!db) {
        console.debug('Database not available for cache clearing');
        return;
      }
      
      // Safely get the portfolio table
      const portfolioTable = await safeGetPortfolioTable(db);
      if (!portfolioTable) {
        console.debug('portfolio_charts table not available, skipping cache clearing');
        return; // Table doesn't exist for old users
      }
      
      await portfolioTable.where('address').equals(address).delete();
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
      
      // Guard against undefined db
      if (!db) {
        console.debug('Database not available for cache cleanup');
        return 0;
      }
      
      // Safely get the portfolio table
      const portfolioTable = await safeGetPortfolioTable(db);
      if (!portfolioTable) {
        console.debug('portfolio_charts table not available, skipping cache cleanup');
        return 0; // Table doesn't exist for old users
      }
      
      const now = Date.now();
      const expiredEntries = await portfolioTable.where('expiresAt').belowOrEqual(now).toArray();

      if (expiredEntries.length > 0) {
        await portfolioTable.where('expiresAt').belowOrEqual(now).delete();
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
      return [];
    }

    // Check cache first
    const cachedData = await this.getCachedData(address, currency);
    if (cachedData) {
      return cachedData;
    }


    // Determine timeframe based on existing expired data
    let timeframe = 'all'; // default

    try {
      const db = await getWalletDb();
      
      if (db) {
        const portfolioTable = await safeGetPortfolioTable(db);
        if (portfolioTable) {
          const existingEntry = await portfolioTable
            .where(['address', 'currency'])
            .equals([address, currency])
            .first();

          if (existingEntry && existingEntry.expiresAt) {
            const now = Date.now();
            if (now > existingEntry.expiresAt) {
              // Data expired, determine timeframe based on expiry time
              // But always use at least 30d for good chart data
              const calculatedTimeframe = getTimeframeBasedOnExpiry(existingEntry.expiresAt);
              timeframe = ['24h', '7d'].includes(calculatedTimeframe) ? '30d' : calculatedTimeframe;
            }
          } else {
            // No existing data, use full year for initial load
            timeframe = '1y';
          }
        } else {
          // Table doesn't exist, use default timeframe
          timeframe = '1y';
        }
      } else {
        // No database available, use default timeframe
        timeframe = '1y';
      }
    } catch (error) {
      // If there's an error checking existing data, use default timeframe
      console.warn('Error checking existing data for timeframe calculation:', error);
    }

    // Load from API with a determined timeframe
    try {
      const { data } = await tapToolsApi.getPortfolioTrendedValue(address, currency, timeframe);

      // Use all available data for better chart quality
      const limitedData = data;

      // Simple conversion to array format
      const newData = limitedData.map((item: any) => [item.time * 1000, item.value]);

      // Get existing data before removing cache entry
      let existingData: any[] = [];
      try {
        const db = await getWalletDb();
        
        if (db) {
          const portfolioTable = await safeGetPortfolioTable(db);
          if (portfolioTable) {
            const existingEntry = await portfolioTable
              .where(['address', 'currency'])
              .equals([address, currency])
              .first();

            if (existingEntry && existingEntry.data) {
              if (Array.isArray(existingEntry.data)) {
                existingData = existingEntry.data;
              } else if (typeof existingEntry.data === 'string') {
                existingData = JSON.parse(existingEntry.data);
              }
            }
          }
        }
      } catch (error) {
        console.warn('Error getting existing data for merge:', error);
      }

      // Professional data merging: preserve existing + add new (already sorted)
      const mergedData = this.mergePortfolioData(existingData, newData);

      // Use merged data as-is for better chart resolution
      let finalData = mergedData;

      // Remove expired entry and save merged data
      await this.removeCachedData(address, currency);
      await this.saveToCache(address, currency, finalData);

      return finalData;
    } catch (error) {
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
      return { adaData: [], usdData: [], eurData: [] };
    }

    try {
      const db = await getWalletDb();
      
      // Guard against undefined db
      if (!db) {
        console.debug('Database not available for loading all portfolio data');
        return { adaData: [], usdData: [], eurData: [] };
      }

      // Safely get the portfolio table
      const portfolioTable = await safeGetPortfolioTable(db);
      if (!portfolioTable) {
        console.debug('portfolio_charts table not available, skipping cache load');
        // For old users without the table, just load fresh data
        const currenciesToLoad = ['ADA', 'USD', 'EUR'] as const;
        const loadPromises = currenciesToLoad.map(async currency => {
          try {
            const { data } = await tapToolsApi.getPortfolioTrendedValue(address, currency, '1y');
            return data.map((item: any) => [item.time * 1000, item.value]);
          } catch (error) {
            console.error(`Error loading ${currency} portfolio data:`, error);
            return [];
          }
        });
        
        const [adaData, usdData, eurData] = await Promise.all(loadPromises);
        return { adaData, usdData, eurData };
      }

      // Load cache data in parallel for better performance
      const [cachedAda, cachedUsd, cachedEur] = await Promise.all([
        portfolioTable.where(['address', 'currency']).equals([address, 'ADA']).first(),
        portfolioTable.where(['address', 'currency']).equals([address, 'USD']).first(),
        portfolioTable.where(['address', 'currency']).equals([address, 'EUR']).first(),
      ]);

      // Determine what needs to be loaded
      const now = Date.now();
      const currenciesToLoad: ('ADA' | 'USD' | 'EUR')[] = [];

      const isValidEntry = (entry: any) => entry && entry.expiresAt > now;

      if (!isValidEntry(cachedAda)) currenciesToLoad.push('ADA');
      if (!isValidEntry(cachedUsd)) currenciesToLoad.push('USD');
      if (!isValidEntry(cachedEur)) currenciesToLoad.push('EUR');

      // Parse cached data
      const parseData = (entry: any, currency: string) => {
        if (!entry || !entry.data) {
          return [];
        }
        try {
          return Array.isArray(entry.data) ? entry.data : JSON.parse(entry.data);
        } catch (e) {
          return [];
        }
      };

      let adaData = parseData(cachedAda, 'ADA');
      let usdData = parseData(cachedUsd, 'USD');
      let eurData = parseData(cachedEur, 'EUR');

      // Load missing data in parallel for better performance
      if (currenciesToLoad.length > 0) {
        try {
          const loadPromises = currenciesToLoad.map(async currency => {
            try {
              const { data } = await tapToolsApi.getPortfolioTrendedValue(address, currency, '1y');

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
        } catch (error) {}
      }

      return {
        adaData: Array.isArray(adaData) ? adaData : [],
        usdData: Array.isArray(usdData) ? usdData : [],
        eurData: Array.isArray(eurData) ? eurData : [],
      };
    } catch (error) {
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
    return this.loadAllPortfolioData(address);
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
      
      // Guard against undefined db
      if (!db) {
        console.debug('Database not available for cache status check');
        return {
          ada: { hasData: false, dataPoints: 0, expiresAt: null },
          usd: { hasData: false, dataPoints: 0, expiresAt: null },
          eur: { hasData: false, dataPoints: 0, expiresAt: null },
        };
      }
      
      // Safely get the portfolio table
      const portfolioTable = await safeGetPortfolioTable(db);
      if (!portfolioTable) {
        console.debug('portfolio_charts table not available for cache status check');
        return {
          ada: { hasData: false, dataPoints: 0, expiresAt: null },
          usd: { hasData: false, dataPoints: 0, expiresAt: null },
          eur: { hasData: false, dataPoints: 0, expiresAt: null },
        };
      }
      
      const now = Date.now();

      // Load data for all currencies
      const adaEntry = await portfolioTable
        .where(['address', 'currency'])
        .equals([address, 'ADA'])
        .first();

      const usdEntry = await portfolioTable
        .where(['address', 'currency'])
        .equals([address, 'USD'])
        .first();

      const eurEntry = await portfolioTable
        .where(['address', 'currency'])
        .equals([address, 'EUR'])
        .first();

      return {
        ada: {
          hasData: !!adaEntry && adaEntry.expiresAt > now,
          dataPoints: adaEntry
            ? Array.isArray(adaEntry.data)
              ? adaEntry.data.length
              : typeof adaEntry.data === 'string'
              ? JSON.parse(adaEntry.data).length
              : 0
            : 0,
          expiresAt: adaEntry?.expiresAt || null,
        },
        usd: {
          hasData: !!usdEntry && usdEntry.expiresAt > now,
          dataPoints: usdEntry
            ? Array.isArray(usdEntry.data)
              ? usdEntry.data.length
              : typeof usdEntry.data === 'string'
              ? JSON.parse(usdEntry.data).length
              : 0
            : 0,
          expiresAt: usdEntry?.expiresAt || null,
        },
        eur: {
          hasData: !!eurEntry && eurEntry.expiresAt > now,
          dataPoints: eurEntry
            ? Array.isArray(eurEntry.data)
              ? eurEntry.data.length
              : typeof eurEntry.data === 'string'
              ? JSON.parse(eurEntry.data).length
              : 0
            : 0,
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
      // Determine timeframe based on existing expired data before removing it
      let timeframe = 'all'; // default

      try {
        const db = await getWalletDb();
        
        if (db) {
          const portfolioTable = await safeGetPortfolioTable(db);
          if (portfolioTable) {
            const existingEntry = await portfolioTable
              .where(['address', 'currency'])
              .equals([address, currency])
              .first();

            if (existingEntry && existingEntry.expiresAt) {
              const now = Date.now();
              if (now > existingEntry.expiresAt) {
                // Data expired, determine timeframe based on expiry time
                // But always use at least 30d for good chart data
                const calculatedTimeframe = getTimeframeBasedOnExpiry(existingEntry.expiresAt);
                timeframe = ['24h', '7d'].includes(calculatedTimeframe) ? '30d' : calculatedTimeframe;
              }
            } else {
              // No existing data, use full year for an initial load
              timeframe = '1y';
            }
          } else {
            // Table doesn't exist, use default timeframe
            timeframe = '1y';
          }
        } else {
          // No database available, use default timeframe
          timeframe = '1y';
        }
      } catch (error) {
        console.warn('Error checking existing data for timeframe calculation in force load:', error);
      }

      // Get existing data before removing the cache entry
      let existingData: any[] = [];
      try {
        const db = await getWalletDb();
        
        if (db) {
          const portfolioTable = await safeGetPortfolioTable(db);
          if (portfolioTable) {
            const existingEntry = await portfolioTable
              .where(['address', 'currency'])
              .equals([address, currency])
              .first();

            if (existingEntry && existingEntry.data) {
              if (Array.isArray(existingEntry.data)) {
                existingData = existingEntry.data;
              } else if (typeof existingEntry.data === 'string') {
                existingData = JSON.parse(existingEntry.data);
              }
            }
          }
        }
      } catch (error) {
        console.warn('Error getting existing data for merge in force load:', error);
      }

      // Load from API with determined timeframe
      const { data } = await tapToolsApi.getPortfolioTrendedValue(address, currency, timeframe);

      // Simple conversion to array format
      const newData = data.map((item: any) => [item.time * 1000, item.value]);

      // Professional data merging: preserve existing + add new (already sorted)
      const mergedData = this.mergePortfolioData(existingData, newData);

      // Use merged data as-is for better chart resolution
      let finalData = mergedData;

      // Remove existing cache for this currency and save merged data
      await this.removeCachedData(address, currency);
      await this.saveToCache(address, currency, finalData);
      return finalData;
    } catch (error) {
      return [];
    }
  }

  /**
   * Load missing data only (doesn't touch the existing cache)
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
    const loadPromises = currenciesToLoad.map(currency => this.forceLoadCurrencyData(address, currency));

    // Get existing data from cache in parallel
    const existingDataPromises = [
      status.ada.hasData ? this.getCachedData(address, 'ADA') : Promise.resolve([]),
      status.usd.hasData ? this.getCachedData(address, 'USD') : Promise.resolve([]),
      status.eur.hasData ? this.getCachedData(address, 'EUR') : Promise.resolve([]),
    ];

    // Wait for all operations to complete
    const [loadedResults, existingAda, existingUsd, existingEur] = await Promise.all([
      Promise.all(loadPromises),
      ...existingDataPromises,
    ]);

    return {
      adaData: status.ada.hasData ? existingAda : loadedResults[currenciesToLoad.indexOf('ADA')] || [],
      usdData: status.usd.hasData ? existingUsd : loadedResults[currenciesToLoad.indexOf('USD')] || [],
      eurData: status.eur.hasData ? existingEur : loadedResults[currenciesToLoad.indexOf('EUR')] || [],
    };
  }
}

// Export a singleton instance with default settings (1-minute cache for testing)
export const portfolioCacheService: PortfolioCacheService = new PortfolioCacheService();

// Export utility functions for common use cases
export const createPortfolioCacheService = (cacheTimeHours: number = 4, enableCache: boolean = true) => {
  return new PortfolioCacheService({
    cacheTimeMs: cacheTimeHours * 60 * 60 * 1000,
    enableCache,
  });
};
