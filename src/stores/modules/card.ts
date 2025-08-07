import Vue from 'vue';
import type { AuthTokens, HistoryParams, CardState, CardTransactionHistory } from '@/models/card';
import type { Activity } from '@/models/types';
import { Api } from '@/api/api';
import { Provider } from '@/models/types';

export const cardStore = Vue.observable<CardState>({
  // Auth
  accessToken: null,
  refreshToken: null,
  tokenExpiry: null,

  // User data
  userInfo: null,
  cardanoAddress: null,

  // Card data
  cardData: null,
  cardNumber: null,
  cardBalance: null,
  cardHistory: null,
  totalDeposits: 0,
  activities: [
    {
      id: 1,
      type: 'Top-up',
      cryptoAmount: '₳200',
      fiatAmount: '+€130.00',
      date: '03/05/2025',
      status: 'Completed',
    },
    {
      id: 2,
      type: 'Top-up',
      cryptoAmount: '₳200',
      fiatAmount: '+€130.00',
      date: '03/05/2025',
      status: 'Completed',
    },
  ],

  // Loading states
  loading: {
    userInfo: false,
    cardanoAddress: false,
    cardData: false,
    cardNumber: false,
    cardBalance: false,
    cardHistory: false,
    auth: false,
  },

  // Error states
  errors: {
    userInfo: null,
    cardanoAddress: null,
    cardData: null,
    cardNumber: null,
    cardBalance: null,
    cardHistory: null,
    auth: null,
  },
});

// Load stored data from chrome storage
chrome.storage.local.get('cardStore', res => {
  if (res['cardStore']) {
    Object.assign(cardStore, res['cardStore']);
  }
});

// Persist data to chrome storage
function persist(patch: Partial<CardState>) {
  const next = { ...cardStore, ...patch };
  chrome.storage.local.set({ cardStore: next });
}

// Create API instance for card operations
function getCardApi(wallet: any): Api {
  const api = new Api(wallet, Provider.BLOCKFROST);

  // Add auth interceptor for card operations
  api.axiosInstance.interceptors.request.use(config => {
    if (cardStore.accessToken) {
      config.headers.Authorization = `Bearer ${cardStore.accessToken}`;
    }
    return config;
  });

  // Add response interceptor for token refresh
  api.axiosInstance.interceptors.response.use(
    response => response,
    async error => {
      if (error.response?.status === 401 && cardStore.refreshToken) {
        try {
          await cardStoreInstance.refreshAccessToken(wallet);
          // Retry original request
          const originalRequest = error.config;
          originalRequest.headers.Authorization = `Bearer ${cardStore.accessToken}`;
          return api.axiosInstance(originalRequest);
        } catch (refreshError) {
          await cardStoreInstance.logout();
          throw refreshError;
        }
      }
      throw error;
    }
  );

  return api;
}

// Create store instance for internal use
const cardStoreInstance = {
  async refreshAccessToken(wallet: any): Promise<void> {
    if (!cardStore.refreshToken) throw new Error('No refresh token available');

    try {
      const api = getCardApi(wallet);
      const response = await api.axiosInstance.post('/api/token/refresh', {
        refresh_token: cardStore.refreshToken,
      });

      const tokens: AuthTokens = response.data;
      cardStore.accessToken = tokens.access_token;
      cardStore.refreshToken = tokens.refresh_token;
      cardStore.tokenExpiry = Date.now() + tokens.expires_in * 1000;

      persist({
        accessToken: cardStore.accessToken,
        refreshToken: cardStore.refreshToken,
        tokenExpiry: cardStore.tokenExpiry,
      });

      await storeTokens(tokens);
    } catch (error) {
      await this.logout();
      throw error;
    }
  },

  async logout(): Promise<void> {
    cardStore.accessToken = null;
    cardStore.refreshToken = null;
    cardStore.tokenExpiry = null;
    cardStore.userInfo = null;
    cardStore.cardanoAddress = null;
    cardStore.cardData = null;
    cardStore.cardNumber = null;
    cardStore.cardBalance = null;
    cardStore.cardHistory = null;
    cardStore.totalDeposits = 0;
    cardStore.activities = [];

    persist({
      accessToken: cardStore.accessToken,
      refreshToken: cardStore.refreshToken,
      tokenExpiry: cardStore.tokenExpiry,
      userInfo: cardStore.userInfo,
      cardanoAddress: cardStore.cardanoAddress,
      cardData: cardStore.cardData,
      cardNumber: cardStore.cardNumber,
      cardBalance: cardStore.cardBalance,
      cardHistory: cardStore.cardHistory,
      totalDeposits: cardStore.totalDeposits,
      activities: cardStore.activities,
    });

    await clearStoredTokens();
  },
};

async function storeTokens(tokens: AuthTokens): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage) {
    await chrome.storage.local.set({
      kaiserex_access_token: tokens.access_token,
      kaiserex_refresh_token: tokens.refresh_token,
      kaiserex_token_expiry: Date.now() + tokens.expires_in * 1000,
    });
  }
}

async function clearStoredTokens(): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage) {
    await chrome.storage.local.remove(['kaiserex_access_token', 'kaiserex_refresh_token', 'kaiserex_token_expiry']);
  }
}

export default {
  // Getters
  get isAuthenticated() {
    if (!cardStore.accessToken || !cardStore.tokenExpiry) return false;
    return Date.now() < cardStore.tokenExpiry;
  },

  get hasCard() {
    return cardStore.cardData !== null;
  },

  get hasCardanoAddress() {
    return cardStore.cardanoAddress !== null;
  },

  get formattedBalance() {
    if (!cardStore.cardBalance) return null;
    return {
      amount: cardStore.cardBalance.currentBalance.amount,
      currency: cardStore.cardBalance.currentBalance.currencyCode,
      state: cardStore.cardBalance.state,
    };
  },

  get cardHistoryRecords() {
    return cardStore.cardHistory?.history.records || [];
  },

  get cardHistoryMeta() {
    return cardStore.cardHistory?.history.meta || null;
  },

  // Auth methods
  async authenticate(wallet: any, code: string, codeVerifier: string): Promise<void> {
    cardStore.loading.auth = true;
    cardStore.errors.auth = null;
    persist({ loading: cardStore.loading, errors: cardStore.errors });

    try {
      const api = getCardApi(wallet);
      const response = await api.axiosInstance.post('/api/token', {
        code,
        codeVerifier,
      });

      const tokens: AuthTokens = response.data;
      cardStore.accessToken = tokens.access_token;
      cardStore.refreshToken = tokens.refresh_token;
      cardStore.tokenExpiry = Date.now() + tokens.expires_in * 1000;

      persist({
        accessToken: cardStore.accessToken,
        refreshToken: cardStore.refreshToken,
        tokenExpiry: cardStore.tokenExpiry,
      });

      await storeTokens(tokens);
    } catch (error) {
      cardStore.errors.auth = error instanceof Error ? error.message : 'Authentication failed';
      persist({ errors: cardStore.errors });
      throw error;
    } finally {
      cardStore.loading.auth = false;
      persist({ loading: cardStore.loading });
    }
  },

  async refreshAccessToken(wallet: any): Promise<void> {
    if (!cardStore.refreshToken) throw new Error('No refresh token available');

    try {
      const api = getCardApi(wallet);
      const response = await api.axiosInstance.post('/api/token/refresh', {
        refresh_token: cardStore.refreshToken,
      });

      const tokens: AuthTokens = response.data;
      cardStore.accessToken = tokens.access_token;
      cardStore.refreshToken = tokens.refresh_token;
      cardStore.tokenExpiry = Date.now() + tokens.expires_in * 1000;

      persist({
        accessToken: cardStore.accessToken,
        refreshToken: cardStore.refreshToken,
        tokenExpiry: cardStore.tokenExpiry,
      });

      await storeTokens(tokens);
    } catch (error) {
      await this.logout();
      throw error;
    }
  },

  async logout(): Promise<void> {
    cardStore.accessToken = null;
    cardStore.refreshToken = null;
    cardStore.tokenExpiry = null;
    cardStore.userInfo = null;
    cardStore.cardanoAddress = null;
    cardStore.cardData = null;
    cardStore.cardNumber = null;
    cardStore.cardBalance = null;
    cardStore.cardHistory = null;
    cardStore.totalDeposits = 0;
    cardStore.activities = [];

    persist({
      accessToken: cardStore.accessToken,
      refreshToken: cardStore.refreshToken,
      tokenExpiry: cardStore.tokenExpiry,
      userInfo: cardStore.userInfo,
      cardanoAddress: cardStore.cardanoAddress,
      cardData: cardStore.cardData,
      cardNumber: cardStore.cardNumber,
      cardBalance: cardStore.cardBalance,
      cardHistory: cardStore.cardHistory,
      totalDeposits: cardStore.totalDeposits,
      activities: cardStore.activities,
    });

    await clearStoredTokens();
  },

  // User methods
  async fetchUserInfo(wallet: any): Promise<void> {
    cardStore.loading.userInfo = true;
    cardStore.errors.userInfo = null;
    persist({ loading: cardStore.loading, errors: cardStore.errors });

    try {
      const api = getCardApi(wallet);
      const response = await api.axiosInstance.get('/api/user');
      cardStore.userInfo = response.data;
      persist({ userInfo: cardStore.userInfo });
    } catch (error) {
      cardStore.errors.userInfo = error instanceof Error ? error.message : 'Failed to fetch user info';
      persist({ errors: cardStore.errors });
      throw error;
    } finally {
      cardStore.loading.userInfo = false;
      persist({ loading: cardStore.loading });
    }
  },

  async fetchCardanoAddress(wallet: any): Promise<void> {
    cardStore.loading.cardanoAddress = true;
    cardStore.errors.cardanoAddress = null;
    persist({ loading: cardStore.loading, errors: cardStore.errors });

    try {
      const api = getCardApi(wallet);
      const response = await api.axiosInstance.get('/api/cardano-address');
      cardStore.cardanoAddress = response.data;
      persist({ cardanoAddress: cardStore.cardanoAddress });
    } catch (error) {
      cardStore.errors.cardanoAddress = error instanceof Error ? error.message : 'Failed to fetch Cardano address';
      persist({ errors: cardStore.errors });
      throw error;
    } finally {
      cardStore.loading.cardanoAddress = false;
      persist({ loading: cardStore.loading });
    }
  },

  // Card methods
  async fetchCardData(wallet: any): Promise<void> {
    cardStore.loading.cardData = true;
    cardStore.errors.cardData = null;
    persist({ loading: cardStore.loading, errors: cardStore.errors });

    try {
      const api = getCardApi(wallet);
      const response = await api.axiosInstance.get('/api/card');
      cardStore.cardData = response.data;
      persist({ cardData: cardStore.cardData });
    } catch (error) {
      cardStore.errors.cardData = error instanceof Error ? error.message : 'Failed to fetch card data';
      persist({ errors: cardStore.errors });
      throw error;
    } finally {
      cardStore.loading.cardData = false;
      persist({ loading: cardStore.loading });
    }
  },

  async fetchCardNumber(wallet: any): Promise<void> {
    cardStore.loading.cardNumber = true;
    cardStore.errors.cardNumber = null;
    persist({ loading: cardStore.loading, errors: cardStore.errors });

    try {
      const api = getCardApi(wallet);
      const response = await api.axiosInstance.get('/api/card/number');
      cardStore.cardNumber = response.data;
      persist({ cardNumber: cardStore.cardNumber });
    } catch (error) {
      cardStore.errors.cardNumber = error instanceof Error ? error.message : 'Failed to fetch card number';
      persist({ errors: cardStore.errors });
      throw error;
    } finally {
      cardStore.loading.cardNumber = false;
      persist({ loading: cardStore.loading });
    }
  },

  async fetchCardBalance(wallet: any): Promise<void> {
    cardStore.loading.cardBalance = true;
    cardStore.errors.cardBalance = null;
    persist({ loading: cardStore.loading, errors: cardStore.errors });

    try {
      const api = getCardApi(wallet);
      const response = await api.axiosInstance.get('/api/card/balance');
      cardStore.cardBalance = response.data;
      persist({ cardBalance: cardStore.cardBalance });
    } catch (error) {
      cardStore.errors.cardBalance = error instanceof Error ? error.message : 'Failed to fetch card balance';
      persist({ errors: cardStore.errors });
      throw error;
    } finally {
      cardStore.loading.cardBalance = false;
      persist({ loading: cardStore.loading });
    }
  },

  async fetchCardHistory(wallet: any, params: HistoryParams = {}): Promise<void> {
    cardStore.loading.cardHistory = true;
    cardStore.errors.cardHistory = null;
    persist({ loading: cardStore.loading, errors: cardStore.errors });

    try {
      const api = getCardApi(wallet);
      const queryParams = new URLSearchParams();

      if (params.periodFrom) queryParams.append('periodFrom', params.periodFrom);
      if (params.periodTo) queryParams.append('periodTo', params.periodTo);
      if (params.page) queryParams.append('page', params.page.toString());
      if (params.size) queryParams.append('size', params.size.toString());

      const url = `/api/card/history${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
      const response = await api.axiosInstance.get(url);
      cardStore.cardHistory = response.data;
      persist({ cardHistory: cardStore.cardHistory });
    } catch (error) {
      cardStore.errors.cardHistory = error instanceof Error ? error.message : 'Failed to fetch card history';
      persist({ errors: cardStore.errors });
      throw error;
    } finally {
      cardStore.loading.cardHistory = false;
      persist({ loading: cardStore.loading });
    }
  },

  // Initialize store
  async initialize(wallet: any): Promise<void> {
    // Load stored tokens
    if (typeof chrome !== 'undefined' && chrome.storage) {
      const result = await chrome.storage.local.get([
        'kaiserex_access_token',
        'kaiserex_refresh_token',
        'kaiserex_token_expiry',
      ]);

      if (result['kaiserex_access_token'] && result['kaiserex_token_expiry']) {
        cardStore.accessToken = result['kaiserex_access_token'];
        cardStore.refreshToken = result['kaiserex_refresh_token'];
        cardStore.tokenExpiry = result['kaiserex_token_expiry'];
        persist({
          accessToken: cardStore.accessToken,
          refreshToken: cardStore.refreshToken,
          tokenExpiry: cardStore.tokenExpiry,
        });
      }
    }

    if (this.isAuthenticated) {
      try {
        // Preload essential data
        await Promise.all([
          this.fetchUserInfo(wallet),
          this.fetchCardanoAddress(wallet),
          this.fetchCardData(wallet),
          this.fetchCardBalance(wallet),
        ]);
      } catch (error) {
        console.error('Failed to initialize card store:', error);
      }
    }
  },

  // Top-up methods
  updateCardBalance(additionalAmount: number): void {
    if (cardStore.cardBalance) {
      cardStore.cardBalance.currentBalance.amount += additionalAmount;
      cardStore.totalDeposits += additionalAmount;
      persist({ cardBalance: cardStore.cardBalance, totalDeposits: cardStore.totalDeposits });
    }
  },

  addTopUpTransaction(adaAmount: number, eurAmount: number, transactionId: string): void {
    if (!cardStore.cardHistory) {
      cardStore.cardHistory = {
        history: {
          meta: { page: 1, records: 0, totalRecords: 0 },
          records: []
        }
      };
    }

    const newTransaction: CardTransactionHistory = {
      reference: transactionId,
      amount: {
        amount: eurAmount,
        currencyCode: 'EUR'
      },
      createTime: new Date().toISOString(),
      settlementDate: new Date().toISOString(),
      exchangeRate: eurAmount / adaAmount, // ADA to EUR rate
      actionCode: 'APPROVE',
      processingName: 'ADA Top-up',
      authorizationCode: `AUTH${Math.random().toString(36).substr(2, 8).toUpperCase()}`,
      cardAcceptorTerminalId: 'GERO001',
      cardAcceptorId: 'GEROWALLET',
      cardAcceptorNameAndLocation: 'Gero Wallet Top-up Service',
      acquireCountryCode: 'US',
      mcc: {
        code: '6012',
        description: 'Financial Institution'
      },
      reversedAmount: {
        amount: 0,
        currencyCode: 'EUR'
      },
      narrative: {
        description: `ADA to EUR conversion: ${adaAmount} ADA → ${eurAmount} EUR`
      },
      debit: false, // Credit transaction (adding money)
      state: 'SETTLED'
    };

    // Add to beginning of transactions array
    cardStore.cardHistory.history.records.unshift(newTransaction);
    cardStore.cardHistory.history.meta.records += 1;
    cardStore.cardHistory.history.meta.totalRecords += 1;
    
    console.log('💳 Transaction added to cardStore.cardHistory');
    console.log('💳 Total records now:', cardStore.cardHistory.history.meta.totalRecords);
    console.log('💳 First record:', cardStore.cardHistory.history.records[0]);
    
    persist({ cardHistory: cardStore.cardHistory });
  },

  addTopUpActivity(adaAmount: number, eurAmount: number): void {
    const newActivity: Activity = {
      id: Date.now(), // Use timestamp as unique ID
      type: 'Top-up',
      cryptoAmount: `₳${adaAmount.toFixed(0)}`,
      fiatAmount: `+€${eurAmount.toFixed(2)}`,
      date: new Date().toLocaleDateString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      }),
      status: 'Completed',
    };

    // Add to beginning of activities array using Vue.set for reactivity
    const newActivities = [newActivity, ...cardStore.activities];
    Vue.set(cardStore, 'activities', newActivities);
    
    console.log('🎯 Activity added to cardStore.activities');
    console.log('🎯 Total activities now:', cardStore.activities.length);
    console.log('🎯 First activity:', cardStore.activities[0]);
    console.log('🎯 All activities:', cardStore.activities);
    
    persist({ activities: cardStore.activities });
  },

  // State getter for compatibility
  get state() {
    return cardStore;
  },
};
