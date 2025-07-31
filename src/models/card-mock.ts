// Mock data for card functionality testing
import type { 
  AuthTokens, 
  UserInfo, 
  CardanoAddress, 
  CardData, 
  CardNumber, 
  CardBalance, 
  HistoryResponse,
  CardTransactionHistory 
} from '@/models/card';

// Mock Auth Tokens
export const mockAuthTokens: AuthTokens = {
  token_type: "Bearer",
  expires_in: 604799,
  access_token: "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiI2IiwianRpIjoiZGU4OWZjYjNjZTljZTg4ZjE2MGFmMTEzNGUyMGNjNWEwNzgzOTVjMGMzZDM1Yzk3ODM1ODFiMWY4YmM0ODFlOTY2OThiMzBlMzU4MTljNDIiLCJpYXQiOjE3NTI4NzUwMDUuNzc1NTUxLCJuYmYiOjE3NTI4NzUwMDUuNzc1NTU0LCJleHAiOjE3NTM0Nzk4MDUuNzUwNDIsInN1YiI6IjE0MTYiLCJzY29wZXMiOltdfQ.X6ryeSmGxyZEJq8Gp3H6MqCCX1gylMy9PoNxlOYphWDyq50EvabMlE00SUE8huUlvYxDX48OKRbhvwMiqKfQPQxAE1XyUvQ9FSz0zg5xt9IamPkUjTmtty6bNSqSKoJ3434yJKiyILEMLEIPOF6YlCvsL3Sue9Rk8VgZMvI9NYgj_1xxTSP1_QtAsG3JKeD06QfSZbV8meda4crvJwPhSIHo7Pa7dBZzoQEqSquN8iPjbERbJSEsKoEf5GfP-lDCyvlH0qxUc5EMKXf1up1iZRQ14D7FNUeoToQLQuulS1sHcfgbK8cS_dSxP08sSPH9NRiMMTJ6dBM8PiqRxiEl_tzdDPv4cTQ0FHJruJ8izfzjiaYSWHrRz4OtL4ydxneQQE_TFasCCm3yNI1wvm2eXfKmU_PfTHXycVlc9wf_tokMAQUVv5NvD8eydoLGMXJ9TGvgxu7DTC24GXM81fMuo0T_4b3CAsAJfXFvG6w4mvcTEdw7FDjJcOc0vFgG5Hx5SWbqLIrexcv4M1UxkueGt0tgAnSsyi1qQRV8EO3pawXNcUDM2SdlPXuloFVbif2ay1X32qsktgYAmPY1T3fAVG-4vf5r7zuvzYifDtow24jvCqKO1vybUtb-WZjuapyDqfkXbrM62AVgh3Otng_tUXDI2jUZyVgKJAi3iIA9mho",
  refresh_token: "dfe50..."
};

// Mock User Info
export const mockUserInfo: UserInfo = {
  email: "user@example.com"
};

// Mock Cardano Address
export const mockCardanoAddress: CardanoAddress = {
  address: "addr1qxck9x7m7v8f0y8j2k4n5m6l7p8q9r0s1t2u3v4w5x6y7z8a9b0c1d2e3f4g5h6i7j8k9l0m1n2o3p4q5r6s7t8u9v0w1x2y3z4a5b6c7d8e9f0g1h2i3j4k5l6m7n8o9p0q1r2s3t4u5v6w7x8y9z0a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z"
};

// Mock Card Data
export const mockCardData: CardData = {
  pan: "1234 5678 9012 3456",
  currentBalance: "1,250.00",
  currency: "EUR"
};

// Mock Card Number
export const mockCardNumber: CardNumber = {
  number: "1234 5678 9012 3456"
};

// Mock Card Balance
export const mockCardBalance: CardBalance = {
  currentBalance: {
    amount: 1250.00,
    currencyCode: "EUR"
  },
  state: "ACTIVE"
};

// Mock Transaction History
export const mockTransactionHistory: CardTransactionHistory[] = [
  {
    reference: "ea893356-f5f0-11ec-b939-0242ac120002",
    amount: {
      amount: 29.99,
      currencyCode: "EUR"
    },
    createTime: "2024-01-15T10:30:00Z",
    settlementDate: "2024-01-16T00:00:00Z",
    exchangeRate: 1.0,
    actionCode: "000",
    processingName: "Purchase",
    authorizationCode: "675845",
    cardAcceptorTerminalId: "654456",
    cardAcceptorId: "743647443",
    cardAcceptorNameAndLocation: "NL NETFLIX.COM Purchase",
    acquireCountryCode: "NL",
    mcc: {
      code: "4899",
      description: "Cable, Satellite, and Other Pay Television and Radio Services"
    },
    reversedAmount: {
      amount: 29.99,
      currencyCode: "EUR"
    },
    narrative: {
      description: "Netflix subscription"
    },
    debit: true,
    state: "authorized"
  },
  {
    reference: "ea893356-f5f0-11ec-b939-0242ac120003",
    amount: {
      amount: 15.50,
      currencyCode: "EUR"
    },
    createTime: "2024-01-14T14:20:00Z",
    settlementDate: "2024-01-15T00:00:00Z",
    exchangeRate: 1.0,
    actionCode: "000",
    processingName: "Purchase",
    authorizationCode: "675846",
    cardAcceptorTerminalId: "654457",
    cardAcceptorId: "743647444",
    cardAcceptorNameAndLocation: "DE SPOTIFY.COM Purchase",
    acquireCountryCode: "DE",
    mcc: {
      code: "4899",
      description: "Cable, Satellite, and Other Pay Television and Radio Services"
    },
    reversedAmount: {
      amount: 15.50,
      currencyCode: "EUR"
    },
    narrative: {
      description: "Spotify subscription"
    },
    debit: true,
    state: "authorized"
  },
  {
    reference: "ea893356-f5f0-11ec-b939-0242ac120004",
    amount: {
      amount: 45.00,
      currencyCode: "EUR"
    },
    createTime: "2024-01-13T09:15:00Z",
    settlementDate: "2024-01-14T00:00:00Z",
    exchangeRate: 1.0,
    actionCode: "000",
    processingName: "Purchase",
    authorizationCode: "675847",
    cardAcceptorTerminalId: "654458",
    cardAcceptorId: "743647445",
    cardAcceptorNameAndLocation: "FR AMAZON.COM Purchase",
    acquireCountryCode: "FR",
    mcc: {
      code: "5942",
      description: "Book Stores"
    },
    reversedAmount: {
      amount: 45.00,
      currencyCode: "EUR"
    },
    narrative: {
      description: "Amazon purchase"
    },
    debit: true,
    state: "authorized"
  }
];

// Mock History Response
export const mockHistoryResponse: HistoryResponse = {
  history: {
    meta: {
      page: 1,
      records: 3,
      totalRecords: 3
    },
    records: mockTransactionHistory
  }
}; 