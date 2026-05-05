import { ref, computed } from 'vue';
import { strikeTradeApi } from '@/api/strike-v2.trade';
import { strikeUserApi } from '@/api/strike-v2.user';
import type {
  CreateOrderRequest,
  CreateOrderResponse,
  CreateStrategyOrderRequest,
  AccountResponse,
  Order,
  Position,
  MarginMode,
  CreateTwapRequest,
  CreateTwapResponse,
  TwapOrder,
  ListTwapParams,
} from '@/api/strike-v2.types';

const account = ref<AccountResponse | null>(null);
const openOrders = ref<Order[]>([]);
const positions = ref<Position[]>([]);
const twapOrders = ref<TwapOrder[]>([]);
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
    const res = await strikeTradeApi.getOpenOrders(symbol);
    openOrders.value = res.orders;
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
    const res = await strikeUserApi.getPositions(symbol);
    positions.value = res.positions;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

async function placeOrder(params: CreateOrderRequest): Promise<CreateOrderResponse | null> {
  try {
    loading.value = true;
    error.value = null;
    let order: CreateOrderResponse;
    if ('strategy_id' in params) {
      order = await strikeTradeApi.createStrategyOrder(params as CreateStrategyOrderRequest);
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
    await strikeTradeApi.cancelOrder({ order_id: orderId, symbol });
    await loadOpenOrders(symbol);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

async function cancelAllOrders(symbol: string): Promise<void> {
  if (!symbol) {
    throw new Error('cancelAllOrders requires a symbol');
  }
  try {
    loading.value = true;
    error.value = null;
    await strikeTradeApi.cancelAllOrders({ symbol });
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
    await strikeTradeApi.setLeverage({ symbol, leverage });
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
    await strikeTradeApi.setMarginMode({ symbol, marginMode: mode });
    await loadAccount();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

const availableBalance = computed<string | null>(() => {
  return account.value?.available_balance ?? null;
});

const walletBalance = computed<string | null>(() => {
  return account.value?.wallet_balance ?? null;
});

async function loadTwapOrders(params?: ListTwapParams): Promise<void> {
  try {
    loading.value = true;
    error.value = null;
    const res = await strikeTradeApi.getTwapOrders(params);
    twapOrders.value = res.strategies ?? [];
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

async function placeTwapOrder(params: CreateTwapRequest): Promise<CreateTwapResponse | null> {
  try {
    loading.value = true;
    error.value = null;
    const res = await strikeTradeApi.createTwap(params);
    // Refresh TWAP list and account so balance reservations reflect immediately.
    await Promise.all([loadTwapOrders({ status: 'active' }), loadAccount()]);
    return res;
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    return null;
  } finally {
    loading.value = false;
  }
}

async function cancelTwapOrder(strategyId: string): Promise<void> {
  try {
    loading.value = true;
    error.value = null;
    await strikeTradeApi.cancelTwap({ id: strategyId });
    await loadTwapOrders({ status: 'active' });
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

function reset(): void {
  account.value = null;
  openOrders.value = [];
  positions.value = [];
  twapOrders.value = [];
  loading.value = false;
  error.value = null;
}

export function useStrikeTrading() {
  return {
    account,
    openOrders,
    positions,
    twapOrders,
    loading,
    error,
    availableBalance,
    walletBalance,
    loadAccount,
    loadOpenOrders,
    loadPositions,
    loadTwapOrders,
    placeOrder,
    placeTwapOrder,
    cancelOrder,
    cancelAllOrders,
    cancelTwapOrder,
    setLeverage,
    setMarginMode,
    reset,
  };
}
