<template>
  <div class="activity-page">
    <!-- Midnight: history from midnightStore (walletStore.transactions is
         Cardano-only). Same row styling, Midnight tx semantics. -->
    <template v-if="isMidnight">
      <div v-if="midnightTxs.length === 0" class="empty-state">
        <v-icon size="56" color="var(--g-text-3)">mdi-history</v-icon>
        <div class="text-body-1 white--text mt-3">{{ $t('miniGero.noTransactions') }}</div>
      </div>
      <div v-else class="tx-list">
        <div
          v-for="tx in midnightTxs"
          :key="tx.hash"
          class="tx-item"
        >
          <div class="tx-icon-wrapper" :class="tx.type === 'receive' ? 'icon-receive' : 'icon-send'">
            <v-icon size="18" color="white">
              {{ tx.type === 'receive' ? 'mdi-arrow-bottom-left' : tx.type === 'register_dust' ? 'mdi-shield-star' : 'mdi-arrow-top-right' }}
            </v-icon>
          </div>
          <div class="tx-info">
            <div class="tx-title white--text text-body-2">{{ midnightTxLabel(tx) }}</div>
            <div class="tx-time text-caption grey--text">{{ formatTimestamp(tx.timestamp) }}</div>
          </div>
          <div class="tx-amount-col text-right">
            <div
              class="text-body-2 font-weight-medium"
              :class="tx.type === 'receive' ? 'accent-text' : 'error-text'"
            >
              {{ formatMidnightAmount(tx) }}
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Loading skeleton -->
    <div v-else-if="loading" class="pa-4">
      <v-skeleton-loader v-for="i in 6" :key="i" type="list-item-two-line" dark class="mb-2" />
    </div>

    <!-- Empty state -->
    <div v-else-if="groupedTransactions.length === 0" class="empty-state">
      <v-icon size="56" color="var(--g-text-3)">mdi-history</v-icon>
      <div class="text-body-1 white--text mt-3">{{ $t('miniGero.noTransactions') }}</div>
      <div class="text-caption grey--text mt-1">{{ $t('miniGero.noTransactionsDesc') }}</div>
    </div>

    <!-- Transaction list grouped by date -->
    <div v-else class="tx-list">
      <div v-for="group in groupedTransactions" :key="group.label" class="tx-group">
        <div class="t-label px-4 pt-3 pb-1">{{ group.label }}</div>
        <div
          v-for="tx in group.transactions"
          :key="tx.id"
          class="tx-item"
          @click="openTxDetail(tx)"
        >
          <div class="tx-icon-wrapper" :class="getTxIconClass(tx)">
            <v-icon size="18" color="white">{{ getTxIcon(tx) }}</v-icon>
          </div>
          <div class="tx-info">
            <div class="tx-title white--text text-body-2">{{ getTxLabel(tx) }}</div>
            <div class="tx-time text-caption grey--text">{{ formatTimestamp(tx.tx_timestamp) }}</div>
          </div>
          <div class="tx-amount-col text-right">
            <div
              class="text-body-2 font-weight-medium"
              :class="Number(tx.ada) >= 0 ? 'accent-text' : 'error-text'"
            >
              {{ Number(tx.ada) >= 0 ? '+' : '' }}{{ formatAda(tx.ada) }}
            </div>
            <div v-if="tx.pending" class="text-caption warning--text">Pending</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Transaction detail sheet -->
    <TxDetailSheet v-model="showTxDetail" :tx="selectedTx" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { midnightStore } from '@/stores/midnightStore';
import { Blockchain, Network } from '@/models/types';
import { MIDNIGHT_DECIMALS } from '@/chains/midnight/midnightTypes';
import type { MidnightTransaction } from '@/chains/midnight/midnightTypes';
import filters from '@/shared/utils/filters';
import TxDetailSheet from '../components/flows/TxDetailSheet.vue';
import { useTranslation } from '@/shared/composables/useTranslation';

const { t } = useTranslation();

const showTxDetail = ref(false);
const selectedTx = ref<any>(null);

const loading = computed(() => !walletStore.transactions);

// ── Midnight branch ───────────────────────────────────────────────────────────
const isMidnight = computed(() => walletStore.loggedWallet?.chain === Blockchain.MIDNIGHT);
const isMidnightMainnet = computed(() => isMidnight.value && walletStore.loggedWallet?.network === Network.MAINNET);
const MN_NIGHT_DIVISOR = 10n ** BigInt(MIDNIGHT_DECIMALS.NIGHT);
const MN_DUST_DIVISOR = 10n ** BigInt(MIDNIGHT_DECIMALS.DUST);

const midnightTxs = computed<MidnightTransaction[]>(() =>
  [...midnightStore.transactions].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0)));

function midnightTxLabel(tx: MidnightTransaction): string {
  switch (tx.type) {
    case 'send': return t('transactions.sent');
    case 'receive': return t('transactions.received');
    case 'register_dust': return t('midnight.txRegisterDust');
    case 'deregister_dust': return t('midnight.txDeregisterDust');
    case 'shield': return t('midnight.txShield');
    case 'unshield': return t('midnight.txUnshield');
    default: return t('transactions.transaction');
  }
}

function formatMidnightAmount(tx: MidnightTransaction): string {
  const divisor = tx.token === 'NIGHT' ? MN_NIGHT_DIVISOR : MN_DUST_DIVISOR;
  const digits = tx.token === 'NIGHT' ? 2 : 4;
  const whole = tx.amount / divisor;
  const frac = (tx.amount % divisor).toString().padStart(divisor.toString().length - 1, '0').slice(0, digits);
  const base = tx.token === 'DUST' ? 'DUST' : 'NIGHT';
  const ticker = isMidnightMainnet.value ? base : `t${base}`;
  const sign = tx.type === 'receive' ? '+' : tx.type === 'send' ? '−' : '';
  return `${sign}${whole.toLocaleString('en-US')}.${frac} ${ticker}`;
}

interface TxGroup {
  label: string;
  transactions: any[];
}

const groupedTransactions = computed<TxGroup[]>(() => {
  const txs = walletStore.transactions;
  if (!txs || txs.length === 0) return [];

  // Sort by timestamp descending
  const sorted = [...txs].sort((a, b) => b.tx_timestamp - a.tx_timestamp);

  const groups: Map<string, any[]> = new Map();
  const now = new Date();
  const todayStr = now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toDateString();

  for (const tx of sorted) {
    const date = new Date(tx.tx_timestamp * 1000);
    const dateStr = date.toDateString();

    let label: string;
    if (dateStr === todayStr) {
      label = t('miniGero.today');
    } else if (dateStr === yesterdayStr) {
      label = t('miniGero.yesterday');
    } else {
      label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    if (!groups.has(label)) {
      groups.set(label, []);
    }
    groups.get(label)!.push(tx);
  }

  return Array.from(groups.entries()).map(([label, transactions]) => ({
    label,
    transactions,
  }));
});

function getTxIcon(tx: any): string {
  const adaAmount = Number(tx.ada);
  if (tx.body?.certificates?.length > 0) return 'mdi-vote';
  if (adaAmount > 0) return 'mdi-arrow-bottom-left';
  if (adaAmount < 0) return 'mdi-arrow-top-right';
  // Token-only
  const hasReceivedTokens = tx.assets?.some((a: any) => a.unit !== 'lovelace' && a.quantity > 0);
  if (hasReceivedTokens) return 'mdi-arrow-bottom-left';
  return 'mdi-arrow-top-right';
}

function getTxIconClass(tx: any): string {
  const adaAmount = Number(tx.ada);
  if (tx.body?.certificates?.length > 0) return 'icon-stake';
  if (adaAmount > 0) return 'icon-receive';
  if (adaAmount < 0) return 'icon-send';
  const hasReceivedTokens = tx.assets?.some((a: any) => a.unit !== 'lovelace' && a.quantity > 0);
  if (hasReceivedTokens) return 'icon-receive';
  return 'icon-send';
}

function getTxLabel(tx: any): string {
  if (tx.body?.certificates?.length > 0) {
    return 'Staking Operation';
  }
  const adaAmount = Number(tx.ada);
  const hasSentTokens = tx.assets?.some((a: any) => a.unit !== 'lovelace' && a.quantity < 0);
  const hasReceivedTokens = tx.assets?.some((a: any) => a.unit !== 'lovelace' && a.quantity > 0);

  if (adaAmount > 0 && hasReceivedTokens) return t('transactions.receivedFundsAndTokens');
  if (adaAmount < 0 && hasSentTokens) return t('transactions.sentFundsAndTokens');
  if (adaAmount > 0) return t('transactions.receivedFunds');
  if (adaAmount < 0) return t('transactions.sentFunds');
  if (hasReceivedTokens) return t('transactions.receivedTokens');
  if (hasSentTokens) return t('transactions.sentTokens');
  return 'Transaction';
}

function formatAda(lovelace: number | string): string {
  return filters.toCurrency(Number(lovelace));
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function openTxDetail(tx: any) {
  selectedTx.value = tx;
  showTxDetail.value = true;
}
</script>

<style scoped>
.activity-page {
  min-height: 100%;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 24px;
}

.tx-list {
  padding-bottom: 16px;
}

.tx-item {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  cursor: pointer;
  transition: background 0.15s;
}

.tx-item:hover {
  background: var(--g-raised);
}

.tx-item:active {
  background: var(--g-overlay);
}

.tx-icon-wrapper {
  width: 36px;
  height: 36px;
  border-radius: var(--g-r-control);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 12px;
  flex-shrink: 0;
}

.icon-receive {
  background: color-mix(in srgb, var(--g-accent) 15%, transparent);
}

.icon-send {
  background: var(--g-error-fill);
}

.icon-stake {
  background: color-mix(in srgb, var(--g-info) 15%, transparent);
}

.tx-info {
  flex: 1;
  min-width: 0;
}

.tx-title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tx-amount-col {
  flex-shrink: 0;
  margin-left: 8px;
}

.accent-text {
  color: var(--g-accent);
}

.error-text {
  color: var(--g-error);
}
</style>
