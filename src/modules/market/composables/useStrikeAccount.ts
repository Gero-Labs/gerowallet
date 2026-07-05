import { ref, computed } from 'vue';
import { strikeUserApi } from '@/api/strike-v2.user';
import type {
  AccountResponse,
  BalanceResponse,
  PortfolioSummaryResponse,
} from '@/api/strike-v2.types';

// Singleton state
const account = ref<AccountResponse | null>(null);
const balances = ref<BalanceResponse[]>([]);
const portfolio = ref<PortfolioSummaryResponse | null>(null);
const loading = ref(false);

// Account computed — AccountResponse fields are snake_case (see strike-v2.types.ts)
const walletBalance = computed(() => account.value?.wallet_balance ?? null);
const availableBalance = computed(() => account.value?.available_balance ?? null);
const unrealizedPnl = computed(() => account.value?.unrealized_pnl ?? null);
const marginBalance = computed(() => account.value?.margin_balance ?? null);
const totalMargin = computed(() => account.value?.total_margin ?? null);

// Portfolio computed — PnL/volume live under PortfolioSummaryResponse.account;
// feeTier/history/isTradingEnabled are top-level (see strike-v2.types.ts).
const allTimePnl = computed(() => portfolio.value?.account?.allTimePnl ?? null);
const realizedPnl = computed(() => portfolio.value?.account?.realizedPnl ?? null);
const allTimeVolume = computed(() => portfolio.value?.account?.allTimeVolume ?? null);
const feeTier = computed(() => portfolio.value?.feeTier ?? null);
const isTradingEnabled = computed(() => portfolio.value?.isTradingEnabled ?? false);
const equityHistory = computed(() => portfolio.value?.history ?? []);

const marginRatio = computed(() => {
  const margin = parseFloat(String(totalMargin.value ?? '0'));
  const balance = parseFloat(String(marginBalance.value ?? '0'));
  if (!margin || !balance) return 0;
  return (margin / balance) * 100;
});

const marginRiskLevel = computed((): 'healthy' | 'warning' | 'danger' | 'liquidation' => {
  const ratio = marginRatio.value;
  if (ratio >= 100) return 'liquidation';
  if (ratio >= 90) return 'danger';
  if (ratio >= 70) return 'warning';
  return 'healthy';
});

async function loadAccount(): Promise<void> {
  loading.value = true;
  try {
    const [accountResult, balancesResult] = await Promise.all([
      strikeUserApi.getAccount(),
      strikeUserApi.getBalances(),
    ]);
    account.value = accountResult;
    balances.value = Array.isArray(balancesResult) ? balancesResult : [];
  } finally {
    loading.value = false;
  }
}

async function loadPortfolio(): Promise<void> {
  loading.value = true;
  try {
    portfolio.value = await strikeUserApi.getPortfolio();
  } finally {
    loading.value = false;
  }
}

export function useStrikeAccount() {
  return {
    // State
    account,
    balances,
    portfolio,
    loading,
    // Computed — account
    walletBalance,
    availableBalance,
    unrealizedPnl,
    marginBalance,
    totalMargin,
    marginRatio,
    marginRiskLevel,
    // Computed — portfolio
    allTimePnl,
    realizedPnl,
    allTimeVolume,
    feeTier,
    isTradingEnabled,
    equityHistory,
    // Methods
    loadAccount,
    loadPortfolio,
  };
}
