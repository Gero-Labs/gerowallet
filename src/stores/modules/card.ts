import Vue from 'vue';
import type {
  AuthTokens,
  HistoryParams,
  CardState,
  CardTransactionHistory,
  OrderCardResponse,
} from '@/models/card';
import type { Activity } from '@/models/types';
import KaiserExApi from '@/api/kaiserex-api';

export const cardStore = Vue.observable<CardState>({
  // Auth
  accessToken: null,
  refreshToken: null,
  tokenExpiry: null,

  // User data
  userInfo: null,
  cardanoAddress: null,
  verificationLink: null,

  // Card data
  cards: null,
  selectedCard: null,
  cardDetails: null,
  cardPin: null,
  cardBalance: null,
  cardHistory: null,
  totalDeposits: 0,
  activities: [],

  // Legacy card data for backward compatibility
  cardData: null,
  cardNumber: null,

  // Loading states
  loading: {
    userInfo: false,
    cardanoAddress: false,
    verificationLink: false,
    cards: false,
    cardDetails: false,
    cardPin: false,
    cardBalance: false,
    cardHistory: false,
    orderCard: false,
    changingPin: false,
    auth: false,
    // Legacy loading states
    cardData: false,
    cardNumber: false,
  },

  // Error states
  errors: {
    userInfo: null,
    cardanoAddress: null,
    verificationLink: null,
    cards: null,
    cardDetails: null,
    cardPin: null,
    cardBalance: null,
    cardHistory: null,
    orderCard: null,
    changingPin: null,
    auth: null,
    // Legacy error states
    cardData: null,
    cardNumber: null,
  },
});

// Load stored data from chrome storage
chrome.storage.local.get('cardStore', res => {
  if (res['cardStore']) {
    Object.assign(cardStore, res['cardStore']);
    // Update API token after loading state
    if (cardStore.accessToken) {
      kaiserExApi.setAccessToken(cardStore.accessToken);
    }
  }
});

// Persist data to chrome storage
function persist(patch: Partial<CardState>) {
  const next = { ...cardStore, ...patch };
  chrome.storage.local.set({ cardStore: next });
  
  // Update API token when access token changes
  if ('accessToken' in patch) {
    if (patch.accessToken) {
      kaiserExApi.setAccessToken(patch.accessToken);
    } else {
      kaiserExApi.clearAccessToken();
    }
  }
}

// Create global KaiserEx API instance
const kaiserExApi = new KaiserExApi();

// Create store instance for internal use
const cardStoreInstance = {
  async refreshAccessToken(): Promise<void> {
    if (!cardStore.refreshToken) throw new Error('No refresh token available');

    try {
      const tokens = await kaiserExApi.refreshAccessToken(cardStore.refreshToken);
      
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
    cardStore.verificationLink = null;
    cardStore.cards = null;
    cardStore.selectedCard = null;
    cardStore.cardDetails = null;
    cardStore.cardPin = null;
    cardStore.cardBalance = null;
    cardStore.cardHistory = null;
    cardStore.totalDeposits = 0;
    cardStore.activities = [];
    // Legacy data
    cardStore.cardData = null;
    cardStore.cardNumber = null;

    persist({
      accessToken: cardStore.accessToken,
      refreshToken: cardStore.refreshToken,
      tokenExpiry: cardStore.tokenExpiry,
      userInfo: cardStore.userInfo,
      cardanoAddress: cardStore.cardanoAddress,
      verificationLink: cardStore.verificationLink,
      cards: cardStore.cards,
      selectedCard: cardStore.selectedCard,
      cardDetails: cardStore.cardDetails,
      cardPin: cardStore.cardPin,
      cardBalance: cardStore.cardBalance,
      cardHistory: cardStore.cardHistory,
      totalDeposits: cardStore.totalDeposits,
      activities: cardStore.activities,
      // Legacy data
      cardData: cardStore.cardData,
      cardNumber: cardStore.cardNumber,
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
    return cardStore.cards !== null && cardStore.cards.length > 0;
  },

  get selectedCard() {
    return cardStore.selectedCard;
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
    return cardStore.cardHistory?.records || [];
  },

  get cardHistoryMeta() {
    return cardStore.cardHistory?.meta || null;
  },

  // Auth methods
  async authenticate(code: string, codeVerifier: string): Promise<void> {
    cardStore.loading.auth = true;
    cardStore.errors.auth = null;
    persist({ loading: cardStore.loading, errors: cardStore.errors });

    try {
      const tokens = await kaiserExApi.exchangeOAuthCode(code, codeVerifier);

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

  async refreshAccessToken(): Promise<void> {
    return cardStoreInstance.refreshAccessToken();
  },

  async logout(): Promise<void> {
    cardStore.accessToken = null;
    cardStore.refreshToken = null;
    cardStore.tokenExpiry = null;
    cardStore.userInfo = null;
    cardStore.cardanoAddress = null;
    cardStore.verificationLink = null;
    cardStore.cards = null;
    cardStore.selectedCard = null;
    cardStore.cardDetails = null;
    cardStore.cardPin = null;
    cardStore.cardBalance = null;
    cardStore.cardHistory = null;
    cardStore.totalDeposits = 0;
    cardStore.activities = [];
    // Legacy data
    cardStore.cardData = null;
    cardStore.cardNumber = null;

    persist({
      accessToken: cardStore.accessToken,
      refreshToken: cardStore.refreshToken,
      tokenExpiry: cardStore.tokenExpiry,
      userInfo: cardStore.userInfo,
      cardanoAddress: cardStore.cardanoAddress,
      verificationLink: cardStore.verificationLink,
      cards: cardStore.cards,
      selectedCard: cardStore.selectedCard,
      cardDetails: cardStore.cardDetails,
      cardPin: cardStore.cardPin,
      cardBalance: cardStore.cardBalance,
      cardHistory: cardStore.cardHistory,
      totalDeposits: cardStore.totalDeposits,
      activities: cardStore.activities,
      // Legacy data
      cardData: cardStore.cardData,
      cardNumber: cardStore.cardNumber,
    });

    await clearStoredTokens();
  },

  // User methods
  async fetchUserInfo(): Promise<void> {
    cardStore.loading.userInfo = true;
    cardStore.errors.userInfo = null;
    persist({ loading: cardStore.loading, errors: cardStore.errors });

    try {
      
      cardStore.userInfo = await kaiserExApi.getUserInfo();
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

  async fetchCardanoAddress(): Promise<void> {
    cardStore.loading.cardanoAddress = true;
    cardStore.errors.cardanoAddress = null;
    persist({ loading: cardStore.loading, errors: cardStore.errors });

    try {
      
      cardStore.cardanoAddress = await kaiserExApi.getCardanoAddress();
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

  async fetchVerificationLink(): Promise<void> {
    cardStore.loading.verificationLink = true;
    cardStore.errors.verificationLink = null;
    persist({ loading: cardStore.loading, errors: cardStore.errors });

    try {
      
      cardStore.verificationLink = await kaiserExApi.getVerificationLink();
      persist({ verificationLink: cardStore.verificationLink });
    } catch (error) {
      cardStore.errors.verificationLink = error instanceof Error ? error.message : 'Failed to fetch verification link';
      persist({ errors: cardStore.errors });
      throw error;
    } finally {
      cardStore.loading.verificationLink = false;
      persist({ loading: cardStore.loading });
    }
  },

  // Card methods
  async fetchCards(): Promise<void> {
    cardStore.loading.cards = true;
    cardStore.errors.cards = null;
    persist({ loading: cardStore.loading, errors: cardStore.errors });

    try {
      
      const cardsData = await kaiserExApi.getCards(); 
      cardStore.cards = cardsData.data;

      // Auto-select first card if available
      if (cardStore.cards && cardStore.cards.length > 0 && !cardStore.selectedCard) {
        cardStore.selectedCard = cardStore.cards[0];
      }

      persist({ cards: cardStore.cards, selectedCard: cardStore.selectedCard });
    } catch (error) {
      cardStore.errors.cards = error instanceof Error ? error.message : 'Failed to fetch cards';
      persist({ errors: cardStore.errors });
      throw error;
    } finally {
      cardStore.loading.cards = false;
      persist({ loading: cardStore.loading });
    }
  },

  async fetchCardDetails(cardUuid: string): Promise<void> {
    cardStore.loading.cardDetails = true;
    cardStore.errors.cardDetails = null;
    persist({ loading: cardStore.loading, errors: cardStore.errors });

    try {
      
      cardStore.cardDetails = await kaiserExApi.getCardDetails(cardUuid);
      persist({ cardDetails: cardStore.cardDetails });
    } catch (error) {
      cardStore.errors.cardDetails = error instanceof Error ? error.message : 'Failed to fetch card details';
      persist({ errors: cardStore.errors });
      throw error;
    } finally {
      cardStore.loading.cardDetails = false;
      persist({ loading: cardStore.loading });
    }
  },

  async fetchCardPin(cardUuid: string): Promise<void> {
    cardStore.loading.cardPin = true;
    cardStore.errors.cardPin = null;
    persist({ loading: cardStore.loading, errors: cardStore.errors });

    try {
      
      cardStore.cardPin = await kaiserExApi.getCardPin(cardUuid);
      persist({ cardPin: cardStore.cardPin });
    } catch (error) {
      cardStore.errors.cardPin = error instanceof Error ? error.message : 'Failed to fetch card PIN';
      persist({ errors: cardStore.errors });
      throw error;
    } finally {
      cardStore.loading.cardPin = false;
      persist({ loading: cardStore.loading });
    }
  },

  async changeCardPin(cardUuid: string, newPin: string): Promise<void> {
    cardStore.loading.changingPin = true;
    cardStore.errors.changingPin = null;
    persist({ loading: cardStore.loading, errors: cardStore.errors });

    try {
      
      await kaiserExApi.changeCardPin(cardUuid, newPin);

      // Refresh PIN data after successful change
      await this.fetchCardPin(cardUuid);
    } catch (error) {
      cardStore.errors.changingPin = error instanceof Error ? error.message : 'Failed to change card PIN';
      persist({ errors: cardStore.errors });
      throw error;
    } finally {
      cardStore.loading.changingPin = false;
      persist({ loading: cardStore.loading });
    }
  },

  async fetchCardBalance(cardUuid: string): Promise<void> {
    cardStore.loading.cardBalance = true;
    cardStore.errors.cardBalance = null;
    persist({ loading: cardStore.loading, errors: cardStore.errors });

    try {
      
      cardStore.cardBalance = await kaiserExApi.getCardBalance(cardUuid);
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

  async fetchCardHistory(cardUuid: string, params: HistoryParams = {}): Promise<void> {
    cardStore.loading.cardHistory = true;
    cardStore.errors.cardHistory = null;
    persist({ loading: cardStore.loading, errors: cardStore.errors });

    try {
      
      cardStore.cardHistory = await kaiserExApi.getCardHistory(cardUuid, params);
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

  async orderCard(): Promise<OrderCardResponse> {
    cardStore.loading.orderCard = true;
    cardStore.errors.orderCard = null;
    persist({ loading: cardStore.loading, errors: cardStore.errors });

    try {
      
      const orderResponse = await kaiserExApi.orderCard();

      // Refresh cards list after ordering
      await this.fetchCards();

      return orderResponse;
    } catch (error) {
      cardStore.errors.orderCard = error instanceof Error ? error.message : 'Failed to order card';
      persist({ errors: cardStore.errors });
      throw error;
    } finally {
      cardStore.loading.orderCard = false;
      persist({ loading: cardStore.loading });
    }
  },

  async getCardUuidByOrderUuid(orderUuid: string): Promise<string> {
    try {
      
      const cardUuidResponse = await kaiserExApi.getCardUuidByOrderUuid(orderUuid);
      return cardUuidResponse.card_uuid;
    } catch (error) {
      throw error;
    }
  },

  // Initialize store
  async initialize(): Promise<void> {
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
        await Promise.all([this.fetchUserInfo(), this.fetchCardanoAddress(), this.fetchCards()]);

        // Load card-specific data if card is selected
        if (cardStore.selectedCard) {
          await Promise.all([
            this.fetchCardBalance(cardStore.selectedCard.card_uuid),
            this.fetchCardHistory(cardStore.selectedCard.card_uuid),
          ]);
        }
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
      actionCode: '000', // ISO 8583 success code
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
      narrative: {
        description: `ADA to EUR conversion: ${adaAmount} ADA → ${eurAmount} EUR`,
      },
      debit: false, // Credit transaction (adding money)
      state: 'settled',
    };

    // Add to beginning of transactions array
    cardStore.cardHistory.records.unshift(newTransaction);
    cardStore.cardHistory.meta.records += 1;
    cardStore.cardHistory.meta.totalRecords += 1;

    console.log('💳 Transaction added to cardStore.cardHistory');
    console.log('💳 Total records now:', cardStore.cardHistory.meta.totalRecords);
    console.log('💳 First record:', cardStore.cardHistory.records[0]);

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
        year: 'numeric',
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

  // Legacy methods for backward compatibility
  async fetchCardData(): Promise<void> {
    // Map to new fetchCards method
    await this.fetchCards();

    // Create legacy cardData from first card
    if (cardStore.cards && cardStore.cards.length > 0) {
      const firstCard = cardStore.cards[0];
      cardStore.cardData = {
        pan: '**** **** **** ' + firstCard.card_uuid.slice(-4),
        currentBalance: firstCard.balance,
        currency: firstCard.currency,
      };
      persist({ cardData: cardStore.cardData });
    }
  },

  async fetchCardNumber(): Promise<void> {
    // Map to new fetchCardDetails method
    if (cardStore.selectedCard) {
      await this.fetchCardDetails(cardStore.selectedCard.card_uuid);

      // Create legacy cardNumber from cardDetails
      if (cardStore.cardDetails) {
        cardStore.cardNumber = {
          number: cardStore.cardDetails.pan,
        };
        persist({ cardNumber: cardStore.cardNumber });
      }
    }
  },

  // State getter for compatibility
  get state() {
    return cardStore;
  },
};
