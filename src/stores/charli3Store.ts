import Vue from 'vue';

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

// Chrome storage integration
chrome.storage.local.get('charli3Store', (res) => {
  const stored = res['charli3Store'];
  if (stored) {
    // Restore market data and logo cache
    Object.assign(charli3Store, {
      marketData: stored.marketData || charli3Store.marketData,
      logoCache: stored.logoCache || {},
      lastRefreshTime: stored.lastRefreshTime ? new Date(stored.lastRefreshTime) : null,
      loading: false,
      error: null
    });
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes['charli3Store']) {
    const newValue = changes['charli3Store'].newValue;
    if (newValue) {
      Object.assign(charli3Store, {
        marketData: newValue.marketData || charli3Store.marketData,
        logoCache: newValue.logoCache || {},
        lastRefreshTime: newValue.lastRefreshTime ? new Date(newValue.lastRefreshTime) : null
      });
    }
  }
});

function persist(patch: Partial<Charli3Store>) {
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
  
  chrome.storage.local.set({ charli3Store: JSON.parse(nextString) });
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
    let hasExpired = false;

    for (const [key, entry] of Object.entries(charli3Store.logoCache)) {
      if (now - entry.timestamp >= twentyFourHours) {
        delete charli3Store.logoCache[key];
        hasExpired = true;
      }
    }

    if (hasExpired) {
      persist({ logoCache: charli3Store.logoCache });
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
    const fiveMinutes = 5 * 60 * 1000;
    return Date.now() - charli3Store.lastRefreshTime.getTime() > fiveMinutes;
  },

  getNextRefreshTime(): Date | null {
    if (!charli3Store.lastRefreshTime) return null;
    return new Date(charli3Store.lastRefreshTime.getTime() + 5 * 60 * 1000);
  },

  state: charli3Store
};