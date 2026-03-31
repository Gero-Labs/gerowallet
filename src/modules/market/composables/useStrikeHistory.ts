import { ref } from 'vue';
import { strikeUserApi } from '@/api/strike-v2.user';
import type {
  OrderHistoryResult,
  FillHistoryResult,
  FundingHistoryResult,
  TransactionHistoryResult,
} from '@/api/strike-v2.types';

// Singleton state
const orderHistory = ref<OrderHistoryResult[]>([]);
const fillHistory = ref<FillHistoryResult[]>([]);
const fundingHistory = ref<FundingHistoryResult[]>([]);
const transactionHistory = ref<TransactionHistoryResult[]>([]);
const loading = ref(false);

// Methods
async function loadOrderHistory(params: {
  symbol?: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
  [key: string]: unknown;
} = {}): Promise<void> {
  loading.value = true;
  try {
    const mergedParams = { limit: 100, ...params };
    const result = await strikeUserApi.getOrderHistory(mergedParams);
    orderHistory.value = result?.orders ?? (Array.isArray(result) ? result : []);
  } finally {
    loading.value = false;
  }
}

async function loadFillHistory(params: {
  symbol?: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
  [key: string]: unknown;
} = {}): Promise<void> {
  loading.value = true;
  try {
    const mergedParams = { limit: 500, ...params };
    const result = await strikeUserApi.getFillHistory(mergedParams);
    fillHistory.value = result?.fills ?? (Array.isArray(result) ? result : []);
  } finally {
    loading.value = false;
  }
}

async function loadFundingHistory(params: {
  symbol?: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
  [key: string]: unknown;
} = {}): Promise<void> {
  loading.value = true;
  try {
    const mergedParams = { limit: 500, ...params };
    const result = await strikeUserApi.getFundingHistory(mergedParams);
    fundingHistory.value = result?.funding ?? (Array.isArray(result) ? result : []);
  } finally {
    loading.value = false;
  }
}

async function loadTransactionHistory(params: {
  asset?: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
  [key: string]: unknown;
} = {}): Promise<void> {
  loading.value = true;
  try {
    const mergedParams = { limit: 100, ...params };
    const result = await strikeUserApi.getTransactionHistory(mergedParams);
    transactionHistory.value = result?.transactions ?? (Array.isArray(result) ? result : []);
  } finally {
    loading.value = false;
  }
}

export function useStrikeHistory() {
  return {
    // State
    orderHistory,
    fillHistory,
    fundingHistory,
    transactionHistory,
    loading,
    // Methods
    loadOrderHistory,
    loadFillHistory,
    loadFundingHistory,
    loadTransactionHistory,
  };
}
