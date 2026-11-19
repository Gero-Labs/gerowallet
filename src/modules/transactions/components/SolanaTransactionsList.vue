<template>
  <!-- History tab's Solana leaf, beside SolanaTransactionDetails.vue in Transactions.vue.
       Rows are Gero Sync's history (walletStore.solanaTransactions) plus older pages
       read from Nexus on demand when Gero Sync reported more than it sent. -->
  <v-card flat class="glass-panel sol-tx-list">
    <div class="sol-tx-list__head">
      <span class="sol-tx-list__title">
        {{ $t('transactions.history') }} (<span class="g-num">{{ history.length }}</span>)
      </span>
      <v-text-field
        v-model="searchInput"
        density="compact"
        variant="solo"
        hide-details
        clearable
        :placeholder="$t('common.search')"
        prepend-inner-icon="mdi-magnify"
        class="sol-tx-list__search"
      />
    </div>

    <p v-if="!history.length" class="t-caption sol-tx-list__empty">{{ $t('solana.noActivity') }}</p>
    <p v-else-if="!rows.length" class="t-caption sol-tx-list__empty">{{ $t('transactions.noTransactionsFound') }}</p>

    <ul v-else class="sol-tx-list__rows">
      <li v-for="tx in rows" :key="tx.signature">
        <button
          type="button"
          :class="['sol-tx-row', { 'sol-tx-row--selected selected-transaction': tx.signature === selectedSignature }]"
          :aria-pressed="tx.signature === selectedSignature ? 'true' : 'false'"
          @click="emit('row-click', tx)"
        >
          <TxGlyph :icon="TX_KIND_ICON[kindOf(tx)]" :tone="TX_KIND_TONE[kindOf(tx)]" />
          <span class="sol-tx-row__main">
            <span class="g-mono sol-tx-row__sig" :title="tx.signature">{{ shortSignature(tx.signature) }}</span>
            <span class="t-caption g-num">{{ tx.blockTime ? formatTime(tx.blockTime) : $t('solana.pending') }}</span>
          </span>
          <span v-if="!tx.success" class="sol-tx-row__failed t-caption">{{ $t('transactions.failed') }}</span>
        </button>
      </li>
    </ul>

    <div v-if="canLoadOlder" class="sol-tx-list__more">
      <p v-if="loadError" class="t-caption sol-tx-list__error" role="alert">{{ $t('solana.loadOlderFailed') }}</p>
      <GButton tier="secondary" compact :loading="loading" @click="loadOlder()">
        {{ loadError ? $t('common.tryAgain') : $t('common.loadMore') }}
      </GButton>
    </div>
  </v-card>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import TxGlyph from '@/modules/transactions/components/TxGlyph.vue';
import { walletStore } from '@/stores/walletStore';
import { TX_KIND_ICON, TX_KIND_TONE, type TxKind } from '@/modules/dashboard/utils/transactionClassifier';
import type { SolanaTransaction } from '@/chains/solana/solanaWireSync';
import {
  SOLANA_HISTORY_PAGE,
  mergeSolanaHistory,
  searchSolanaHistory,
  solanaHistoryFromNexus,
} from '@/chains/solana/solanaHistory';
import { debugLog } from '@/utils/debug';

const props = defineProps<{ selectedTransaction?: SolanaTransaction | null }>();
const emit = defineEmits<{ 'row-click': [tx: SolanaTransaction] }>();

const address = computed(() => walletStore.loggedWallet?.publicKey ?? '');
const network = computed(() => walletStore.loggedWallet?.network ?? '');

/** Older pages read from Nexus; dropped when the wallet changes. */
const older = ref<SolanaTransaction[]>([]);
/** false once Nexus returned a short page: nothing older is left. */
const moreOnNexus = ref(true);
const loading = ref(false);
const loadError = ref(false);

watch([address, network], () => {
  older.value = [];
  moreOnNexus.value = true;
  loadError.value = false;
});

const history = computed(() => mergeSolanaHistory(walletStore.solanaTransactions ?? [], older.value));

const searchInput = ref<string | null>('');
const rows = computed(() => searchSolanaHistory(history.value, searchInput.value));

const selectedSignature = computed(() => props.selectedTransaction?.signature ?? '');

// Only when Gero Sync said it held back older history; never while searching.
const canLoadOlder = computed(() =>
  !!walletStore.solana?.historyTruncated && moreOnNexus.value && !!address.value && !(searchInput.value ?? '').trim(),
);

async function loadOlder(): Promise<void> {
  if (loading.value) return;
  const oldest = history.value[history.value.length - 1];
  const forAddress = address.value;
  loading.value = true;
  loadError.value = false;
  try {
    const { SolanaApi } = await import('@/api/solana-api');
    const page = await new SolanaApi(network.value).getSignatures(forAddress, {
      before: oldest?.signature,
      limit: SOLANA_HISTORY_PAGE,
    });
    if (forAddress !== address.value) return; // the wallet changed meanwhile
    older.value = mergeSolanaHistory(older.value, solanaHistoryFromNexus(page));
    if (!Array.isArray(page) || page.length < SOLANA_HISTORY_PAGE) moreOnNexus.value = false;
  } catch (error) {
    debugLog('SolanaTransactionsList', 'older history read failed', (error as Error)?.message);
    loadError.value = true;
  } finally {
    loading.value = false;
  }
}

function kindOf(tx: SolanaTransaction): TxKind {
  if (!tx.success) return 'failed';
  if (!tx.blockTime) return 'pending';
  return 'neutral';
}

function shortSignature(signature: string): string {
  return signature.length > 24 ? `${signature.slice(0, 10)}…${signature.slice(-10)}` : signature;
}

function formatTime(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString();
}
</script>

<style scoped>
.sol-tx-list {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding: var(--g-s-4);
  min-height: 0;
}

.sol-tx-list__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
}

.sol-tx-list__title {
  font-weight: 600;
  white-space: nowrap;
}

.sol-tx-list__search {
  max-width: 260px;
}

.sol-tx-list__empty {
  color: var(--g-text-3);
}

.sol-tx-list__rows {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
  overflow-y: auto;
}

.sol-tx-row {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  width: 100%;
  padding: var(--g-s-2) var(--g-s-3);
  border-radius: var(--g-r-control);
  color: inherit;
  text-align: left;
  transition: background var(--g-dur-fast) ease;
}

.sol-tx-row:hover,
.sol-tx-row--selected {
  background: var(--g-hairline-1);
}

.sol-tx-row--selected {
  box-shadow: inset 0 0 0 1px var(--g-hairline-3);
}

.sol-tx-row__main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.sol-tx-row__sig {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sol-tx-row__failed {
  color: var(--g-error);
}

.sol-tx-list__more {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--g-s-2);
}

.sol-tx-list__error {
  color: var(--g-error);
}
</style>
