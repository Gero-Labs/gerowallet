import { defineStore } from 'pinia';
import axios, { AxiosInstance } from 'axios';

// Types based on Postman collection
interface CardanoAddress {
  address: string;
}

interface CardNumber {
  number: string;
}

interface CardBalance {
  currentBalance: {
    amount: number;
    currencyCode: string;
  };
  state: string;
}

interface CardData {
  pan: string;
  currentBalance: string;
  currency: string;
}

interface UserInfo {
  email: string;
}

interface TransactionHistory {
  reference: string;
  amount: {
    amount: number;
    currencyCode: string;
  };
  createTime: string;
  settlementDate: string;
  exchangeRate: number;
  actionCode: string;
  processingName: string;
  rejectReason?: string;
  authorizationCode: string;
  cardAcceptorTerminalId: string;
  cardAcceptorId: string;
  cardAcceptorNameAndLocation: string;
  acquireCountryCode: string;
  mcc: {
    code: string;
    description: string;
  };
  reversedAmount: {
    amount: number;
    currencyCode: string;
  };
  narrative: {
    description: string;
  };
  debit: boolean;
  state: string;
}

interface HistoryResponse {
  history: {
    meta: {
      page: number;
      records: number;
      totalRecords: number;
    };
    records: TransactionHistory[];
  };
}

interface AuthTokens {
  token_type: string;
  expires_in: number;
  access_token: string;
  refresh_token: string;
}

interface HistoryParams {
  periodFrom?: string;
  periodTo?: string;
  page?: number;
  size?: number;
}

export const useCardStore = defineStore('card', {
  state: () => ({
    // Auth
    accessToken: null as string | null,
    refreshToken: null as string | null,
    tokenExpiry: null as number | null,

    // User data
    userInfo: null as UserInfo | null,
    cardanoAddress: null as CardanoAddress | null,

    // Card data
    cardData: null as CardData | null,
    cardNumber: null as CardNumber | null,
    cardBalance: null as CardBalance | null,
    cardHistory: null as HistoryResponse | null,

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
      userInfo: null as string | null,
      cardanoAddress: null as string | null,
      cardData: null as string | null,
      cardNumber: null as string | null,
      cardBalance: null as string | null,
      cardHistory: null as string | null,
      auth: null as string | null,
    },
  }),

  getters: {
    isAuthenticated: state => {
      if (!state.accessToken || !state.tokenExpiry) return false;
      return Date.now() < state.tokenExpiry;
    },

    hasCard: state => state.cardData !== null,

    hasCardanoAddress: state => state.cardanoAddress !== null,

    formattedBalance: state => {
      if (!state.cardBalance) return null;
      return {
        amount: state.cardBalance.currentBalance.amount,
        currency: state.cardBalance.currentBalance.currencyCode,
        state: state.cardBalance.state,
      };
    },

    cardHistoryRecords: state => {
      return state.cardHistory?.history.records || [];
    },

    cardHistoryMeta: state => {
      return state.cardHistory?.history.meta || null;
    },
  },

  actions: {
    // Initialize axios instance with auth
    getAxiosInstance(): AxiosInstance {
      const instance = axios.create({
        baseURL: import.meta.env['VITE_KAISEREX_API_URL'] || 'https://api.dev.kaiserex.cybro.cz',
        timeout: 30000,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      });

      // Add auth interceptor
      instance.interceptors.request.use(config => {
        if (this.accessToken) {
          config.headers.Authorization = `Bearer ${this.accessToken}`;
        }
        return config;
      });

      // Add response interceptor for token refresh
      instance.interceptors.response.use(
        response => response,
        async error => {
          if (error.response?.status === 401 && this.refreshToken) {
            try {
              await this.refreshAccessToken();
              // Retry original request
              const originalRequest = error.config;
              originalRequest.headers.Authorization = `Bearer ${this.accessToken}`;
              return instance(originalRequest);
            } catch (refreshError) {
              await this.logout();
              throw refreshError;
            }
          }
          throw error;
        }
      );

      return instance;
    },

    // Auth methods
    async authenticate(code: string, codeVerifier: string): Promise<void> {
      this.loading.auth = true;
      this.errors.auth = null;

      try {
        const instance = this.getAxiosInstance();
        const response = await instance.post('/api/token', {
          code,
          codeVerifier,
        });

        const tokens: AuthTokens = response.data;
        this.accessToken = tokens.access_token;
        this.refreshToken = tokens.refresh_token;
        this.tokenExpiry = Date.now() + tokens.expires_in * 1000;

        // Store tokens securely
        await this.storeTokens(tokens);
      } catch (error) {
        this.errors.auth = error instanceof Error ? error.message : 'Authentication failed';
        throw error;
      } finally {
        this.loading.auth = false;
      }
    },

    async refreshAccessToken(): Promise<void> {
      if (!this.refreshToken) throw new Error('No refresh token available');

      try {
        const instance = this.getAxiosInstance();
        const response = await instance.post('/api/token/refresh', {
          refresh_token: this.refreshToken,
        });

        const tokens: AuthTokens = response.data;
        this.accessToken = tokens.access_token;
        this.refreshToken = tokens.refresh_token;
        this.tokenExpiry = Date.now() + tokens.expires_in * 1000;

        await this.storeTokens(tokens);
      } catch (error) {
        await this.logout();
        throw error;
      }
    },

    async logout(): Promise<void> {
      this.accessToken = null;
      this.refreshToken = null;
      this.tokenExpiry = null;
      this.userInfo = null;
      this.cardanoAddress = null;
      this.cardData = null;
      this.cardNumber = null;
      this.cardBalance = null;
      this.cardHistory = null;

      // Clear stored tokens
      await this.clearStoredTokens();
    },

    // User methods
    async fetchUserInfo(): Promise<void> {
      this.loading.userInfo = true;
      this.errors.userInfo = null;

      try {
        const instance = this.getAxiosInstance();
        const response = await instance.get('/api/user');
        this.userInfo = response.data;
      } catch (error) {
        this.errors.userInfo = error instanceof Error ? error.message : 'Failed to fetch user info';
        throw error;
      } finally {
        this.loading.userInfo = false;
      }
    },

    async fetchCardanoAddress(): Promise<void> {
      this.loading.cardanoAddress = true;
      this.errors.cardanoAddress = null;

      try {
        const instance = this.getAxiosInstance();
        const response = await instance.get('/api/cardano-address');
        this.cardanoAddress = response.data;
      } catch (error) {
        this.errors.cardanoAddress = error instanceof Error ? error.message : 'Failed to fetch Cardano address';
        throw error;
      } finally {
        this.loading.cardanoAddress = false;
      }
    },

    // Card methods
    async fetchCardData(): Promise<void> {
      this.loading.cardData = true;
      this.errors.cardData = null;

      try {
        const instance = this.getAxiosInstance();
        const response = await instance.get('/api/card');
        this.cardData = response.data;
      } catch (error) {
        this.errors.cardData = error instanceof Error ? error.message : 'Failed to fetch card data';
        throw error;
      } finally {
        this.loading.cardData = false;
      }
    },

    async fetchCardNumber(): Promise<void> {
      this.loading.cardNumber = true;
      this.errors.cardNumber = null;

      try {
        const instance = this.getAxiosInstance();
        const response = await instance.get('/api/card/number');
        this.cardNumber = response.data;
      } catch (error) {
        this.errors.cardNumber = error instanceof Error ? error.message : 'Failed to fetch card number';
        throw error;
      } finally {
        this.loading.cardNumber = false;
      }
    },

    async fetchCardBalance(): Promise<void> {
      this.loading.cardBalance = true;
      this.errors.cardBalance = null;

      try {
        const instance = this.getAxiosInstance();
        const response = await instance.get('/api/card/balance');
        this.cardBalance = response.data;
      } catch (error) {
        this.errors.cardBalance = error instanceof Error ? error.message : 'Failed to fetch card balance';
        throw error;
      } finally {
        this.loading.cardBalance = false;
      }
    },

    async fetchCardHistory(params: HistoryParams = {}): Promise<void> {
      this.loading.cardHistory = true;
      this.errors.cardHistory = null;

      try {
        const instance = this.getAxiosInstance();
        const queryParams = new URLSearchParams();

        if (params.periodFrom) queryParams.append('periodFrom', params.periodFrom);
        if (params.periodTo) queryParams.append('periodTo', params.periodTo);
        if (params.page) queryParams.append('page', params.page.toString());
        if (params.size) queryParams.append('size', params.size.toString());

        const url = `/api/card/history${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
        const response = await instance.get(url);
        this.cardHistory = response.data;
      } catch (error) {
        this.errors.cardHistory = error instanceof Error ? error.message : 'Failed to fetch card history';
        throw error;
      } finally {
        this.loading.cardHistory = false;
      }
    },

    // Utility methods for token storage
    async storeTokens(tokens: AuthTokens): Promise<void> {
      // Store tokens securely (implement based on your security requirements)
      // This could be in encrypted localStorage, chrome.storage, etc.
      if (typeof chrome !== 'undefined' && chrome.storage) {
        await chrome.storage.local.set({
          kaiserex_access_token: tokens.access_token,
          kaiserex_refresh_token: tokens.refresh_token,
          kaiserex_token_expiry: Date.now() + tokens.expires_in * 1000,
        });
      }
    },

    async loadStoredTokens(): Promise<void> {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        const result = await chrome.storage.local.get([
          'kaiserex_access_token',
          'kaiserex_refresh_token',
          'kaiserex_token_expiry',
        ]);

        if (result['kaiserex_access_token'] && result['kaiserex_token_expiry']) {
          this.accessToken = result['kaiserex_access_token'];
          this.refreshToken = result['kaiserex_refresh_token'];
          this.tokenExpiry = result['kaiserex_token_expiry'];
        }
      }
    },

    async clearStoredTokens(): Promise<void> {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        await chrome.storage.local.remove(['kaiserex_access_token', 'kaiserex_refresh_token', 'kaiserex_token_expiry']);
      }
    },

    // Initialize store
    async initialize(): Promise<void> {
      await this.loadStoredTokens();

      if (this.isAuthenticated) {
        try {
          // Preload essential data
          await Promise.all([
            this.fetchUserInfo(),
            this.fetchCardanoAddress(),
            this.fetchCardData(),
            this.fetchCardBalance(),
          ]);
        } catch (error) {
          console.error('Failed to initialize card store:', error);
        }
      }
    },
  },
});
