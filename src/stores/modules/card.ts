import Vue from 'vue';
import type { AuthTokens, HistoryParams, CardState, CardTransactionHistory, CardInfo } from '@/models/card';
import type { KaiserExTokenData } from '@/services/kaiserEx.service';
import type { Activity } from '@/models/types';
import { Api } from '@/api/api';
import { Provider } from '@/models/types';
import { walletStore } from '@/stores/walletStore';

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
    kycStatus: 'not_started' as 'unverified' | 'pending' | 'approved' | 'rejected',
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

// Load stored data from chrome storage
chrome.storage.local.get('cardStore', res => {
  if (res['cardStore']) {
    // Ensure walletStatus exists before assignment
    const storedData = res['cardStore'];
    if (!storedData.walletStatus) {
      storedData.walletStatus = {
        currentState: 'loading',
        isKaiserexAuthenticated: false,
        kycStatus: 'not_started',
        kycData: null,
        loadingMessage: '',
        error: null,
      };
    }
    Object.assign(cardStore, storedData);
  }
});

// Persist data to chrome storage
function persist(patch: Partial<CardState>) {
  const next = { ...cardStore, ...patch };
  chrome.storage.local.set({ cardStore: next });
}

// Create API instance for card operations
function getCardApi(): Api {
  const api = new Api(walletStore.loggedWallet, Provider.BLOCKFROST);

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
          await cardStoreInstance.refreshAccessToken();
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
  async refreshAccessToken(): Promise<void> {
    if (!cardStore.refreshToken) throw new Error('No refresh token available');

    try {
      const api = getCardApi();
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
      await cardStoreInstance.logout();
      throw error;
    }
  },

  async logout(): Promise<void> {
    cardStore.accessToken = null;
    cardStore.refreshToken = null;
    cardStore.tokenExpiry = null;
    cardStore.userInfo = null;
    cardStore.cardanoAddress = null;
    cardStore.cards = [];  // NEW: Clear all cards
    cardStore.selectedCardId = null;  // NEW
    cardStore.exchangeRate = null;

    persist({
      accessToken: cardStore.accessToken,
      refreshToken: cardStore.refreshToken,
      tokenExpiry: cardStore.tokenExpiry,
      userInfo: cardStore.userInfo,
      cardanoAddress: cardStore.cardanoAddress,
      cards: cardStore.cards,
      selectedCardId: cardStore.selectedCardId,
      exchangeRate: cardStore.exchangeRate,
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
  selectCard(cardId: string): void {
    const card = cardStore.cards.find(c => c.cardData.card_uuid === cardId);
    if (card) {
      cardStore.selectedCardId = cardId;
      persist({ selectedCardId: cardId });
    } else {
      throw new Error(`Card with ID ${cardId} not found`);
    }
  },

  /**
   * Add or update a card in the cards array
   * @param cardInfo - The card info to add/update
   */
  upsertCard(cardInfo: CardInfo): void {
    const index = cardStore.cards.findIndex(
      c => c.cardData.card_uuid === cardInfo.cardData.card_uuid
    );

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

    persist({ cards: cardStore.cards, selectedCardId: cardStore.selectedCardId });
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
        cardStore.selectedCardId = cardStore.cards.length > 0
          ? cardStore.cards[0].cardData.card_uuid
          : null;
      }

      persist({ cards: cardStore.cards, selectedCardId: cardStore.selectedCardId });
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
      this.logout();
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

    const selectedCard = this.getSelectedCard();

    switch (walletStatus.kycStatus) {
      case 'unverified':
        return 'new';
      case 'pending':
        return 'pending';
      case 'registered':
        return 'pending';
      case 'approved':
        if (selectedCard?.cardData?.card_uuid) {
          return 'approved';
        } else if (selectedCard?.cardData?.id && !selectedCard?.cardData?.card_uuid) {
          return 'pending';
        } else {
          return 'new';
        }
      case 'rejected':
        return 'auth';
      default:
        return 'new';
    }
  },

  get showAuthPage() {
    return this.currentState === 'auth';
  },

  get showNewUserFlow() {
    return this.currentState === 'new';
  },

  get showPendingKYC() {
    return this.currentState === 'pending';
  },

  get showApprovedHome() {
    return this.currentState === 'approved';
  },

  get showLoadingState() {
    return this.currentState === 'loading';
  },

  get showErrorState() {
    return this.currentState === 'error';
  },

  // Auth methods
  async setKaiserExTokens(tokens: KaiserExTokenData): Promise<void> {
    const store = cardStore;
    store.accessToken = tokens.access_token;
    store.refreshToken = tokens.refresh_token;
    store.tokenExpiry = Date.now() + (tokens.expires_in || 3600) * 1000;

    // Also store in chrome storage for persistence
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({
        kaiserex_access_token: tokens.access_token,
        kaiserex_refresh_token: tokens.refresh_token,
        kaiserex_token_expiry: store.tokenExpiry,
      });
    }
    console.log('setKaiserExTokens', tokens);
    // Set authentication status
    await this.setKaiserexAuthentication(true);

    persist({
      accessToken: store.accessToken,
      refreshToken: store.refreshToken,
      tokenExpiry: store.tokenExpiry,
    });
  },

  async authenticate(wallet: any, code: string, codeVerifier: string): Promise<void> {
    cardStore.loading.auth = true;
    cardStore.errors.auth = null;
    persist({ loading: cardStore.loading, errors: cardStore.errors });

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

      persist({
        accessToken: cardStore.accessToken,
        refreshToken: cardStore.refreshToken,
        tokenExpiry: cardStore.tokenExpiry,
      });

      await storeTokens(tokens);
    } catch (error) {
      cardStore.errors.auth =
        error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Authentication failed';
      persist({ errors: cardStore.errors });
      throw error;
    } finally {
      cardStore.loading.auth = false;
      persist({ loading: cardStore.loading });
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
    persist({ loading: cardStore.loading, errors: cardStore.errors });
    try {
      const api = getCardApi();
      const response = await api.axiosInstance.get('/api/kaiserex/user');
      cardStore.userInfo = response.data;
      persist({ userInfo: cardStore.userInfo });
    } catch (error) {
      cardStore.errors.userInfo =
        error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Failed to fetch user info';
      persist({ errors: cardStore.errors });
      throw error;
    } finally {
      cardStore.loading.userInfo = false;
      persist({ loading: cardStore.loading });
    }
  },

  async fetchCardanoAddress(): Promise<void> {
    cardStore.loading.cardanoAddress = true;
    cardStore.errors.cardanoAddress = null;
    persist({ loading: cardStore.loading, errors: cardStore.errors });

    try {
      const api = getCardApi();
      const response = await api.axiosInstance.get('/api/kaiserex/cardano-address');
      cardStore.cardanoAddress = response.data;
      persist({ cardanoAddress: cardStore.cardanoAddress });
    } catch (error) {
      cardStore.errors.cardanoAddress =
        error && typeof error === 'object' && 'message' in error
          ? String(error.message)
          : 'Failed to fetch Cardano address';
      persist({ errors: cardStore.errors });
      throw error;
    } finally {
      cardStore.loading.cardanoAddress = false;
      persist({ loading: cardStore.loading });
    }
  },

  // Card methods
  async fetchCardData(): Promise<void> {
    cardStore.loading.cardData = true;
    cardStore.errors.cardData = null;
    persist({ loading: cardStore.loading, errors: cardStore.errors });

    try {
      const api = getCardApi();
      const response = await api.axiosInstance.get('/api/kaiserex/cards');
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

      persist({ cards: cardStore.cards, selectedCardId: cardStore.selectedCardId });
    } catch (error) {
      cardStore.errors.cardData =
        error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Failed to fetch card data';
      persist({ errors: cardStore.errors });
      throw error;
    } finally {
      cardStore.loading.cardData = false;
      persist({ loading: cardStore.loading });
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
    persist({ loading: cardStore.loading, errors: cardStore.errors });

    try {
      const api = getCardApi();
      const response = await api.axiosInstance.get(`/api/kaiserex/cards/number/${targetCardId}`);

      // Update the specific card's number
      card.cardNumber = response.data;
      persist({ cards: cardStore.cards });
    } catch (error) {
      cardStore.errors.cardNumber =
        error && typeof error === 'object' && 'message' in error
          ? String(error.message)
          : 'Failed to fetch card number';
      persist({ errors: cardStore.errors });
      throw error;
    } finally {
      cardStore.loading.cardNumber = false;
      persist({ loading: cardStore.loading });
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
    persist({ loading: cardStore.loading, errors: cardStore.errors });

    try {
      const api = getCardApi();
      const response = await api.axiosInstance.get(`/api/kaiserex/cards/balance/${targetCardId}`);

      // Update the specific card's balance
      card.cardBalance = response.data;
      persist({ cards: cardStore.cards });
    } catch (error) {
      cardStore.errors.cardBalance =
        error && typeof error === 'object' && 'message' in error
          ? String(error.message)
          : 'Failed to fetch card balance';
      persist({ errors: cardStore.errors });
      throw error;
    } finally {
      cardStore.loading.cardBalance = false;
      persist({ loading: cardStore.loading });
    }
  },

  async fetchUserKYCStatus(): Promise<void> {
    persist({ loading: cardStore.loading, errors: cardStore.errors });
    try {
      const api = getCardApi();
      const response = await api.axiosInstance.get(`/api/kaiserex/user-verifications`);
      cardStore.walletStatus.kycStatus = response.data.status.name;
      //cardStore.walletStatus.kycStatus = 'approved';
      persist({ walletStatus: cardStore.walletStatus });
    } catch (error) {
      cardStore.walletStatus.kycStatus = 'unverified';
      persist({ walletStatus: cardStore.walletStatus });
      persist({ errors: cardStore.errors });
      throw error;
    } finally {
      persist({ loading: cardStore.loading });
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
    persist({ loading: cardStore.loading, errors: cardStore.errors });

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
      persist({ cards: cardStore.cards });
    } catch (error) {
      cardStore.errors.cardHistory =
        error && typeof error === 'object' && 'message' in error
          ? String(error.message)
          : 'Failed to fetch card history';
      persist({ errors: cardStore.errors });
      throw error;
    } finally {
      cardStore.loading.cardHistory = false;
      persist({ loading: cardStore.loading });
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

  // Wallet Status Methods - SIMPLE!
  async setKaiserexAuthentication(isAuthenticated: boolean): Promise<void> {
    cardStore.walletStatus.isKaiserexAuthenticated = isAuthenticated;
    console.log('setKaiserexAuthentication', isAuthenticated);
    if (isAuthenticated) {
      localStorage.setItem('kaiserexRegistered', 'true');
      await this.initialize();
    } else {
      localStorage.removeItem('kaiserexRegistered');
    }
    persist({ walletStatus: cardStore.walletStatus });
  },

  async getExchangeRate(): Promise<void> {
    const api = getCardApi();
    const response = await api.axiosInstance.get(`/api/kaiserex/exchange-rate/ADA/EUR`);
    cardStore.exchangeRate = response.data;
    persist({ exchangeRate: cardStore.exchangeRate });
    return response.data;
  },

  setError(message: string): void {
    cardStore.walletStatus.error = message;
    persist({ walletStatus: cardStore.walletStatus });
  },

  clearError(): void {
    cardStore.walletStatus.error = null;
    persist({ walletStatus: cardStore.walletStatus });
  },

  // Initialize store
  async initialize(): Promise<void> {
    cardStore.loading.initialize = true;
    cardStore.errors.initialize = null;

    try {
      const kaiserexAuth = localStorage.getItem('kaiserexRegistered') === 'true';
      cardStore.walletStatus.isKaiserexAuthenticated = kaiserexAuth;

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
        persist({
          loading: cardStore.loading,
          errors: cardStore.errors,
          walletStatus: cardStore.walletStatus,
        });
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
      persist({ cards: cardStore.cards });
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
    persist({ cards: cardStore.cards });
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
    persist({ cards: cardStore.cards });
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

    persist({ cards: cardStore.cards });
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
    persist({ cards: cardStore.cards });
  },

  async blockCard(cardId?: string): Promise<void> {
    const targetCardId = cardId || cardStore.selectedCardId;
    if (!targetCardId) return;

    try {
      const api = getCardApi();
      await api.axiosInstance.post(`/api/kaiserex/cards/${targetCardId}/block`);
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
      await api.axiosInstance.post(`/api/kaiserex/cards/${targetCardId}/unblock`);
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
