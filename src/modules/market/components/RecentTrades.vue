<template>
  <div class="recent-trades">
    <!-- Header -->
    <div class="d-flex align-center mb-2">
      <span class="text-caption text--secondary font-weight-medium">{{ $t('market.recentTrades') }}</span>
      <v-spacer />
      <!-- New trades indicator -->
      <v-chip
        v-if="newTradeCount > 0 && !autoRefresh"
        x-small
        color="error"
        class="mr-2"
        @click="loadTrades"
      >
        {{ newTradeCount }} {{ $t('market.newTrades').replace('{count}', '') }}
        <v-icon x-small class="ml-1">mdi-refresh</v-icon>
      </v-chip>
      <!-- Auto-refresh toggle -->
      <v-tooltip bottom :open-delay="300" content-class="custom-tooltip">
        <template v-slot:activator="{ on, attrs }">
          <v-btn
            icon
            x-small
            v-bind="attrs"
            v-on="on"
            :color="autoRefresh ? 'primary' : ''"
            @click="autoRefresh = !autoRefresh"
          >
            <v-icon x-small>{{ autoRefresh ? 'mdi-sync' : 'mdi-sync-off' }}</v-icon>
          </v-btn>
        </template>
        <span>{{ $t('market.autoRefresh') }}</span>
      </v-tooltip>
    </div>

    <!-- Loading -->
    <div v-if="loading && trades.length === 0" class="d-flex justify-center py-4">
      <v-progress-circular indeterminate size="20" color="primary" />
    </div>

    <!-- Empty state -->
    <div v-else-if="trades.length === 0" class="text-center py-4 text--secondary text-caption">
      {{ $t('market.na') }}
    </div>

    <!-- Trades table -->
    <template v-else>
      <div class="trades-header">
        <span>{{ $t('market.time') }}</span>
        <span>{{ $t('market.type') }}</span>
        <span class="text-right">{{ $t('market.price') }} ({{ currencySymbol }})</span>
        <span class="text-right">Vol ({{ currencySymbol }})</span>
      </div>
      <div class="trades-body">
        <div
          v-for="(trade, i) in trades"
          :key="trade.txHash + i"
          class="trade-row"
          :class="{ 'new-trade': trade.isNew, 'own-trade': trade.isOwn }"
        >
          <span class="trade-time">
            {{ formatTime(trade.blockTime) }}
            <v-tooltip v-if="trade.isOwn" bottom :open-delay="400" content-class="custom-tooltip">
              <template v-slot:activator="{ on, attrs }">
                <v-icon x-small color="primary" class="ml-1" style="vertical-align: middle" v-bind="attrs" v-on="on">mdi-account</v-icon>
              </template>
              <span>{{ $t('market.yourTrade') }}</span>
            </v-tooltip>
          </span>
          <span
            class="trade-type"
            :style="{ color: trade.type === 'BUY' ? '#47CD89' : '#F97066' }"
          >{{ trade.type === 'BUY' ? $t('market.buy') : $t('market.sell') }}</span>
          <span class="text-right">{{ formatTradePrice(trade.priceAda) }}</span>
          <span class="text-right">{{ formatCompact(trade.volumeAda) }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import marketApi, { type SwapHistory } from '@/api/market-api';
import { walletStore } from '@/stores/walletStore';
import { useNativeCurrency } from '@/modules/market/composables/useNativeCurrency';
import timeAgo from '@/plugins/time';

const { currencySymbol } = useNativeCurrency();

const props = defineProps<{
  policyId: string;
  assetName: string;
}>();

interface TradeRow extends SwapHistory {
  isNew: boolean;
  isOwn: boolean;
}

// Build a Set of the user's tx hashes for fast lookup
const ownTxHashes = computed(() => {
  const txs = walletStore.transactions;
  if (!txs?.length) return new Set<string>();
  return new Set(txs.map((tx: { id?: string }) => tx.id).filter(Boolean));
});

// Backend `type` is token-perspective (BUY = user bought the token); render as-is.
// Do NOT invert — see @/modules/market/utils/tradeSide.ts for the ground truth.
const trades = ref<TradeRow[]>([]);
const loading = ref(false);
const autoRefresh = ref(false);
const newTradeCount = ref(0);
const lastSeenTime = ref('');
let pollInterval: ReturnType<typeof setInterval> | null = null;

async function loadTrades() {
  if (!props.policyId || !props.assetName) return;
  loading.value = true;
  try {
    const result = await marketApi.getTokenSwaps(props.policyId, props.assetName, 20);
    const hashes = ownTxHashes.value;
    const newTrades = result.map(t => ({
      ...t,
      isNew: lastSeenTime.value ? t.blockTime > lastSeenTime.value : false,
      isOwn: hashes.has(t.txHash),
    }));
    trades.value = newTrades;
    newTradeCount.value = 0;
    if (result.length > 0) {
      lastSeenTime.value = result[0].blockTime;
    }
  } catch (err) {
    console.warn('RecentTrades: Failed to load trades', err);
  } finally {
    loading.value = false;
  }
}

async function checkForNewTrades() {
  if (!props.policyId || !props.assetName) return;
  try {
    const result = await marketApi.getTokenSwaps(props.policyId, props.assetName, 5);
    if (result.length > 0 && lastSeenTime.value) {
      const newOnes = result.filter(t => t.blockTime > lastSeenTime.value);
      if (newOnes.length > 0) {
        if (autoRefresh.value) {
          await loadTrades();
        } else {
          newTradeCount.value = newOnes.length;
        }
      }
    }
  } catch { /* silent poll failure */ }
}

function startPolling() {
  stopPolling();
  pollInterval = setInterval(checkForNewTrades, 15_000);
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

function formatTime(blockTime: string | number): string {
  try {
    // blockTime may be a Unix timestamp (seconds) — detect and convert to ms
    let ts: number;
    if (typeof blockTime === 'number') {
      ts = blockTime < 1e12 ? blockTime * 1000 : blockTime;
    } else {
      const parsed = Number(blockTime);
      if (!isNaN(parsed) && parsed > 0) {
        ts = parsed < 1e12 ? parsed * 1000 : parsed;
      } else {
        ts = new Date(blockTime).getTime();
      }
    }
    if (isNaN(ts)) return blockTime as string;
    return timeAgo.format(new Date(ts));
  } catch {
    return String(blockTime);
  }
}

function formatTradePrice(price: number | null | undefined): string {
  // The swaps API can return a null priceAda for some trades; guard so the
  // render doesn't throw on .toFixed of null.
  if (price == null || !Number.isFinite(price)) return '—';
  if (price >= 1) return price.toFixed(4);
  if (price >= 0.01) return price.toFixed(6);
  return price.toFixed(8);
}

function formatCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value >= 1e6) return (value / 1e6).toFixed(1) + 'M';
  if (value >= 1e3) return (value / 1e3).toFixed(1) + 'K';
  if (value >= 1) return value.toFixed(1);
  return value.toFixed(2);
}

watch(autoRefresh, (enabled) => {
  if (enabled) {
    loadTrades();
  }
});

watch([() => props.policyId, () => props.assetName], () => {
  lastSeenTime.value = '';
  newTradeCount.value = 0;
  loadTrades();
});

onMounted(() => {
  loadTrades();
  startPolling();
});

onBeforeUnmount(() => {
  stopPolling();
});
</script>

<style scoped>
.recent-trades {
  width: 100%;
}

.trades-header {
  display: grid;
  grid-template-columns: 1fr 0.6fr 1fr 1fr;
  gap: 4px;
  padding: 4px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
}

.trades-body {
  max-height: 400px;
  overflow-y: auto;
  padding-right: 6px;
}

.trade-row {
  display: grid;
  grid-template-columns: 1fr 0.6fr 1fr 1fr;
  gap: 4px;
  padding: 3px 0;
  font-size: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
  transition: background 0.2s;
}

.trade-row:hover {
  background: rgba(255, 255, 255, 0.03);
}

.trade-row.new-trade {
  animation: fadeHighlight 2s ease-out;
}

@keyframes fadeHighlight {
  0% { background: rgba(38, 250, 176, 0.15); }
  100% { background: transparent; }
}

.trade-time {
  color: rgba(255, 255, 255, 0.5);
}

.trade-type {
  font-weight: 600;
  text-transform: uppercase;
  font-size: 11px;
}

.trade-row.own-trade {
  background: rgba(38, 165, 250, 0.06);
}

.trade-row.own-trade .trade-time {
  position: relative;
}

.trade-row.own-trade .trade-time .v-icon {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  margin-left: 2px;
}
</style>
