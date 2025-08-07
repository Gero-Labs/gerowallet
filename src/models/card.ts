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

// Card Types
export interface CardData {
  pan: string;
  currentBalance: string;
  currency: string;
}

export interface CardNumber {
  number: string;
}

export interface CardBalance {
  currentBalance: {
    amount: number;
    currencyCode: string;
  };
  state: string;
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
  narrative: {
    description: string;
  };
  debit: boolean;
  state: string;
}

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
  cardData: boolean;
  cardNumber: boolean;
  cardBalance: boolean;
  cardHistory: boolean;
  auth: boolean;
}

export interface CardErrorState {
  userInfo: string | null;
  cardanoAddress: string | null;
  cardData: string | null;
  cardNumber: string | null;
  cardBalance: string | null;
  cardHistory: string | null;
  auth: string | null;
}

export interface CardState {
  // Auth
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiry: number | null;

  // User data
  userInfo: UserInfo | null;
  cardanoAddress: CardanoAddress | null;

  // Card data
  cardData: CardData | null;
  cardNumber: CardNumber | null;
  cardBalance: CardBalance | null;
  cardHistory: HistoryResponse | null;
  totalDeposits: number;
  activities: Activity[];

  // Loading states
  loading: CardLoadingState;

  // Error states
  errors: CardErrorState;
} 