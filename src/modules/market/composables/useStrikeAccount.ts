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

// Account computed
const walletBalance = computed(() => account.value?.walletBalance ?? null);
const availableBalance = computed(() => account.value?.availableBalance ?? null);
const unrealizedPnl = computed(() => account.value?.unrealizedPnl ?? null);
const marginBalance = computed(() => account.value?.marginBalance ?? null);
const totalMargin = computed(() => account.value?.totalMargin ?? null);

// Portfolio computed
const allTimePnl = computed(() => portfolio.value?.allTimePnl ?? null);
const realizedPnl = computed(() => portfolio.value?.realizedPnl ?? null);
const allTimeVolume = computed(() => portfolio.value?.allTimeVolume ?? null);
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
