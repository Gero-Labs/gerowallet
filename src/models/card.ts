// ============================================================================
// CARD TYPES - KaiserEx API Integration
// ============================================================================

import type { Activity } from './types';

// Auth Types
export interface AuthTokens {
  token_type: string;
  expires_in: number;
  access_token: string;
  refresh_token: string;
}

// User Types
export interface UserInfo {
  email: string;
}

export interface CardanoAddress {
  wallet_address: string;
}

// Card Types
export interface CardData {
  id: number;
  user_id: number;
  program_uuid: string;
  currency: string;
  account_to_charge: string;
  processing_type: string;
  cardholder_phone: string;
  payment_card_type: string;
  own_type: string;
  card_holder_name: string;
  order_uuid: string;
  card_uuid: string;
  status: string;
  card_status: 'TEMPORARY_BLOCKED' | 'ACTIVE';
  balance: string
  pan: string;
  currentBalance: string;
  created_at: string;
  updated_at: string;
}

// Pagination Types (Laravel-style)
export interface PaginationLink {
  url: string | null;
  label: string;
  active: boolean;
}

export interface PaginatedCardsResponse {
  current_page: number;
  data: CardData[];
  first_page_url: string;
  from: number;
  last_page: number;
  last_page_url: string;
  links: PaginationLink[];
  next_page_url: string | null;
  path: string;
  per_page: number;
  prev_page_url: string | null;
  to: number;
  total: number;
}

export interface CardNumber {
  number: string;
}

export interface CardBalance {
  currentBalance: {
    amount: number;
    currencyCode: string;
  };
  state: 'ACTIVE' | 'BLOCKED';
}

// Card Transaction Types
export interface CardTransactionHistory {
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
  narrative: string;
  debit: boolean;
  state: string;
}

export interface HistoryResponse {
  meta: {
    page: number;
    records: number;
    totalRecords: number;
  };
  records: CardTransactionHistory[];
}

export interface HistoryParams {
  periodFrom?: string;
  periodTo?: string;
  page?: number;
  size?: number;
}

// Card Store State Types
export interface CardLoadingState {
  userInfo: boolean;
  cardanoAddress: boolean;
  cardData: boolean;
  cardNumber: boolean;
  cardBalance: boolean;
  cardHistory: boolean;
  auth: boolean;
  initialize: boolean;
}

export interface CardErrorState {
  userInfo: string | null;
  cardanoAddress: string | null;
  cardData: string | null;
  cardDetails: string | null;
  cardPin: string | null;
  cardNumber: string | null;
  cardBalance: string | null;
  cardHistory: string | null;
  auth: string | null;
  initialize: string | null;
}

export interface CardDetails {
  pan: string;
  expiryDate: string;
  cvc2: string;
  cardHolderName: string;
}

export interface CardPin {
  pin: string;
}
export interface ExchangeRate {
  buy: string;
  sell: string;
}
// Individual card data with all related information
export interface CardInfo {
  cardData: CardData;
  cardDetails: CardDetails | null;
  cardPin: CardPin | null;
  cardNumber: CardNumber | null;
  cardBalance: CardBalance | null;
  cardHistory: HistoryResponse | null;
  totalDeposits: number;
  activities: Activity[];
}

export interface CardState {
  // Auth
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiry: number | null;

  // User data
  userInfo: UserInfo | null;
  cardanoAddress: CardanoAddress | null;

  // Multiple cards support
  cards: CardInfo[]; // Array of all user's cards
  selectedCardId: string | null; // Currently selected card UUID
  exchangeRate: ExchangeRate | null;

  // Wallet status integration - ALL IN ONE!
  walletStatus: {
    currentState: 'loading' | 'auth' | 'new' | 'pending' | 'approved' | 'error';
    isKaiserexAuthenticated: boolean;
    kycStatus: 'approved' | 'rejected' | 'verified' | 'registered' | 'verification_started';
    kycData: any;
    loadingMessage: string;
    error: string | null;
  };

  // Loading states
  loading: CardLoadingState;

  // Error states
  errors: CardErrorState;
}
