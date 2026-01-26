import Vue from 'vue';
import type { AuthTokens, HistoryParams, CardState, CardTransactionHistory, CardInfo, PaginatedCardsResponse } from '@/models/card';
import type { KaiserExTokenData } from '@/services/kaiserEx.service';
import type { Activity } from '@/models/types';
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
  // Auth
  accessToken: null,
  refreshToken: null,
  tokenExpiry: null,

  // User data
  userInfo: null,
  cardanoAddress: null,

  // Multiple cards support
  cards: [],
  selectedCardId: null,
  exchangeRate: null,

  // Wallet status integration - EVERYTHING IN ONE STORE!
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

/**
 * Initialize card store with split storage model:
 *
 * COOKIES (chrome.cookies API):
 * - accessToken: Sensitive auth token
 * - refreshToken: Token refresh credential
 * - tokenExpiry: Token expiration timestamp
 *
 * CHROME STORAGE (chrome.storage.local):
 * - All other card state (user info, cards, balances, etc.)
 * - Tokens are explicitly excluded from chrome.storage for better security
 *
 * Why split storage?
 * - Cookies provide better security boundaries (domain isolation, auto-expiry)
 * - Chrome storage provides larger storage capacity for card data
 * - Tokens don't need to be serialized with other state
 */
async function initCardStore() {
  try {
    // Load tokens from cookies (secure storage)
    cardStore.accessToken = await getTokenFromCookie('kaiserex_access_token');
    cardStore.refreshToken = await getTokenFromCookie('kaiserex_refresh_token');
    const expiryValue = await getTokenFromCookie('kaiserex_token_expiry');
    cardStore.tokenExpiry = expiryValue ? parseInt(expiryValue, 10) : null;

    // Load other state from chrome.storage.local (promisified to avoid race conditions)
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
          console.log('🔒 Wallet locked - logging out from card');
          try {
            await cardStoreInstance.logout();
          } catch (error) {
            console.error('Failed to logout from card during wallet lock:', error);
          }
        }
      });
    }
  } catch (error) {
    console.error('Failed to initialize card store:', error);
  }
}
initCardStore();

/**
 * Persist card store data to chrome.storage.local
 *
 * IMPORTANT: Tokens are NOT persisted here!
 * - accessToken, refreshToken, tokenExpiry are stored in cookies
 * - They are explicitly deleted before saving to chrome.storage
 * - This ensures tokens have proper security boundaries and auto-expiry
 */

/**
 * Helper to retrieve authentication tokens from cookies
 *
 * Returns null on failure to allow graceful fallback.
 * Used for lazy-loading tokens when not available in memory.
 */
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
    console.error(`Failed to get cookie ${name}:`, error);
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
        console.error('Failed to add auth token to request:', error);
        return config;
      }
    },
    error => {
      console.error('Request interceptor error:', error);
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
          console.warn('Token refresh failed, clearing session');
        //  await cardStoreInstance.logout();
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
            console.warn('Token refresh failed, clearing session');
        //    await cardStoreInstance.logout();
            throw refreshError;
          }
        } else {
          // No refresh token available - session is invalid, clear everything
          console.warn('No refresh token available, clearing session');
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

/**
 * Internal card store instance for token management
 *
 * Handles token refresh and logout with proper cookie cleanup
 */
const cardStoreInstance = {
  /**
   * Refresh access token using refresh token
   *
   * If refresh fails (e.g., refresh token expired or invalid), automatically
   * logs out user and clears all cookies
   */
  async refreshAccessToken(): Promise<void> {
    if (!cardStore.refreshToken) {
      console.warn('No refresh token available for refresh');
    //  await this.logout();
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
      // Refresh failed - logout and clear cookies
      console.warn('Token refresh failed, logging out');
    //  await this.logout();
      throw error;
    }
  },

  /**
   * Logout user and clear all session data
   *
   * Clears:
   * - Access and refresh tokens from memory
   * - All cookies (via clearStoredTokens)
   * - User data, cards, balances
   * - Calls backend logout endpoint
   *
   * Always succeeds even if backend logout fails
   */
  async logout(): Promise<void> {
    try {
      // Check if user was logged in before attempting backend logout
      const wasLoggedIn = cardStore.accessToken !== null;

      // Clear tokens and user data from memory
      cardStore.accessToken = null;
      cardStore.refreshToken = null;
      cardStore.tokenExpiry = null;
      cardStore.userInfo = null;
      cardStore.cardanoAddress = null;
      cardStore.cards = [];
      cardStore.selectedCardId = null;
      cardStore.exchangeRate = null;
      cardStore.walletStatus.isKaiserexAuthenticated = false;

      // Only call backend logout endpoint if user was logged in
      if (wasLoggedIn) {
        try {
          const api = getCardApi();
          await api.axiosInstance.get('/api/kaiserex/logout');
        } catch (backendError) {
          console.warn('Backend logout failed, continuing with local cleanup:', backendError);
        }
      }

      // Always clear cookies regardless of backend response
      await clearStoredTokens();
    } catch (error) {
      console.error('Failed to logout from card store:', error);
      // Ensure cookies are cleared even if something fails
      await clearStoredTokens();
    }
  },
};

/**
 * Store authentication tokens in secure cookies
 *
 * Uses chrome.cookies API instead of chrome.storage.local for enhanced security:
 * - Domain isolation: Cookies are bound to backend domain
 * - Auto-expiry: Cookies automatically expire based on token lifetime
 * - Secure flag: HTTPS-only transmission
 * - SameSite protection: CSRF protection
 *
 * NOTE: While we can't set httpOnly from client-side, this is still more secure
 * than chrome.storage.local. For full httpOnly protection, backend should set
 * cookies via Set-Cookie headers.
 */
async function storeTokens(tokens: AuthTokens): Promise<void> {
  try {
    if (typeof chrome !== 'undefined' && chrome.cookies) {
      const domain = new URL(import.meta.env['VITE_BACKEND_URL']).hostname;
      const expirationDate = Math.floor(Date.now() / 1000) + tokens.expires_in;

      // Store access token in cookie
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

      // Store refresh token in cookie (longer expiration, e.g., 30 days)
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

      // Store token expiry
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
    console.error('Failed to store tokens in cookies:', error);
    throw new Error('Failed to store authentication tokens');
  }
}

/**
 * Clear all authentication tokens from cookies
 *
 * Called during logout to ensure tokens are properly removed.
 * Does not throw on failure to ensure logout succeeds even if cookie removal fails.
 */
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
    console.error('Failed to clear stored tokens from cookies:', error);
    // Don't throw - we want logout to succeed even if cookie removal fails
  }
}
export default {
  // ============================================================================
  // Multi-Card Helper Methods
  // ============================================================================

  /**
   * Get the currently selected card
   * @returns The selected card or null if none selected
   */
  getSelectedCard(): CardInfo | null {
    if (!cardStore.selectedCardId) return null;
    return cardStore.cards.find(c => c.cardData.card_uuid === cardStore.selectedCardId) || null;
  },

  /**
   * Get a specific card by UUID
   * @param cardId - The card UUID
   * @returns The card or null if not found
   */
  getCard(cardId: string): CardInfo | null {
    return cardStore.cards.find(c => c.cardData.card_uuid === cardId) || null;
  },

  /**
   * Select a card by UUID
   * @param cardId - The card UUID to select
   */
  selectCard(cardId: string | null): void {
    if (cardId === null) {
      // Clear selection (for empty card slot or pending cards)
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

  /**
   * Add or update a card in the cards array
   * @param cardInfo - The card info to add/update
   */
  upsertCard(cardInfo: CardInfo): void {
    const index = cardStore.cards.findIndex(c => c.cardData.card_uuid === cardInfo.cardData.card_uuid);

    if (index >= 0) {
      // Update existing card
      Vue.set(cardStore.cards, index, cardInfo);
    } else {
      // Add new card
      cardStore.cards.push(cardInfo);

      // Auto-select if it's the first card
      if (cardStore.cards.length === 1) {
        cardStore.selectedCardId = cardInfo.cardData.card_uuid;
      }
    }
  },

  /**
   * Remove a card by UUID
   * @param cardId - The card UUID to remove
   */
  removeCard(cardId: string): void {
    const index = cardStore.cards.findIndex(c => c.cardData.card_uuid === cardId);
    if (index >= 0) {
      cardStore.cards.splice(index, 1);

      // If removed card was selected, select first available card
      if (cardStore.selectedCardId === cardId) {
        cardStore.selectedCardId = cardStore.cards.length > 0 ? cardStore.cards[0].cardData.card_uuid : null;
      }
    }
  },

  // ============================================================================
  // Auth Getters
  // ============================================================================

  get isAuthenticated() {
    if (!cardStore.accessToken || !cardStore.tokenExpiry) return false;
    const isValid = Date.now() < cardStore.tokenExpiry;

    // Auto-logout if token expired
    if (!isValid && cardStore.accessToken) {
    //  this.logout();
    }

    return isValid;
  },

  // Card Getters
  get hasCard() {
    const selectedCard = this.getSelectedCard();
    return selectedCard !== null && selectedCard.cardData !== null;
  },

  get hasCardanoAddress() {
    return cardStore.cardanoAddress !== null;
  },

  get formattedBalance() {
    const selectedCard = this.getSelectedCard();
    if (!selectedCard || !selectedCard.cardBalance) return null;
    return {
      amount: selectedCard.cardBalance.currentBalance.amount,
      currency: selectedCard.cardBalance.currentBalance.currencyCode,
      state: selectedCard.cardBalance.state,
    };
  },

  get cardHistoryRecords() {
    const selectedCard = this.getSelectedCard();
    return selectedCard?.cardHistory?.records || [];
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

    // Store tokens in cookies
    await storeTokens({
      token_type: 'Bearer',
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in || 3600,
    });

    // Set authentication status
    await this.setKaiserexAuthentication(true);
  },

  async authenticate(wallet: any, code: string, codeVerifier: string): Promise<void> {
    cardStore.loading.auth = true;
    cardStore.errors.auth = null;

    try {
      const api = getCardApi();
      const response = await api.axiosInstance.post('/api/token', {
        code,
        codeVerifier,
      });
      const tokens: AuthTokens = response.data;
      cardStore.accessToken = tokens.access_token;
      cardStore.refreshToken = tokens.refresh_token;
      cardStore.tokenExpiry = Date.now() + tokens.expires_in * 1000;

      await storeTokens(tokens);
    } catch (error) {
      cardStore.errors.auth =
        error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Authentication failed';
      throw error;
    } finally {
      cardStore.loading.auth = false;
    }
  },

  async refreshAccessToken(): Promise<void> {
    return cardStoreInstance.refreshAccessToken();
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
      const api = getCardApi();
      const response = await api.axiosInstance.get('/api/kaiserex/cardano-address');
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
    cardStore.loading.cardData = true;
    cardStore.errors.cardData = null;

    try {
      const response = await getCardApi().axiosInstance.get<PaginatedCardsResponse>('/api/kaiserex/cards');
      const cardsData = response.data.data || [];

      // Populate cards array with all user's cards
      for (const cardData of cardsData) {
        const existingCard = cardStore.cards.find(c => c.cardData.card_uuid === cardData.card_uuid);

        if (existingCard) {
          // Update existing card's cardData
          existingCard.cardData = cardData;
        } else {
          // Add new card with minimal info (other fields will be populated by other fetch methods)
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
      // Check if it's an axios error with a 500 status code
      if (error?.response?.status >= 500) {
        // Set wallet status to error state for 5xx server errors
        cardStore.walletStatus.currentState = 'error';
        cardStore.walletStatus.error = 'Server error. Please try again later.';
        console.error('Server error (5xx) when fetching card data:', error);
      }

      cardStore.errors.cardData =
        error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Failed to fetch card data';
      throw error;
    } finally {
      cardStore.loading.cardData = false;
    }
  },

  async fetchCardNumber(cardId?: string): Promise<void> {
    // Use provided cardId or selected card
    const targetCardId = cardId || cardStore.selectedCardId;
    if (!targetCardId) {
      return;
    }

    const card = this.getCard(targetCardId);
    if (!card) {
      throw new Error(`Card with ID ${targetCardId} not found`);
    }

    cardStore.loading.cardNumber = true;
    cardStore.errors.cardNumber = null;

    try {
      const api = getCardApi();
      const response = await api.axiosInstance.get(`/api/kaiserex/cards/number/${targetCardId}`);

      // Update the specific card's number
      card.cardNumber = response.data;
    } catch (error) {
      cardStore.errors.cardNumber =
        error && typeof error === 'object' && 'message' in error
          ? String(error.message)
          : 'Failed to fetch card number';
      throw error;
    } finally {
      cardStore.loading.cardNumber = false;
    }
  },

  async fetchCardBalance(cardId?: string): Promise<void> {
    // Use provided cardId or selected card
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

      // Update the specific card's balance
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
    // Use provided cardId or selected card
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

      // Set default period to last 60 days if not provided
      const now = new Date();
      const ninetyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

      // Format dates as dd/mm/yyyy
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

      // Update the specific card's history
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

  // Fetch card history for export without updating store
  async fetchCardHistoryForExport(params: HistoryParams, cardId?: string): Promise<CardTransactionHistory[]> {
    const targetCardId = cardId || cardStore.selectedCardId;
    if (!targetCardId) {
      throw new Error('No card selected');
    }

    try {
      const api = getCardApi();
      const queryParams = new URLSearchParams();

      // Format dates as dd/mm/yyyy
      const formatDate = (dateStr: string): string => {
        // If dateStr is already in dd.mm.yyyy format, return as is
        if (dateStr.includes('.')) {
          return dateStr;
        }
        // Otherwise parse and format
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

      // Return transactions without updating store
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
      const api = getCardApi();
      const response = await api.axiosInstance.get(`/api/kaiserex/cards/order/${orderUuid}/status`);
      return response.data;
    } catch (error) {
      throw error;
    }
  },

  /**
   * Get card state (active/rejected)
   * @param cardUuid - Card UUID to check
   * @returns Card state object with status
   */
  async getCardState(cardUuid: string): Promise<{ status: string } | null> {
    try {
      const api = getCardApi();
      const response = await api.axiosInstance.get(`/api/kaiserex/cards/state/${cardUuid}`);
      return response.data;
    } catch (error) {
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

  async getExchangeRate(): Promise<void> {
    const api = getCardApi();
    const response = await api.axiosInstance.get(`/api/kaiserex/exchange-rate/ADA/EUR`);
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
          console.error('Failed to read tokens from cookies during initialization:', cookieError);
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

  // Top-up methods
  updateCardBalance(additionalAmount: number, cardId?: string): void {
    const targetCardId = cardId || cardStore.selectedCardId;
    if (!targetCardId) return;

    const card = this.getCard(targetCardId);
    if (card && card.cardBalance) {
      card.cardBalance.currentBalance.amount += additionalAmount;
      card.totalDeposits += additionalAmount;
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

  addTopUpTransaction(adaAmount: number, eurAmount: number, transactionId: string, cardId?: string): void {
    const targetCardId = cardId || cardStore.selectedCardId;
    if (!targetCardId) return;

    const card = this.getCard(targetCardId);
    if (!card) return;

    if (!card.cardHistory) {
      card.cardHistory = {
        meta: { page: 1, records: 0, totalRecords: 0 },
        records: [],
      };
    }

    const newTransaction: CardTransactionHistory = {
      reference: transactionId,
      amount: {
        amount: eurAmount,
        currencyCode: 'EUR',
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
        description: 'Financial Institution',
      },
      reversedAmount: {
        amount: 0,
        currencyCode: 'EUR',
      },
      narrative: `ADA to EUR conversion: ${adaAmount} ADA → ${eurAmount} EUR`,
      debit: false, // Credit transaction (adding money)
      state: 'SETTLED',
    };

    // Add to beginning of transactions array
    card.cardHistory.records.unshift(newTransaction);
    card.cardHistory.meta.records += 1;
    card.cardHistory.meta.totalRecords += 1;
  },

  addTopUpActivity(adaAmount: number, eurAmount: number, cardId?: string): void {
    const targetCardId = cardId || cardStore.selectedCardId;
    if (!targetCardId) return;

    const card = this.getCard(targetCardId);
    if (!card) return;

    const newActivity: Activity = {
      id: Date.now(), // Use timestamp as unique ID
      type: 'Top-up',
      cryptoAmount: `₳${adaAmount.toFixed(0)}`,
      fiatAmount: `+€${eurAmount.toFixed(2)}`,
      date: new Date().toLocaleDateString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }),
      status: 'Completed',
    };

    // Add to beginning of activities array
    card.activities.unshift(newActivity);
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

  /**
   * Check payment status for physical card order
   * Placeholder - will be implemented when backend is ready
   * @param _txId - Transaction ID to check - reserved for future use
   * @returns true if payment confirmed, false otherwise
   */
  async checkPaymentStatus(_txId: string): Promise<boolean> {
    // Mock - simulate payment confirmation after delay
    // In production, this will poll the backend to check if payment was received
    await new Promise(resolve => setTimeout(resolve, 5000));
    return true;
  },

  /**
   * Poll for card UUID after order is created
   * Uses /api/kaiserex/cards/order/{order_uuid}/status endpoint
   * @param orderUuid - Order UUID to poll for
   * @param timeoutMs - Maximum time to poll in milliseconds (default: 3600000 = 1 hour)
   * @param intervalMs - Interval between attempts in milliseconds (default: 10000 = 10 seconds)
   * @param onProgress - Optional callback for progress updates (elapsedMs, timeoutMs)
   * @returns Card UUID if found, null if timeout
   */
  async pollForCardUuid(
    orderUuid: string,
    timeoutMs = 3600000, // 1 hour default
    intervalMs = 10000, // 10 seconds
    onProgress?: (elapsedMs: number, timeoutMs: number) => void
  ): Promise<string | null> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      try {
        const elapsedMs = Date.now() - startTime;
        if (onProgress) {
          onProgress(elapsedMs, timeoutMs);
        }

        const orderDetails = await this.getOrderDetails(orderUuid);
        
        if (orderDetails?.card_uuid) {
          return orderDetails.card_uuid;
        }

        // Wait before next attempt
        const remainingTime = timeoutMs - (Date.now() - startTime);
        if (remainingTime > 0) {
          await new Promise(resolve => setTimeout(resolve, Math.min(intervalMs, remainingTime)));
        } else {
          break; // Timeout reached
        }
      } catch (error) {
        // Continue polling even if one request fails
        const remainingTime = timeoutMs - (Date.now() - startTime);
        if (remainingTime > 0) {
          await new Promise(resolve => setTimeout(resolve, Math.min(intervalMs, remainingTime)));
        } else {
          break; // Timeout reached
        }
      }
    }

    return null; // Timeout reached
  },

  // State getter for compatibility
  get state() {
    return cardStore;
  },
};