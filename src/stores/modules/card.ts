import Vue from 'vue';
import type {
  AuthTokens, HistoryParams, CardState, CardTransactionHistory, CardInfo, ExchangeRate, CardData,
} from '@/models/card';
import type { KaiserExTokenData } from '@/services/kaiserEx.service';
import { Api } from '@/api/api';
import { Provider } from '@/models/types';
import { walletStore } from '@/stores/walletStore';

export interface OrderPhysicalCardPayload {
  address: string;
  region: string;
  city: string;
  zipCode: string;
  countryCode: string;
  phone: string;
  deliveryMethod: string;
}

export const cardStore = Vue.observable<CardState>({
  accessToken: null,
  refreshToken: null,
  tokenExpiry: null,
  userInfo: null,
  cardanoAddress: null,
  cards: [],
  selectedCardId: null,
  currentCardIndex: 0,
  exchangeRate: null,
  walletStatus: {
    currentState: 'loading' as 'loading' | 'auth' | 'new' | 'pending' | 'approved' | 'error',
    isKaiserexAuthenticated: false,
    kycStatus: 'not_started' as 'approved' | 'rejected' | 'verified' | 'registered' | 'verification_started',
    kycData: null as any,
    loadingMessage: '',
    error: null as string | null,
  },

  // Loading states
  loading: {
    userInfo: false,
    cardanoAddress: false,
    cardData: false,
    cardNumber: false,
    cardBalance: false,
    cardHistory: false,
    auth: false,
    initialize: false,
  },

  // Error states
  errors: {
    userInfo: null,
    cardanoAddress: null,
    cardData: null,
    cardDetails: null,
    cardPin: null,
    cardNumber: null,
    cardBalance: null,
    cardHistory: null,
    auth: null,
    initialize: null,
  },
});

async function initCardStore() {
  try {
    // Load tokens from cookies (secure storage)
    cardStore.accessToken = await getTokenFromCookie('kaiserex_access_token');
    cardStore.refreshToken = await getTokenFromCookie('kaiserex_refresh_token');
    const expiryValue = await getTokenFromCookie('kaiserex_token_expiry');
    cardStore.tokenExpiry = expiryValue ? parseInt(expiryValue, 10) : null;

    // Load another state from chrome.storage.local (promisified to avoid race conditions)
    const result = await new Promise<{ cardStore?: Partial<CardState> }>((resolve, reject) => {
      try {
        chrome.storage.local.get('cardStore', res => {
          resolve(res);
        });
      } catch (error) {
        reject(error);
      }
    });

    if (result.cardStore) {
      // Ensure walletStatus exists before assignment
      const storedData = result.cardStore;
      if (!storedData.walletStatus) {
        storedData.walletStatus = {
          currentState: 'loading',
          isKaiserexAuthenticated: false,
          kycStatus: 'registered',
          kycData: null,
          loadingMessage: '',
          error: null,
        };
      }

      // Merge stored state (tokens are loaded from cookies separately)
      Object.assign(cardStore, storedData);
    }

    // Watch for wallet lock state changes via store messaging system
    // This runs in browser context, listening for background context wallet state changes
    if (typeof chrome !== 'undefined') {
      const { storeMessaging } = await import('@/services/storeMessaging.service');

      storeMessaging.subscribe('walletStore', async (updates) => {
        if ('isLocked' in updates && updates['isLocked'] && cardStore.accessToken) {
          try {
            await cardStoreInstance.logout();
          } catch (error) {
            // Silent error handling
          }
        }
      });
    }
  } catch (error) {
    // Silent error handling
  }
}
initCardStore();

async function getTokenFromCookie(name: string): Promise<string | null> {
  try {
    if (typeof chrome !== 'undefined' && chrome.cookies) {
      const cookie = await chrome.cookies.get({
        url: import.meta.env['VITE_BACKEND_URL'],
        name,
      });
      return cookie?.value || null;
    }
    return null;
  } catch (error) {
    return null;
  }
}

// Create API instance for card operations
function getCardApi(): Api {
  const api = new Api(walletStore.loggedWallet, Provider.BLOCKFROST);

  // Enable sending cookies with requests
  api.axiosInstance.defaults.withCredentials = true;

  // Add auth interceptor for card operations
  api.axiosInstance.interceptors.request.use(
    async config => {
      try {
        // Try to get token from memory first, then from cookie
        let token = cardStore.accessToken;
        if (!token) {
          token = await getTokenFromCookie('kaiserex_access_token');
        }

        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      } catch (error) {
        return config;
      }
    },
    error => {
      return Promise.reject(error);
    }
  );

  // Add response interceptor for token refresh and 401 handling
  api.axiosInstance.interceptors.response.use(
    response => response,
    async error => {
      // Handle 401 Unauthorized errors
      if (error.response?.status === 401) {
        const originalRequest = error.config;

        // Prevent infinite retry loops
        if (originalRequest._retry) {
          throw error;
        }

        // If we have a refresh token, try to refresh
        if (cardStore.refreshToken) {
          originalRequest._retry = true;

          try {
            await cardStoreInstance.refreshAccessToken();
            // Retry original request with new token
            originalRequest.headers.Authorization = `Bearer ${cardStore.accessToken}`;
            return api.axiosInstance(originalRequest);
          } catch (refreshError) {
            throw refreshError;
          }
        } else {
          // No refresh token available - session is invalid, clear everything
          await clearStoredTokens();
          cardStore.accessToken = null;
          cardStore.refreshToken = null;
          cardStore.tokenExpiry = null;
          cardStore.walletStatus.isKaiserexAuthenticated = false;
          throw error;
        }
      }

      throw error;
    }
  );

  return api;
}

const cardStoreInstance = {
  async refreshAccessToken(): Promise<void> {
    if (!cardStore.refreshToken) {
      throw new Error('No refresh token available');
    }

    try {
      const api = getCardApi();
      const response = await api.axiosInstance.post('/api/token/refresh', {
        refresh_token: cardStore.refreshToken,
      });

      const tokens: AuthTokens = response.data;
      cardStore.accessToken = tokens.access_token;
      cardStore.refreshToken = tokens.refresh_token;
      cardStore.tokenExpiry = Date.now() + tokens.expires_in * 1000;

      // Update tokens in cookies
      await storeTokens(tokens);
    } catch (error) {
      throw error;
    }
  },

  async logout(): Promise<void> {
    try {
      const wasLoggedIn = cardStore.accessToken !== null;

      cardStore.accessToken = null;
      cardStore.refreshToken = null;
      cardStore.tokenExpiry = null;
      cardStore.userInfo = null;
      cardStore.cardanoAddress = null;
      cardStore.cards = [];
      cardStore.selectedCardId = null;
      cardStore.exchangeRate = null;
      cardStore.walletStatus.isKaiserexAuthenticated = false;

      if (wasLoggedIn) {
        try {
          const api = getCardApi();
          await api.axiosInstance.get('/api/kaiserex/logout');
        } catch (backendError) {
        }
      }

      await clearStoredTokens();
    } catch (error) {
      await clearStoredTokens();
    }
  },
};

async function storeTokens(tokens: AuthTokens): Promise<void> {
  try {
    if (typeof chrome !== 'undefined' && chrome.cookies) {
      const domain = new URL(import.meta.env['VITE_BACKEND_URL']).hostname;
      const expirationDate = Math.floor(Date.now() / 1000) + tokens.expires_in;

      await chrome.cookies.set({
        url: import.meta.env['VITE_BACKEND_URL'],
        name: 'kaiserex_access_token',
        value: tokens.access_token,
        domain: domain,
        path: '/',
        secure: true,
        sameSite: 'lax',
        expirationDate: expirationDate,
      });

      await chrome.cookies.set({
        url: import.meta.env['VITE_BACKEND_URL'],
        name: 'kaiserex_refresh_token',
        value: tokens.refresh_token,
        domain: domain,
        path: '/',
        secure: true,
        sameSite: 'lax',
        expirationDate: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 days
      });

      await chrome.cookies.set({
        url: import.meta.env['VITE_BACKEND_URL'],
        name: 'kaiserex_token_expiry',
        value: (Date.now() + tokens.expires_in * 1000).toString(),
        domain: domain,
        path: '/',
        secure: true,
        sameSite: 'lax',
        expirationDate: expirationDate,
      });
    }
  } catch (error) {
    throw new Error('Failed to store authentication tokens');
  }
}

async function clearStoredTokens(): Promise<void> {
  try {
    await Promise.all([
      chrome.cookies.remove({
        url: import.meta.env['VITE_BACKEND_URL'],
        name: 'kaiserex_access_token',
      }),
      chrome.cookies.remove({
        url: import.meta.env['VITE_BACKEND_URL'],
        name: 'kaiserex_refresh_token',
      }),
      chrome.cookies.remove({
        url: import.meta.env['VITE_BACKEND_URL'],
        name: 'kaiserex_token_expiry',
      }),
    ]);
  } catch (error) {
  }
}
export default {
  // ============================================================================
  // Multi-Card Helper Methods
  // ============================================================================

  getSelectedCard(): CardInfo | null {
    if (!cardStore.selectedCardId) return null;
    return cardStore.cards.find(c => c.cardData.card_uuid === cardStore.selectedCardId) || null;
  },

  getCard(cardId: string): CardInfo | null {
    return cardStore.cards.find(c => c.cardData.card_uuid === cardId) || null;
  },

  selectCard(cardId: string | null): void {
    if (cardId === null) {
      cardStore.selectedCardId = null;
      return;
    }

    const card = cardStore.cards.find(c => c.cardData.card_uuid === cardId);
    if (card) {
      cardStore.selectedCardId = cardId;
    } else {
      throw new Error(`Card with ID ${cardId} not found`);
    }
  },

  setCurrentCardIndex(index: number): void {
    cardStore.currentCardIndex = index;
  },

  upsertCard(cardInfo: CardInfo): void {
    const index = cardStore.cards.findIndex(c => {
      if (c.cardData.card_uuid && cardInfo.cardData.card_uuid && c.cardData.card_uuid === cardInfo.cardData.card_uuid) {
        return true;
      }
      if (c.cardData.order_uuid && cardInfo.cardData.order_uuid && c.cardData.order_uuid === cardInfo.cardData.order_uuid) {
        return true;
      }
      return c.cardData.id && cardInfo.cardData.id && c.cardData.id === cardInfo.cardData.id;
    });

    if (index >= 0) {
      Vue.set(cardStore.cards, index, cardInfo);
    } else {
      cardStore.cards.push(cardInfo);

      if (cardStore.cards.length === 1) {
        cardStore.selectedCardId = cardInfo.cardData.card_uuid;
      }
    }
  },

  // ============================================================================
  // Auth Getters
  // ============================================================================

  get isAuthenticated() {
    if (!cardStore.accessToken || !cardStore.tokenExpiry) return false;
    const isValid = Date.now() < cardStore.tokenExpiry;

    if (!isValid && cardStore.accessToken) {
    }

    return isValid;
  },

  get cardHistoryMeta() {
    const selectedCard = this.getSelectedCard();
    return selectedCard?.cardHistory?.meta || null;
  },

  // Wallet Status Getters - ALL IN ONE STORE!
  get currentState() {
    const { walletStatus } = cardStore;

    if (!walletStatus) {
      return 'loading';
    }

    if (cardStore.loading.initialize) {
      return 'loading';
    }

    if (walletStatus.error) {
      return 'error';
    }

    if (!this.isAuthenticated) {
      return 'auth';
    }
    switch (walletStatus.kycStatus) {
      case 'registered':
        return 'new';
      case 'verification_started':
        return 'pending';
      case 'approved':
        return 'approved';
      case 'verified':
        return 'pending';
      case 'rejected':
        return 'auth';
      default:
        return 'new';
    }
  },

  // Auth methods
  async setKaiserExTokens(tokens: KaiserExTokenData): Promise<void> {
    const store = cardStore;
    store.accessToken = tokens.access_token;
    store.refreshToken = tokens.refresh_token;
    store.tokenExpiry = Date.now() + (tokens.expires_in || 3600) * 1000;

      await storeTokens({
      token_type: 'Bearer',
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in || 3600,
    });

      await this.setKaiserexAuthentication(true);
  },

  async logout(): Promise<void> {
    return cardStoreInstance.logout();
  },

  // User methods
  async fetchUserInfo(): Promise<void> {
    cardStore.loading.userInfo = true;
    cardStore.errors.userInfo = null;
    try {
      const api = getCardApi();
      const response = await api.axiosInstance.get('/api/kaiserex/user');
      cardStore.userInfo = response.data;
    } catch (error) {
      cardStore.errors.userInfo =
        error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Failed to fetch user info';
      throw error;
    } finally {
      cardStore.loading.userInfo = false;
    }
  },

  async fetchCardanoAddress(): Promise<void> {
    cardStore.loading.cardanoAddress = true;
    cardStore.errors.cardanoAddress = null;

    try {
      const response = await getCardApi().axiosInstance.get('/api/kaiserex/cardano-address');
      cardStore.cardanoAddress = response.data;
    } catch (error) {
      cardStore.errors.cardanoAddress =
        error && typeof error === 'object' && 'message' in error
          ? String(error.message)
          : 'Failed to fetch Cardano address';
      throw error;
    } finally {
      cardStore.loading.cardanoAddress = false;
    }
  },

  // Card methods
  async fetchCardData(): Promise<void> {
    console.log('Fetching card data');
    cardStore.loading.cardData = true;
    cardStore.errors.cardData = null;

    try {
      const response = await getCardApi().axiosInstance.get<CardData[]>('/api/kaiserex/cards');
      const cardsData = response.data || [];
      console.log('Fetched card data', cardsData);

      for (const cardData of cardsData) {
        const existingCard = cardStore.cards.find(c => {
          if (c.cardData.card_uuid && cardData.card_uuid && c.cardData.card_uuid === cardData.card_uuid) {
            return true;
          }
          if (c.cardData.order_uuid && cardData.order_uuid && c.cardData.order_uuid === cardData.order_uuid) {
            return true;
          }
          return c.cardData.id && cardData.id && c.cardData.id === cardData.id;
        });
        if (existingCard) {
          existingCard.cardData = cardData;
        } else {
          const newCard: CardInfo = {
            cardData,
            cardDetails: null,
            cardPin: null,
            cardNumber: null,
            cardBalance: null,
            cardHistory: null,
            totalDeposits: 0,
            activities: [],
          };
          this.upsertCard(newCard);
        }
      }
    } catch (error: any) {
      if (error?.response?.status >= 500) {
        cardStore.walletStatus.currentState = 'error';
        cardStore.walletStatus.error = 'Server error. Please try again later.';
      }

      cardStore.errors.cardData =
        error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Failed to fetch card data';
      throw error;
    } finally {
      cardStore.loading.cardData = false;
    }
  },

  async fetchCardBalance(cardId?: string): Promise<void> {
    const targetCardId = cardId || cardStore.selectedCardId;
    if (!targetCardId) {
      return;
    }

    const card = this.getCard(targetCardId);
    if (!card) {
      throw new Error(`Card with ID ${targetCardId} not found`);
    }

    cardStore.loading.cardBalance = true;
    cardStore.errors.cardBalance = null;

    try {
      const api = getCardApi();
      const response = await api.axiosInstance.get(`/api/kaiserex/cards/balance/${targetCardId}`);

      card.cardBalance = response.data;
    } catch (error) {
      cardStore.errors.cardBalance =
        error && typeof error === 'object' && 'message' in error
          ? String(error.message)
          : 'Failed to fetch card balance';
      throw error;
    } finally {
      cardStore.loading.cardBalance = false;
    }
  },

  async fetchUserKYCStatus(): Promise<void> {
    try {
      const api = getCardApi();
      const response = await api.axiosInstance.get(`/api/kaiserex/user-verifications`);
      cardStore.walletStatus.kycStatus = response.data.status.name;
    } catch (error) {
      cardStore.walletStatus.kycStatus = 'registered';
      throw error;
    } finally {
    }
  },

  async fetchCardHistory(params: HistoryParams = {}, cardId?: string): Promise<void> {
    const targetCardId = cardId || cardStore.selectedCardId;
    if (!targetCardId) {
      return;
    }

    const card = this.getCard(targetCardId);
    if (!card) {
      throw new Error(`Card with ID ${targetCardId} not found`);
    }

    cardStore.loading.cardHistory = true;
    cardStore.errors.cardHistory = null;

    try {
      const api = getCardApi();
      const queryParams = new URLSearchParams();

      const now = new Date();
      const ninetyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

      const formatDate = (date: Date): string => {
        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const year = date.getFullYear();
        return `${day}.${month}.${year}`;
      };

      const periodFrom = params.periodFrom || formatDate(ninetyDaysAgo);
      const periodTo = params.periodTo || formatDate(now);

      queryParams.append('periodFrom', periodFrom);
      queryParams.append('periodTo', periodTo);
      if (params.page) queryParams.append('page', params.page.toString());
      if (params.size) queryParams.append('size', params.size.toString());

      const url = `/api/kaiserex/cards/history/${targetCardId}${
        queryParams.toString() ? `?${queryParams.toString()}` : ''
      }`;
      const response = await api.axiosInstance.get(url);

      card.cardHistory = response.data;
    } catch (error) {
      cardStore.errors.cardHistory =
        error && typeof error === 'object' && 'message' in error
          ? String(error.message)
          : 'Failed to fetch card history';
      throw error;
    } finally {
      cardStore.loading.cardHistory = false;
    }
  },

  async fetchCardHistoryForExport(params: HistoryParams, cardId?: string): Promise<CardTransactionHistory[]> {
    const targetCardId = cardId || cardStore.selectedCardId;
    if (!targetCardId) {
      throw new Error('No card selected');
    }

    try {
      const api = getCardApi();
      const queryParams = new URLSearchParams();

      const formatDate = (dateStr: string): string => {
        if (dateStr.includes('.')) {
          return dateStr;
        }
        const date = new Date(dateStr);
        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const year = date.getFullYear();
        return `${day}.${month}.${year}`;
      };

      const periodFrom = params.periodFrom ? formatDate(params.periodFrom) : '';
      const periodTo = params.periodTo ? formatDate(params.periodTo) : '';

      if (!periodFrom || !periodTo) {
        throw new Error('Period from and to are required');
      }

      queryParams.append('periodFrom', periodFrom);
      queryParams.append('periodTo', periodTo);
      if (params.page) queryParams.append('page', params.page.toString());
      if (params.size) queryParams.append('size', params.size.toString());

      const url = `/api/kaiserex/cards/history/${targetCardId}?${queryParams.toString()}`;
      const response = await api.axiosInstance.get(url);

      return response.data?.records || [];
    } catch (error) {
      throw error;
    }
  },

  async fetchKYCLink(): Promise<any> {
    try {
      const api = getCardApi();
      const response = await api.axiosInstance.get('/api/kaiserex/verification-link');

      if (response.data && response.data.url) {
        window.open(response.data.url, '_blank');
        return { success: true, url: response.data.url, id: response.data.id };
      }

      return response.data;
    } catch (error) {
      throw error;
    }
  },

  async orderCard(): Promise<any> {
    try {
      const api = getCardApi();
      const response = await api.axiosInstance.post('/api/kaiserex/cards/order');
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  async orderPhysicalCard(payload: OrderPhysicalCardPayload): Promise<any> {
    try {
      const api = getCardApi();
      const response = await api.axiosInstance.post('/api/kaiserex/cards/order/physical', payload);
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  async getOrderDetails(orderUuid: string): Promise<any> {
    try {
      const response = await getCardApi().axiosInstance.get(`/api/kaiserex/cards/order/${orderUuid}/status`);
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  async getDeliveryPayment(orderUuid: string): Promise<{
    payment_id?: string;
    deposit_address?: string;
    amount_eur?: number;
    amount_ada?: number;
    exchange_rate?: number;
    expires_at?: string;
    status?: string;
    qr_code_data?: string;
  } | null> {
    try {
      const api = getCardApi();
      const response = await api.axiosInstance.get(`/api/kaiserex/cards/delivery-payment/${orderUuid}`);
      return response.data || null;
    } catch (error: any) {
      if (error?.response?.status === 410) {
        const errorData = error?.response?.data;
        return {
          status: 'expired',
          expires_at: errorData?.expires_at || undefined,
        };
      }
      if (error?.response?.status === 404) {
        return {
          status: 'rejected',
        };
      }
      return null;
    }
  },

  // Wallet Status Methods - SIMPLE!
  async setKaiserexAuthentication(isAuthenticated: boolean): Promise<void> {
    cardStore.walletStatus.isKaiserexAuthenticated = isAuthenticated;
    if (isAuthenticated) {
      await this.initialize();
    }
  },

  async getExchangeRate(): Promise<ExchangeRate> {
    const response = await getCardApi().axiosInstance.get(`/api/kaiserex/exchange-rate/ADA/EUR`);
    cardStore.exchangeRate = response.data;
    return response.data;
  },

  setError(message: string): void {
    cardStore.walletStatus.error = message;
  },

  clearError(): void {
    cardStore.walletStatus.error = null;
  },

  // Initialize store
  async initialize(): Promise<void> {
    cardStore.loading.initialize = true;
    cardStore.errors.initialize = null;

    try {
      // Read tokens from cookies
      if (typeof chrome !== 'undefined' && chrome.cookies) {
        try {
          const url = import.meta.env['VITE_BACKEND_URL'];
          const [accessTokenCookie, refreshTokenCookie, tokenExpiryCookie] = await Promise.all([
            chrome.cookies.get({ url, name: 'kaiserex_access_token' }),
            chrome.cookies.get({ url, name: 'kaiserex_refresh_token' }),
            chrome.cookies.get({ url, name: 'kaiserex_token_expiry' }),
          ]);

          if (accessTokenCookie?.value && tokenExpiryCookie?.value) {
            cardStore.accessToken = accessTokenCookie.value;
            cardStore.refreshToken = refreshTokenCookie?.value || null;
            cardStore.tokenExpiry = parseInt(tokenExpiryCookie.value, 10);
            cardStore.walletStatus.isKaiserexAuthenticated = true;
          }
        } catch (cookieError) {
          // Continue initialization even if cookie reading fails
        }
      }

      if (this.isAuthenticated && walletStore.loggedWallet) {
        try {
          await Promise.all([
            this.fetchUserInfo(),
            this.fetchUserKYCStatus(),
            this.fetchCardanoAddress(),
            this.fetchCardData(),
            this.getExchangeRate(),
          ]);
        } catch (error) {
          cardStore.errors.initialize = 'Failed to load card data';
        }
      }
    } catch (error) {
      cardStore.errors.initialize = 'Failed to initialize';
    } finally {
      try {
        cardStore.loading.initialize = false;
      } catch (persistError) {
        cardStore.loading.initialize = false;
      }
    }
  },

  async fetchCardPin(cardUuid: string): Promise<void> {
    const card = this.getCard(cardUuid);
    if (!card) {
      throw new Error(`Card with ID ${cardUuid} not found`);
    }

    const api = getCardApi();
    const response = await api.axiosInstance.get(`/api/kaiserex/cards/pin/${cardUuid}`);
    card.cardPin = response.data;
    return response.data;
  },

  async fetchCardDetails(cardUuid: string): Promise<void> {
    const card = this.getCard(cardUuid);
    if (!card) {
      throw new Error(`Card with ID ${cardUuid} not found`);
    }

    const api = getCardApi();
    const response = await api.axiosInstance.get(`/api/kaiserex/cards/details/${cardUuid}`);
    card.cardDetails = response.data;
    return response.data;
  },

  async blockCard(cardId?: string): Promise<void> {
    const targetCardId = cardId || cardStore.selectedCardId;
    if (!targetCardId) return;

    try {
      const api = getCardApi();
      await api.axiosInstance.patch(`/api/kaiserex/cards/${targetCardId}/block`);
      await this.fetchCardData();
    } catch (error) {
      throw error;
    }
  },

  async unblockCard(cardId?: string): Promise<void> {
    const targetCardId = cardId || cardStore.selectedCardId;
    if (!targetCardId) return;

    try {
      const api = getCardApi();
      await api.axiosInstance.patch(`/api/kaiserex/cards/${targetCardId}/unblock`);
      await this.fetchCardData();
    } catch (error) {
      throw error;
    }
  },

  // State getter for compatibility
  get state() {
    return cardStore;
  },
};
