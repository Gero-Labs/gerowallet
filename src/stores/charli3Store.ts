import Vue from 'vue';
import { getContextType } from '@/utils/storageSync';
import storeMessaging from '@/services/storeMessaging.service';
import backgroundStoreMessaging from '@/chrome/storeMessagingBg';
import { debugLog } from '@/utils/debug';

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

const STORE_NAME = 'charli3Store';
const context = getContextType();

// Initialize messaging based on context
// IMPORTANT: Only browser context subscribes to background updates
// Background context directly updates local store via broadcastFromBackground()
if (context === 'browser') {
  // Browser context: Subscribe to updates from background
  storeMessaging.subscribe(STORE_NAME, (updates: Partial<Charli3Store>) => {

    // Apply updates to the observable state
    Object.keys(updates).forEach(key => {
      if (key in charli3Store) {
        // Special handling for Date fields
        if (key === 'lastRefreshTime' && updates[key] && typeof updates[key] === 'string') {
          charli3Store[key] = new Date(updates[key] as string);
        } else {
          (charli3Store as any)[key] = updates[key as keyof Charli3Store];
        }
      }
    });
  });

  // Initial hydration from chrome.storage (fallback for initial state)
  chrome.storage.local.get(STORE_NAME, (result) => {
    if (result[STORE_NAME]) {
      const stored = result[STORE_NAME];
      // Convert stored date string back to Date object
      if (stored.lastRefreshTime && typeof stored.lastRefreshTime === 'string') {
        stored.lastRefreshTime = new Date(stored.lastRefreshTime);
      }
      Object.assign(charli3Store, stored);
      debugLog('💾 Hydrated charli3 store from storage');
    }
  });
}

/**
 * Broadcast updates from background context
 */
function broadcastFromBackground(updates: Partial<Charli3Store>) {
  if (context === 'background') {
    // Serialize data for broadcasting (convert Date to string)
    const serializedUpdates = JSON.parse(JSON.stringify(updates, (key, value) => {
      if (value instanceof Date) {
        return value.toISOString();
      } else if (typeof value === 'bigint') {
        return value.toString();
      } else {
        return value;
      }
    }));

    // Broadcast to all connected browser contexts
    backgroundStoreMessaging.broadcastUpdate(STORE_NAME, serializedUpdates);

    // Also persist to storage as fallback
    chrome.storage.local.get(STORE_NAME, (result) => {
      const current = result[STORE_NAME] || {
        marketData: {
          topVolume: [],
          topGainers: [],
          topTvl: []
        },
        logoCache: {},
        lastRefreshTime: null,
        loading: false,
        error: null
      };
      chrome.storage.local.set({
        [STORE_NAME]: { ...current, ...serializedUpdates }
      });
    });
  }
}

export default {
  setMarketData(marketData: MarketData) {
    charli3Store.marketData = marketData;
    charli3Store.lastRefreshTime = new Date();
    charli3Store.error = null;
    broadcastFromBackground({
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
    broadcastFromBackground({ error, loading: false });
  },

  cacheTokenLogo(tokenKey: string, logoUrl: string) {
    const logoEntry: TokenLogo = {
      url: logoUrl,
      timestamp: Date.now()
    };

    charli3Store.logoCache[tokenKey] = logoEntry;
    broadcastFromBackground({ logoCache: charli3Store.logoCache });
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
      broadcastFromBackground({ logoCache: charli3Store.logoCache });
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
      broadcastFromBackground({ logoCache: charli3Store.logoCache });
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
      broadcastFromBackground({ logoCache: charli3Store.logoCache });
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

    // Broadcast updated market data
    broadcastFromBackground({ marketData: charli3Store.marketData });
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

  state: charli3Store,

  // Utility method to get current state snapshot
  getSnapshot(): any {
    return {
      ...charli3Store,
      // Convert Date to string for serialization
      lastRefreshTime: charli3Store.lastRefreshTime?.toISOString() || null
    };
  },

  // Utility method to reset state
  reset() {
    const resetState: Charli3Store = {
      marketData: {
        topVolume: [],
        topGainers: [],
        topTvl: []
      },
      logoCache: {},
      lastRefreshTime: null,
      loading: false,
      error: null
    };

    Object.assign(charli3Store, resetState);
    broadcastFromBackground(resetState);
  },

  // Utility method to check if market data exists
  hasMarketData(): boolean {
    return charli3Store.marketData.topVolume.length > 0 ||
           charli3Store.marketData.topGainers.length > 0 ||
           charli3Store.marketData.topTvl.length > 0;
  },

  // Utility method to get top volume tokens
  getTopVolumeTokens(): MarketToken[] {
    return charli3Store.marketData.topVolume;
  },

  // Utility method to get top gainers
  getTopGainers(): MarketToken[] {
    return charli3Store.marketData.topGainers;
  },

  // Utility method to get top TVL tokens
  getTopTvlTokens(): MarketToken[] {
    return charli3Store.marketData.topTvl;
  },

  // Utility method to check cache size
  getCacheSize(): number {
    return Object.keys(charli3Store.logoCache).length;
  }
};
