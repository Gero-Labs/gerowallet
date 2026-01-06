import Vue from 'vue';
import { parseHttpError } from '@/shared/utils/parser';
import tapToolsApi from '@/api/tap-tools-api';
import { getContextType } from '@/utils/storageSync';
import storeMessaging from '@/services/storeMessaging.service';
import backgroundStoreMessaging from '@/chrome/storeMessagingBg';

export interface TapToolsStore {
  portfolio: any;
  portfolioTrendedValue: any;
  tokens: {};
}

// Create observable state
export const tapToolsStore = Vue.observable<TapToolsStore>({
  portfolio: {},
  portfolioTrendedValue: {},
  tokens: {}
});

const STORE_NAME = 'tapToolsStore';
const context = getContextType();

// Initialize messaging based on context
// IMPORTANT: Only browser context subscribes to background updates
// Background context directly updates local store via broadcastFromBackground()
if (context === 'browser') {
  // Browser context: Subscribe to updates from background
  storeMessaging.subscribe(STORE_NAME, (updates: Partial<TapToolsStore>) => {

    // Apply updates to the observable state
    Object.keys(updates).forEach(key => {
      if (key in tapToolsStore) {
        (tapToolsStore as any)[key] = updates[key as keyof TapToolsStore];
      }
    });
  });

  // Initial hydration from chrome.storage (fallback for initial state)
  chrome.storage.local.get(STORE_NAME, (result) => {
    if (result[STORE_NAME]) {
      Object.assign(tapToolsStore, result[STORE_NAME]);
    }
  });
}

/**
 * Broadcast updates from background context
 */
function broadcastFromBackground(updates: Partial<TapToolsStore>) {
  if (context === 'background') {
    // Broadcast to all connected browser contexts
    backgroundStoreMessaging.broadcastUpdate(STORE_NAME, updates);

    // Also persist to storage as fallback
    chrome.storage.local.get(STORE_NAME, (result) => {
      const current = result[STORE_NAME] || { portfolio: {}, portfolioTrendedValue: {}, tokens: {} };
      chrome.storage.local.set({
        [STORE_NAME]: { ...current, ...updates }
      });
    });
  }
}

export default {
  setPortfolio(portfolio: any) {
    tapToolsStore.portfolio = portfolio;

    // Broadcast from a background context
    broadcastFromBackground({ portfolio });
  },

  setPortfolioTrendedValue(portfolioTrendedValue: any) {
    tapToolsStore.portfolioTrendedValue = portfolioTrendedValue;

    // Broadcast from background context
    broadcastFromBackground({ portfolioTrendedValue });
  },

  setTokens(tokens: any) {
    tapToolsStore.tokens = tokens;

    // Broadcast from background context
    broadcastFromBackground({ tokens });
  },

  clear() {
    const clearedState: TapToolsStore = {
      portfolio: {},
      portfolioTrendedValue: {},
      tokens: {}
    };

    // Apply to local state
    Object.assign(tapToolsStore, clearedState);

    // Broadcast all changes at once
    broadcastFromBackground(clearedState);
  },

  async loadPortfolio(stakeAddress: string) {
    try {
      const res = await tapToolsApi.getPortfolio(stakeAddress);
      if (res?.status === 200) {
        this.setPortfolio(res.data);
      } else {
        console.warn('Failed to load portfolio:', parseHttpError(res));
      }
    } catch (e: any) {
      if (e.name === 'AxiosError') {
        if (e.status === 404) {
          console.warn('Portfolio not found for stake address:', stakeAddress);
          this.setPortfolio({});
        }
      }
      console.error('Error loading portfolio:', e);
    }
  },

  async loadPortfolioTrendedValue(stakeAddress: string, currency: string = 'USD', timeframe: string = 'all') {
    try {
      const res = await tapToolsApi.getPortfolioTrendedValue(stakeAddress, currency, timeframe);
      if (res?.status === 200) {
        this.setPortfolioTrendedValue(res.data.map((element: any) => [element.time * 1000, element.value]));
      } else {
        console.warn('Failed to load portfolio trended value:', parseHttpError(res));
      }
    } catch (e) {
      console.error('Error loading portfolio trended value:', e);
    }
  },

  // Expose the observable state
  state: tapToolsStore,

  // Utility method to get current state snapshot
  getSnapshot(): TapToolsStore {
    return { ...tapToolsStore };
  },

  // Utility method to reset state
  reset() {
    this.clear();
  },

  // Utility method to check if portfolio data exists
  hasPortfolioData(): boolean {
    return Object.keys(tapToolsStore.portfolio).length > 0;
  },

  // Utility method to check if trended value data exists
  hasTrendedValueData(): boolean {
    return Array.isArray(tapToolsStore.portfolioTrendedValue) && tapToolsStore.portfolioTrendedValue.length > 0;
  },

  // Utility method to get portfolio total value
  getPortfolioTotalValue(): number {
    return tapToolsStore.portfolio?.total_value || 0;
  },

  // Utility method to get portfolio change percentage
  getPortfolioChangePercent(): number {
    return tapToolsStore.portfolio?.change_24h_percent || 0;
  },

  // Utility method to check if portfolio data is stale (older than 5 minutes)
  isPortfolioStale(maxAge: number = 5 * 60 * 1000): boolean {
    const timestamp = tapToolsStore.portfolio?._timestamp;
    if (!timestamp) return true;
    return Date.now() - timestamp > maxAge;
  }
};
