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
  address: string;
}

// Card Types from OpenAPI Schema
export interface UserCard {
  id: number;
  user_id: number;
  program_uuid: string;
  currency: string;
  account_to_charge: string;
  processing_type: string; // e.g., 'mastercard'
  cardholder_phone: string;
  payment_card_type: string; // e.g., 'prepaid'
  order_uuid: string;
  card_uuid: string;
  status: string; // e.g., 'done'
  card_status: string; // e.g., 'ACTIVE', 'INACTIVE', 'BLOCKED'
  balance: string;
  created_at: string;
  updated_at: string;
}

export interface CardDetails {
  pan: string;
  cvc2: string;
  expiryDate: string;
}

export interface CardPin {
  pin: string;
}

export interface CardBalance {
  currentBalance: {
    amount: number;
    currencyCode: string; // e.g., 'EUR'
  };
  state: 'NEW' | 'SET' | 'ACTIVATION_IN_PROGRESS' | 'ACTIVE' | 'INACTIVE' | 'BLOCKED';
}

// Cards List Response
export interface CardsListResponse {
  current_page: number;
  data: UserCard[];
  first_page_url: string;
  from: number;
  last_page: number;
  last_page_url: string;
  links: Array<{
    url: string | null;
    label: string;
    active: boolean;
  }>;
  next_page_url: string | null;
  path: string;
  per_page: number;
  prev_page_url: string | null;
  to: number;
  total: number;
}

// Order Card Response
export interface OrderCardResponse {
  message: string;
  orderUuid: string;
}

// Card UUID Response
export interface CardUuidResponse {
  card_uuid: string;
}

// Verification Link Response
export interface VerificationLinkResponse {
  url: string;
  id: string;
}

// Legacy interfaces for backward compatibility
export interface CardData {
  pan: string;
  currentBalance: string;
  currency: string;
}

export interface CardNumber {
  number: string;
}

// Card Transaction Types from OpenAPI
export interface CardTransactionHistory {
  reference: string; // Unique card payment identifier
  amount: {
    amount: number;
    currencyCode: string; // e.g., 'EUR'
  };
  createTime: string; // Payment creation date
  settlementDate: string; // Payment settlement date
  exchangeRate?: number;
  actionCode: string; // ISO 8583 response code
  processingName: string; // e.g., 'Purchase'
  rejectReason?: string; // Payment reject reason
  authorizationCode: string; // Authorization code
  cardAcceptorTerminalId: string; // Card acceptor terminal identifier
  cardAcceptorId: string; // Card acceptor identifier
  cardAcceptorNameAndLocation: string; // Card acceptor name and location
  acquireCountryCode: string; // Acquirer country code
  mcc: {
    code: string; // e.g., '4899'
    description: string; // e.g., 'Cable, Satellite, and Other Pay Television and Radio Services'
  };
  reversedAmount: {
    amount: number;
    currencyCode: string;
  };
  narrative?: {
    description?: string; // Transaction description
  };
  debit: boolean; // If payment was top-up card, then transfer type is credit. If it was debit from card, then transfer type is debit
  state: 'authorized' | 'settled' | 'declined'; // Card transaction state
}

// Card History Response from OpenAPI
export interface CardHistoryResponse {
  meta: {
    page: number;
    records: number;
    totalRecords: number;
  };
  records: CardTransactionHistory[];
}

// Legacy interface for backward compatibility
export interface HistoryResponse {
  history: {
    meta: {
      page: number;
      records: number;
      totalRecords: number;
    };
    records: CardTransactionHistory[];
  };
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
  verificationLink: boolean;
  cards: boolean;
  cardDetails: boolean;
  cardPin: boolean;
  cardBalance: boolean;
  cardHistory: boolean;
  orderCard: boolean;
  changingPin: boolean;
  auth: boolean;
  // Legacy loading states
  cardData: boolean;
  cardNumber: boolean;
}

export interface CardErrorState {
  userInfo: string | null;
  cardanoAddress: string | null;
  verificationLink: string | null;
  cards: string | null;
  cardDetails: string | null;
  cardPin: string | null;
  cardBalance: string | null;
  cardHistory: string | null;
  orderCard: string | null;
  changingPin: string | null;
  auth: string | null;
  // Legacy error states
  cardData: string | null;
  cardNumber: string | null;
}

export interface CardState {
  // Auth
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiry: number | null;

  // User data
  userInfo: UserInfo | null;
  cardanoAddress: CardanoAddress | null;
  verificationLink: VerificationLinkResponse | null;

  // Card data
  cards: UserCard[] | null; // All user cards
  selectedCard: UserCard | null; // Currently selected card
  cardDetails: CardDetails | null; // Card details (PAN, CVV, etc.)
  cardPin: CardPin | null; // Card PIN
  cardBalance: CardBalance | null;
  cardHistory: CardHistoryResponse | null;
  totalDeposits: number;
  activities: Activity[];

  // Legacy card data for backward compatibility
  cardData: CardData | null;
  cardNumber: CardNumber | null;

  // Loading states
  loading: CardLoadingState;

  // Error states
  errors: CardErrorState;
} 