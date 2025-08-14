import Vue from 'vue';
import { createStorageSync, smartPersist, hydrateStore, getContextType } from '@/utils/storageSync';

export interface MarketToken {
  symbol: string;
  description: string;
  currency: string;
  ticker: string;
  name: string;
  currentPrice: number;
  dailyVolume: number;
  dailyPriceChange: number;
  currentTvl: number;
  logoUrl?: string;
}

export interface MarketData {
  topVolume: MarketToken[];
  topGainers: MarketToken[];
  topTvl: MarketToken[];
}

export interface TokenLogo {
  url: string;
  timestamp: number;
}

export interface Charli3Store {
  marketData: MarketData;
  logoCache: Record<string, TokenLogo>;
  lastRefreshTime: Date | null;
  loading: boolean;
  error: string | null;
}

export const charli3Store = Vue.observable<Charli3Store>({
  marketData: {
    topVolume: [],
    topGainers: [],
    topTvl: []
  },
  logoCache: {},
  lastRefreshTime: null,
  loading: false,
  error: null
});

// Initialize store with centralized storage sync
const SYNC_KEYS = ['marketData', 'logoCache', 'lastRefreshTime', 'error'];

// Hydrate from storage on initialization
hydrateStore('charli3Store', charli3Store);

// Set up centralized storage sync
const unsubscribe = createStorageSync(charli3Store, {
  storeName: 'charli3Store',
  syncKeys: SYNC_KEYS,
  debugPrefix: '🔄 Charli3Store'
});

// Clean up on unload (for contexts that support it)
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', unsubscribe);
}

async function persist(patch: Partial<Charli3Store>): Promise<void> {
  const context = getContextType();
  
  // Only persist from background context to prevent cross-context conflicts
  if (context !== 'background') {
    console.debug(`🔍 Charli3Store persist skipped from ${context} context for:`, Object.keys(patch));
    return;
  }

  const next = { 
    ...charli3Store, 
    ...patch,
    // Convert Date to string for storage
    lastRefreshTime: patch.lastRefreshTime ? patch.lastRefreshTime.toISOString() : charli3Store.lastRefreshTime?.toISOString()
  };
  
  const nextString = JSON.stringify(next, (key, value) => {
    if (typeof value === 'bigint') {
      return value.toString();
    }
    return value;
  });
  
  await smartPersist('charli3Store', JSON.parse(nextString));
}

export default {
  setMarketData(marketData: MarketData) {
    charli3Store.marketData = marketData;
    charli3Store.lastRefreshTime = new Date();
    charli3Store.error = null;
    persist({ 
      marketData, 
      lastRefreshTime: charli3Store.lastRefreshTime,
      error: null
    });
  },

  setLoading(loading: boolean) {
    charli3Store.loading = loading;
    // Don't persist loading state
  },

  setError(error: string | null) {
    charli3Store.error = error;
    charli3Store.loading = false;
    persist({ error, loading: false });
  },

  cacheTokenLogo(tokenKey: string, logoUrl: string) {
    const logoEntry: TokenLogo = {
      url: logoUrl,
      timestamp: Date.now()
    };
    
    charli3Store.logoCache[tokenKey] = logoEntry;
    persist({ logoCache: charli3Store.logoCache });
  },

  getCachedLogo(tokenKey: string): string | null {
    const cached = charli3Store.logoCache[tokenKey];
    if (!cached) return null;

    const now = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;

    if (now - cached.timestamp < twentyFourHours) {
      return cached.url;
    } else {
      // Remove expired cache entry
      delete charli3Store.logoCache[tokenKey];
      persist({ logoCache: charli3Store.logoCache });
      return null;
    }
  },

  clearExpiredLogos() {
    const now = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;
    let hasChanged = false;

    for (const [key, entry] of Object.entries(charli3Store.logoCache)) {
      // Remove expired entries
      if (now - entry.timestamp >= twentyFourHours) {
        delete charli3Store.logoCache[key];
        hasChanged = true;
      }
      // Remove invalid blob URLs (these cause ERR_FILE_NOT_FOUND errors)
      else if (entry.url && entry.url.startsWith('blob:')) {
        console.log(`Removing invalid blob URL for ${key}`);
        delete charli3Store.logoCache[key];
        hasChanged = true;
      }
    }

    if (hasChanged) {
      persist({ logoCache: charli3Store.logoCache });
    }
  },

  clearInvalidBlobUrls() {
    let hasChanged = false;

    for (const [key, entry] of Object.entries(charli3Store.logoCache)) {
      if (entry.url && entry.url.startsWith('blob:')) {
        console.log(`Clearing invalid blob URL for ${key}: ${entry.url}`);
        delete charli3Store.logoCache[key];
        hasChanged = true;
      }
    }

    if (hasChanged) {
      persist({ logoCache: charli3Store.logoCache });
      console.log('Cleared all invalid blob URLs from cache');
    }
  },

  updateTokenLogo(ticker: string, logoUrl: string) {
    // Update logo in market data arrays
    const updateArrayLogos = (tokens: MarketToken[]) => {
      tokens.forEach(token => {
        if (token.ticker === ticker) {
          token.logoUrl = logoUrl;
        }
      });
    };

    updateArrayLogos(charli3Store.marketData.topVolume);
    updateArrayLogos(charli3Store.marketData.topGainers);
    updateArrayLogos(charli3Store.marketData.topTvl);

    // Persist updated market data
    persist({ marketData: charli3Store.marketData });
  },

  isDataStale(): boolean {
    if (!charli3Store.lastRefreshTime) return true;
    // Handle both Date objects and ISO strings from storage
    const lastRefresh = charli3Store.lastRefreshTime instanceof Date 
      ? charli3Store.lastRefreshTime 
      : new Date(charli3Store.lastRefreshTime);
    const fiveMinutes = 5 * 60 * 1000;
    return Date.now() - lastRefresh.getTime() > fiveMinutes;
  },

  getNextRefreshTime(): Date | null {
    if (!charli3Store.lastRefreshTime) return null;
    // Handle both Date objects and ISO strings from storage
    const lastRefresh = charli3Store.lastRefreshTime instanceof Date 
      ? charli3Store.lastRefreshTime 
      : new Date(charli3Store.lastRefreshTime);
    return new Date(lastRefresh.getTime() + 5 * 60 * 1000);
  },

  state: charli3Store
};