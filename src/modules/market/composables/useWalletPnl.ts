import { ref, type Ref } from 'vue';
import marketApi, { type WalletPnlSummary, type WalletPnlToken } from '@/api/market-api';
import { walletStore } from '@/stores/walletStore';

const pnlSummary: Ref<WalletPnlSummary | null> = ref(null);
const pnlByUnit = ref<Record<string, WalletPnlToken>>({});
const pnlLoading = ref(false);
const pnlError: Ref<string | null> = ref(null);

async function fetchPnl() {
  const stakeAddress = walletStore.loggedWallet?.stakeAddress;
  if (!stakeAddress) return;

  pnlLoading.value = true;
  pnlError.value = null;

  try {
    const data = await marketApi.getWalletPnl(stakeAddress);

    // Sort tokens by current value (most allocated first)
    if (data?.tokens) {
      data.tokens.sort((a, b) => {
        const valA = Math.abs(a.currentQuantity * a.currentPriceAda);
        const valB = Math.abs(b.currentQuantity * b.currentPriceAda);
        return valB - valA;
      });
    }

    pnlSummary.value = data;

    // Build lookup by unit for fast access in table
    const lookup: Record<string, WalletPnlToken> = {};
    if (data?.tokens) {
      for (const t of data.tokens) {
        lookup[t.unit] = t;
      }
    }
    pnlByUnit.value = lookup;
  } catch (err: any) {
    console.error('Wallet P&L fetch error:', err);
    pnlError.value = err?.message || 'Failed to load P&L data';
  } finally {
    pnlLoading.value = false;
  }
}

export function useWalletPnl() {
  function getTokenPnl(unit: string): WalletPnlToken | null {
    return pnlByUnit.value[unit] ?? null;
  }

  function getTotalPnl(unit: string): number | null {
    const t = pnlByUnit.value[unit];
    if (!t) return null;
    return t.realizedPnlAda + t.unrealizedPnlAda;
  }

  return {
    pnlSummary,
    pnlByUnit,
    pnlLoading,
    pnlError,
    fetchPnl,
    getTokenPnl,
    getTotalPnl,
  };
}
