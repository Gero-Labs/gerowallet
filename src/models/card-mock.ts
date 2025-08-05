// Mock data for card functionality testing
import type {
  AuthTokens,
  UserInfo,
  CardanoAddress,
  CardData,
  CardNumber,
  CardBalance,
  HistoryResponse,
  CardTransactionHistory,
} from '@/models/card';

// Mock Auth Tokens
export const mockAuthTokens: AuthTokens = {
  token_type: 'Bearer',
  expires_in: 604799,
  access_token:
    'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiI2IiwianRpIjoiZGU4OWZjYjNjZTljZTg4ZjE2MGFmMTEzNGUyMGNjNWEwNzgzOTVjMGMzZDM1Yzk3ODM1ODFiMWY4YmM0ODFlOTY2OThiMzBlMzU4MTljNDIiLCJpYXQiOjE3NTI4NzUwMDUuNzc1NTUxLCJuYmYiOjE3NTI4NzUwMDUuNzc1NTU0LCJleHAiOjE3NTM0Nzk4MDUuNzUwNDIsInN1YiI6IjE0MTYiLCJzY29wZXMiOltdfQ.X6ryeSmGxyZEJq8Gp3H6MqCCX1gylMy9PoNxlOYphWDyq50EvabMlE00SUE8huUlvYxDX48OKRbhvwMiqKfQPQxAE1XyUvQ9FSz0zg5xt9IamPkUjTmtty6bNSqSKoJ3434yJKiyILEMLEIPOF6YlCvsL3Sue9Rk8VgZMvI9NYgj_1xxTSP1_QtAsG3JKeD06QfSZbV8meda4crvJwPhSIHo7Pa7dBZzoQEqSquN8iPjbERbJSEsKoEf5GfP-lDCyvlH0qxUc5EMKXf1up1iZRQ14D7FNUeoToQLQuulS1sHcfgbK8cS_dSxP08sSPH9NRiMMTJ6dBM8PiqRxiEl_tzdDPv4cTQ0FHJruJ8izfzjiaYSWHrRz4OtL4ydxneQQE_TFasCCm3yNI1wvm2eXfKmU_PfTHXycVlc9wf_tokMAQUVv5NvD8eydoLGMXJ9TGvgxu7DTC24GXM81fMuo0T_4b3CAsAJfXFvG6w4mvcTEdw7FDjJcOc0vFgG5Hx5SWbqLIrexcv4M1UxkueGt0tgAnSsyi1qQRV8EO3pawXNcUDM2SdlPXuloFVbif2ay1X32qsktgYAmPY1T3fAVG-4vf5r7zuvzYifDtow24jvCqKO1vybUtb-WZjuapyDqfkXbrM62AVgh3Otng_tUXDI2jUZyVgKJAi3iIA9mho',
  refresh_token: 'dfe50...',
};

// Mock User Info
export const mockUserInfo: UserInfo = {
  email: 'user@example.com',
};

// Mock Cardano Address
export const mockCardanoAddress: CardanoAddress = {
  address:
    'addr1qxck9x7m7v8f0y8j2k4n5m6l7p8q9r0s1t2u3v4w5x6y7z8a9b0c1d2e3f4g5h6i7j8k9l0m1n2o3p4q5r6s7t8u9v0w1x2y3z4a5b6c7d8e9f0g1h2i3j4k5l6m7n8o9p0q1r2s3t4u5v6w7x8y9z0a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z',
};

// Mock Card Data
export const mockCardData: CardData = {
  pan: '1234 5678 9012 3456',
  currentBalance: '1,250.00',
  currency: 'EUR',
};

// Mock Card Number
export const mockCardNumber: CardNumber = {
  number: '1234 5678 9012 3456',
};

// Mock Card Balance
export const mockCardBalance: CardBalance = {
  currentBalance: {
    amount: 550.0,
    currencyCode: 'EUR',
  },
  state: 'ACTIVE',
};

// Mock Transaction History
export const mockTransactionHistory: CardTransactionHistory[] = [
  {
    reference: 'ea893356-f5f0-11ec-b939-0242ac120002',
    amount: {
      amount: 29.99,
      currencyCode: '€',
    },
    createTime: '2024-01-15T10:30:00Z',
    settlementDate: '2024-01-16T00:00:00Z',
    exchangeRate: 1.0,
    actionCode: '000',
    processingName: 'Purchase',
    authorizationCode: '675845',
    cardAcceptorTerminalId: '654456',
    cardAcceptorId: '743647443',
    cardAcceptorNameAndLocation: 'NL NETFLIX.COM Purchase',
    acquireCountryCode: 'NL',
    mcc: {
      code: '4899',
      description: 'Cable, Satellite, and Other Pay Television and Radio Services',
    },
    reversedAmount: {
      amount: 29.99,
      currencyCode: '€',
    },
    narrative: {
      description: 'Netflix subscription',
    },
    debit: true,
    state: 'authorized',
  },
  {
    reference: 'ea893356-f5f0-11ec-b939-0242ac120003',
    amount: {
      amount: 15.5,
      currencyCode: '€',
    },
    createTime: '2024-01-14T14:20:00Z',
    settlementDate: '2024-01-15T00:00:00Z',
    exchangeRate: 1.0,
    actionCode: '000',
    processingName: 'Purchase',
    authorizationCode: '675846',
    cardAcceptorTerminalId: '654457',
    cardAcceptorId: '743647444',
    cardAcceptorNameAndLocation: 'DE SPOTIFY.COM Purchase',
    acquireCountryCode: 'DE',
    mcc: {
      code: '4899',
      description: 'Cable, Satellite, and Other Pay Television and Radio Services',
    },
    reversedAmount: {
      amount: 15.5,
      currencyCode: '€',
    },
    narrative: {
      description: 'Spotify subscription',
    },
    debit: true,
    state: 'authorized',
  },

  {
    reference: 'ea893356-f5f0-11ec-b939-0242ac120004',
    amount: {
      amount: 45.0,
      currencyCode: '€',
    },
    createTime: '2024-01-13T09:15:00Z',
    settlementDate: '2024-01-14T00:00:00Z',
    exchangeRate: 1.0,
    actionCode: '000',
    processingName: 'Purchase',
    authorizationCode: '675847',
    cardAcceptorTerminalId: '654458',
    cardAcceptorId: '743647445',
    cardAcceptorNameAndLocation: 'FR AMAZON.COM Purchase',
    acquireCountryCode: 'FR',
    mcc: {
      code: '5942',
      description: 'Book Stores',
    },
    reversedAmount: {
      amount: 45.0,
      currencyCode: '€',
    },
    narrative: {
      description: 'Amazon purchase',
    },
    debit: true,
    state: 'authorized',
  },
  {
    reference: 'ea893356-f5f0-11ec-b939-0242ac120001',
    amount: {
      amount: 32.5,
      currencyCode: '€',
    },
    createTime: '2024-01-13T09:15:00Z',
    settlementDate: '2024-01-14T00:00:00Z',
    exchangeRate: 1.0,
    actionCode: '000',
    processingName: 'Purchase',
    authorizationCode: '675847',
    cardAcceptorTerminalId: '654458',
    cardAcceptorId: '743647445',
    cardAcceptorNameAndLocation: 'FR AMAZON.COM Purchase',
    acquireCountryCode: 'FR',
    mcc: {
      code: '5942',
      description: 'Book Stores',
    },
    reversedAmount: {
      amount: 32.5,
      currencyCode: '€',
    },
    narrative: {
      description: 'Amazon purchase',
    },
    debit: true,
    state: 'authorized',
  },
  {
    reference: 'ea893356-f5f0-11ec-b939-0242ac120002',
    amount: {
      amount: 58.75,
      currencyCode: '€',
    },
    createTime: '2024-01-12T14:30:00Z',
    settlementDate: '2024-01-13T00:00:00Z',
    exchangeRate: 1.0,
    actionCode: '000',
    processingName: 'Purchase',
    authorizationCode: '123456',
    cardAcceptorTerminalId: '789012',
    cardAcceptorId: '987654321',
    cardAcceptorNameAndLocation: 'DE NETFLIX.COM Streaming',
    acquireCountryCode: 'DE',
    mcc: {
      code: '4899',
      description: 'Cable, Satellite, and Other Pay Television and Radio Services',
    },
    reversedAmount: {
      amount: 58.75,
      currencyCode: '€',
    },
    narrative: {
      description: 'Netflix subscription',
    },
    debit: true,
    state: 'authorized',
  },
  {
    reference: 'ea893356-f5f0-11ec-b939-0242ac120003',
    amount: {
      amount: 24.99,
      currencyCode: '€',
    },
    createTime: '2024-01-11T18:45:00Z',
    settlementDate: '2024-01-12T00:00:00Z',
    exchangeRate: 1.0,
    actionCode: '000',
    processingName: 'Purchase',
    authorizationCode: '456789',
    cardAcceptorTerminalId: '345678',
    cardAcceptorId: '123456789',
    cardAcceptorNameAndLocation: 'IT SPOTIFY.COM Music',
    acquireCountryCode: 'IT',
    mcc: {
      code: '4899',
      description: 'Cable, Satellite, and Other Pay Television and Radio Services',
    },
    reversedAmount: {
      amount: 24.99,
      currencyCode: '€',
    },
    narrative: {
      description: 'Spotify Premium',
    },
    debit: true,
    state: 'authorized',
  },
  {
    reference: 'ea893356-f5f0-11ec-b939-0242ac120004',
    amount: {
      amount: 42.8,
      currencyCode: '€',
    },
    createTime: '2024-01-10T12:20:00Z',
    settlementDate: '2024-01-11T00:00:00Z',
    exchangeRate: 1.0,
    actionCode: '000',
    processingName: 'Purchase',
    authorizationCode: '789012',
    cardAcceptorTerminalId: '567890',
    cardAcceptorId: '456789123',
    cardAcceptorNameAndLocation: 'ES UBER.COM Transportation',
    acquireCountryCode: 'ES',
    mcc: {
      code: '4121',
      description: 'Taxicabs and Limousines',
    },
    reversedAmount: {
      amount: 42.8,
      currencyCode: '€',
    },
    narrative: {
      description: 'Uber ride',
    },
    debit: true,
    state: 'authorized',
  },
  {
    reference: 'ea893356-f5f0-11ec-b939-0242ac120005',
    amount: {
      amount: 55.25,
      currencyCode: '€',
    },
    createTime: '2024-01-09T20:10:00Z',
    settlementDate: '2024-01-10T00:00:00Z',
    exchangeRate: 1.0,
    actionCode: '000',
    processingName: 'Purchase',
    authorizationCode: '234567',
    cardAcceptorTerminalId: '678901',
    cardAcceptorId: '567890234',
    cardAcceptorNameAndLocation: 'FR DELIVEROO.COM Food Delivery',
    acquireCountryCode: 'FR',
    mcc: {
      code: '5814',
      description: 'Fast Food Restaurants',
    },
    reversedAmount: {
      amount: 55.25,
      currencyCode: '€',
    },
    narrative: {
      description: 'Deliveroo food delivery',
    },
    debit: true,
    state: 'authorized',
  },
  {
    reference: 'ea893356-f5f0-11ec-b939-0242ac120006',
    amount: {
      amount: 28.4,
      currencyCode: '€',
    },
    createTime: '2024-01-08T16:35:00Z',
    settlementDate: '2024-01-09T00:00:00Z',
    exchangeRate: 1.0,
    actionCode: '000',
    processingName: 'Purchase',
    authorizationCode: '345678',
    cardAcceptorTerminalId: '789012',
    cardAcceptorId: '678901345',
    cardAcceptorNameAndLocation: 'DE AIRBNB.COM Accommodation',
    acquireCountryCode: 'DE',
    mcc: {
      code: '7011',
      description: 'Hotels, Motels, Resorts',
    },
    reversedAmount: {
      amount: 28.4,
      currencyCode: '€',
    },
    narrative: {
      description: 'Airbnb booking',
    },
    debit: true,
    state: 'authorized',
  },
  {
    reference: 'ea893356-f5f0-11ec-b939-0242ac120007',
    amount: {
      amount: 47.9,
      currencyCode: '€',
    },
    createTime: '2024-01-07T11:55:00Z',
    settlementDate: '2024-01-08T00:00:00Z',
    exchangeRate: 1.0,
    actionCode: '000',
    processingName: 'Purchase',
    authorizationCode: '456789',
    cardAcceptorTerminalId: '890123',
    cardAcceptorId: '789012456',
    cardAcceptorNameAndLocation: 'IT APPLE.COM/BILL Digital Services',
    acquireCountryCode: 'IT',
    mcc: {
      code: '5734',
      description: 'Computer Software Stores',
    },
    reversedAmount: {
      amount: 47.9,
      currencyCode: '€',
    },
    narrative: {
      description: 'Apple App Store',
    },
    debit: true,
    state: 'authorized',
  },
  {
    reference: 'ea893356-f5f0-11ec-b939-0242ac120008',
    amount: {
      amount: 36.15,
      currencyCode: '€',
    },
    createTime: '2024-01-06T19:25:00Z',
    settlementDate: '2024-01-07T00:00:00Z',
    exchangeRate: 1.0,
    actionCode: '000',
    processingName: 'Purchase',
    authorizationCode: '567890',
    cardAcceptorTerminalId: '901234',
    cardAcceptorId: '890123567',
    cardAcceptorNameAndLocation: 'ES GOOGLE.COM/YTUBE Digital Services',
    acquireCountryCode: 'ES',
    mcc: {
      code: '4899',
      description: 'Cable, Satellite, and Other Pay Television and Radio Services',
    },
    reversedAmount: {
      amount: 36.15,
      currencyCode: '€',
    },
    narrative: {
      description: 'YouTube Premium',
    },
    debit: true,
    state: 'authorized',
  },
];

// Mock History Response
export const mockHistoryResponse: HistoryResponse = {
  history: {
    meta: {
      page: 1,
      records: 3,
      totalRecords: 3,
    },
    records: mockTransactionHistory,
  },
};
