import { ref, computed } from 'vue';
import { strikeTradeApi } from '@/api/strike-v2.trade';
import { strikeUserApi } from '@/api/strike-v2.user';
import type {
  CreateOrderRequest,
  Order,
  AccountResponse,
  Position,
  MarginMode,
} from '@/api/strike-v2.types';

const account = ref<AccountResponse | null>(null);
const openOrders = ref<Order[]>([]);
const positions = ref<Position[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

async function loadAccount(): Promise<void> {
  try {
    loading.value = true;
    error.value = null;
    account.value = await strikeUserApi.getAccount();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

async function loadOpenOrders(symbol?: string): Promise<void> {
  try {
    loading.value = true;
    error.value = null;
    openOrders.value = await strikeTradeApi.getOpenOrders(symbol);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

async function loadPositions(symbol?: string): Promise<void> {
  try {
    loading.value = true;
    error.value = null;
    positions.value = await strikeUserApi.getPositions(symbol);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

async function placeOrder(params: CreateOrderRequest): Promise<Order | null> {
  try {
    loading.value = true;
    error.value = null;
    let order: Order;
    const hasTPSL =
      params.takeProfitPrice !== undefined || params.stopLossPrice !== undefined;
    if (hasTPSL) {
      order = await strikeTradeApi.createStrategyOrder(params);
    } else {
      order = await strikeTradeApi.createOrder(params);
    }
    await Promise.all([loadOpenOrders(params.symbol), loadAccount()]);
    return order;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    return null;
  } finally {
    loading.value = false;
  }
}

async function cancelOrder(orderId: string, symbol: string): Promise<void> {
  try {
    loading.value = true;
    error.value = null;
    await strikeTradeApi.cancelOrder(orderId, symbol);
    await loadOpenOrders(symbol);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

async function cancelAllOrders(symbol?: string): Promise<void> {
  try {
    loading.value = true;
    error.value = null;
    await strikeTradeApi.cancelAllOrders(symbol);
    await loadOpenOrders(symbol);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

async function setLeverage(symbol: string, leverage: number): Promise<void> {
  try {
    loading.value = true;
    error.value = null;
    await strikeTradeApi.setLeverage(symbol, leverage);
    await loadAccount();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

async function setMarginMode(symbol: string, mode: MarginMode): Promise<void> {
  try {
    loading.value = true;
    error.value = null;
    await strikeTradeApi.setMarginMode(symbol, mode);
    await loadAccount();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

const availableBalance = computed<string | null>(() => {
  return account.value?.availableBalance ?? null;
});

const walletBalance = computed<string | null>(() => {
  return account.value?.walletBalance ?? null;
});

export function useStrikeTrading() {
  return {
    account,
    openOrders,
    positions,
    loading,
    error,
    availableBalance,
    walletBalance,
    loadAccount,
    loadOpenOrders,
    loadPositions,
    placeOrder,
    cancelOrder,
    cancelAllOrders,
    setLeverage,
    setMarginMode,
  };
}
