import { getCurrentScope, onScopeDispose, ref, watch, type Ref } from 'vue';
import marketApi, {
  pendingRetryDelayMs,
  WALLET_PENDING_MAX_WAIT_MS,
  type WalletPnlSummary,
  type WalletPnlToken,
} from '@/api/market-api';
import { walletStore } from '@/stores/walletStore';

const pnlSummary: Ref<WalletPnlSummary | null> = ref(null);
const pnlByUnit = ref<Record<string, WalletPnlToken>>({});
const pnlLoading = ref(false);
const pnlError: Ref<string | null> = ref(null);
// The wallet's full history is still being fetched upstream (202 PENDING): there is no P&L to
// show yet, which is different from a wallet with no P&L.
const pnlPending = ref(false);

// Only the latest request may write state. A pending answer is asked again after the
// server's hint while any component still uses this composable, for up to
// WALLET_PENDING_MAX_WAIT_MS per wallet.
let requestSeq = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSince: number | null = null;
let consumers = 0;

function clearRetry() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}

// Auto-refetch when wallet changes
watch(() => walletStore.loggedWallet?.stakeAddress, (addr) => {
  clearRetry();
  pendingSince = null;
  pnlPending.value = false;
  if (addr) fetchPnl();
});

function setPnl(data: WalletPnlSummary | null) {
  pnlSummary.value = data;
  // Build lookup by unit for fast access in table
  const lookup: Record<string, WalletPnlToken> = {};
  for (const t of data?.tokens ?? []) {
    lookup[t.unit] = t;
  }
  pnlByUnit.value = lookup;
}

function scheduleRetry(retryAfterSeconds: number) {
  if (consumers === 0) return;
  pendingSince ??= Date.now();
  const delay = pendingRetryDelayMs(retryAfterSeconds);
  // Past the cap the P&L stays pending; the next visit asks again.
  if (Date.now() - pendingSince + delay > WALLET_PENDING_MAX_WAIT_MS) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void fetchPnl();
  }, delay);
}

async function fetchPnl() {
  const stakeAddress = walletStore.loggedWallet?.stakeAddress;
  if (!stakeAddress) return;

  clearRetry();
  const seq = ++requestSeq;
  pnlLoading.value = true;
  pnlError.value = null;

  try {
    const result = await marketApi.getWalletPnl(stakeAddress);
    if (seq !== requestSeq || walletStore.loggedWallet?.stakeAddress !== stakeAddress) return;

    if (result.state === 'pending') {
      setPnl(null);
      pnlPending.value = true;
      scheduleRetry(result.retryAfterSeconds);
      return;
    }

    const data = result.data;
    pnlPending.value = false;
    pendingSince = null;

    // Sort tokens by current value (most allocated first)
    if (data?.tokens) {
      data.tokens.sort((a, b) => {
        const valA = Math.abs(a.currentQuantity * a.currentPriceAda);
        const valB = Math.abs(b.currentQuantity * b.currentPriceAda);
        return valB - valA;
      });
    }

    setPnl(data);
  } catch (err: unknown) {
    if (seq !== requestSeq) return;
    const message = err instanceof Error ? err.message : '';
    console.debug('Wallet P&L fetch error:', message || err);
    pnlError.value = message || 'Failed to load P&L data';
    pnlPending.value = false;
    pendingSince = null;
  } finally {
    if (seq === requestSeq) pnlLoading.value = false;
  }
}

export function useWalletPnl() {
  if (getCurrentScope()) {
    consumers++;
    onScopeDispose(() => {
      consumers--;
      if (consumers === 0) clearRetry();
    });
  }

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
    pnlPending,
    fetchPnl,
    getTokenPnl,
    getTotalPnl,
  };
}
