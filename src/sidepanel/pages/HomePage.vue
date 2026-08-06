<template>
  <div class="home-page">
    <!-- Fresh mainnet wallet: market-first empty state, mirroring the
         dashboard's PortfolioPage empty mode with the exact same components.
         Buy/Receive/Swap wire to the sidepanel's native sheets; perps routes
         to the mini perps page. -->
    <template v-if="isEmptyMainnet">
      <div class="empty-stack">
        <div class="empty-stack__chart">
          <AdaPriceHeroCard />
        </div>
        <FundingCard @buy="showBuySell = true" @receive="showReceive = true" />
        <!-- No Gero Card in the panel, and cashback opens in the full wallet —
             the panel's router carries neither path. -->
        <PerkTeasers
          :exclude="['card']"
          :external="['cashback']"
          @swap="showSwap = true"
          @perps="router.push('/perps')"
        />
      </div>
    </template>

    <template v-else>
      <BalanceSection @buy-sell="handleBuySell" />

      <QuickActions @action="handleAction" />

      <!-- Midnight: compact DUST battery replaces the (Cardano-centric) carousel -->
      <MiniDustGauge v-if="isMidnight" />
      <MiniProofServerWidget v-if="isMidnight" />
      <FeaturedCarousel v-else />

      <div class="section-header">
        <span class="text-subtitle-2 white--text font-weight-bold">
          {{ $t('miniGero.tokens') }}
        </span>
        <span v-if="tokenCount > 0" class="text-caption grey--text">
          {{ tokenCount }}
        </span>
      </div>

      <TokenList @select="handleTokenSelect" />
    </template>

    <!-- Flow sheets -->
    <SendSheet v-model="showSend" />
    <MidnightSendSheet v-model="showMidnightSend" />
    <ReceiveSheet v-model="showReceive" />
    <SwapSheet v-model="showSwap" />
    <BuySellSheet v-model="showBuySell" />
    <!-- Token Detail Bottom Sheet -->
    <BottomSheet
      :value="showTokenDetail"
      @input="showTokenDetail = $event"
      :title="selectedToken?.ticker || selectedToken?.name || ''"
      height="70%"
    >
      <div v-if="selectedToken" class="token-detail">
        <div class="detail-header">
          <v-avatar size="48" class="mb-3">
            <img
              v-if="selectedToken.img"
              :src="selectedToken.img"
              :alt="selectedToken.ticker || selectedToken.name"
            />
            <v-icon v-else size="28" color="var(--g-text-3)">mdi-circle-outline</v-icon>
          </v-avatar>
          <div class="text-h6 white--text font-weight-bold">
            {{ selectedToken.ticker || selectedToken.name }}
          </div>
          <div class="text-body-2 grey--text" v-if="selectedToken.price">
            {{ formatPrice(selectedToken.price) }}
            <span
              v-if="selectedToken.change !== null && selectedToken.change !== undefined"
              :class="selectedToken.change >= 0 ? 'green-text' : 'red-text'"
              class="ml-1"
            >
              {{ selectedToken.change >= 0 ? '+' : '' }}{{ selectedToken.change.toFixed(2) }}%
            </span>
          </div>
        </div>

        <v-divider dark class="my-4" />

        <!-- Holdings -->
        <div class="detail-row">
          <span class="text-caption grey--text">{{ $t('miniGero.balance') }}</span>
          <span class="text-body-2 white--text">{{ formatDetailAmount(selectedToken) }}</span>
        </div>
        <div class="detail-row" v-if="selectedToken.price">
          <span class="text-caption grey--text">{{ $t('miniGero.value') }}</span>
          <span class="text-body-2 white--text">{{ formatDetailValue(selectedToken) }}</span>
        </div>

        <!-- Market data (from useMarketData) -->
        <template v-if="marketDetail">
          <div class="detail-row" v-if="marketDetail.mcap">
            <span class="text-caption grey--text">{{ $t('miniGero.marketCap') }}</span>
            <span class="text-body-2 white--text">{{ formatCompact(marketDetail.mcap) }}</span>
          </div>
          <div class="detail-row" v-if="marketDetail.volume24h">
            <span class="text-caption grey--text">{{ $t('miniGero.volume24h') }}</span>
            <span class="text-body-2 white--text">{{ formatCompact(marketDetail.volume24h) }}</span>
          </div>
          <div class="detail-row" v-if="marketDetail.tvl">
            <span class="text-caption grey--text">{{ $t('miniGero.tvl') }}</span>
            <span class="text-body-2 white--text">{{ formatCompact(marketDetail.tvl) }}</span>
          </div>
          <div class="detail-row" v-if="marketDetail.holders">
            <span class="text-caption grey--text">{{ $t('miniGero.holders') }}</span>
            <span class="text-body-2 white--text">{{ marketDetail.holders.toLocaleString('en-US') }}</span>
          </div>
          <div class="detail-row" v-if="!marketDetail.isNative && marketDetail.priceAda">
            <span class="text-caption grey--text">{{ $t('miniGero.priceInAda') }}</span>
            <span class="text-body-2 white--text">{{ formatAdaPrice(marketDetail.priceAda) }}</span>
          </div>
        </template>
      </div>
    </BottomSheet>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router/composables';
import { walletStore } from '@/stores/walletStore';
import { Blockchain, Network } from '@/models/types';
import { useMarketData } from '@/modules/market/composables/useMarketData';
import { useAdaLovelace } from '../composables/useAdaLovelace';
import AdaPriceHeroCard from '@/modules/portfolio/components/AdaPriceHeroCard.vue';
import FundingCard from '@/modules/portfolio/components/FundingCard.vue';
import PerkTeasers from '@/modules/portfolio/components/PerkTeasers.vue';
import BalanceSection from '../components/BalanceSection.vue';
import QuickActions from '../components/QuickActions.vue';
import FeaturedCarousel from '../components/FeaturedCarousel.vue';
import MiniDustGauge from '../components/MiniDustGauge.vue';
import MiniProofServerWidget from '../components/MiniProofServerWidget.vue';
import TokenList from '../components/TokenList.vue';
import BottomSheet from '../components/BottomSheet.vue';
import SendSheet from '../components/flows/SendSheet.vue';
import MidnightSendSheet from '../components/flows/MidnightSendSheet.vue';
import ReceiveSheet from '../components/flows/ReceiveSheet.vue';
import SwapSheet from '../components/flows/SwapSheet.vue';
import BuySellSheet from '../components/flows/BuySellSheet.vue';
const router = useRouter();
const { getTokenByUnit } = useMarketData();
const { adaLovelace } = useAdaLovelace();

const showSend = ref(false);
const showMidnightSend = ref(false);
const showReceive = ref(false);
const showSwap = ref(false);
const showBuySell = ref(false);
const showTokenDetail = ref(false);
// Token rows emitted by TokenList: wallet token enriched with display fields.
interface HomeTokenRow {
  unit?: string;
  ticker?: string;
  name?: string;
  img?: string;
  price?: number;
  change?: number | null;
  quantity?: number | string;
  decimals?: number;
}

const selectedToken = ref<HomeTokenRow | null>(null);

const isMidnight = computed(() => walletStore.loggedWallet?.chain === Blockchain.MIDNIGHT);

// Mirrors the dashboard's isEmptyMainnet exactly (mini-gero must mirror the
// dashboard, never approximate): mainnet Cardano whose account row is absent
// (never-used address) or confirms a zero balance.
const isEmptyMainnet = computed(() =>
  walletStore.loggedWallet?.chain === Blockchain.CARDANO &&
  walletStore.loggedWallet?.network === Network.MAINNET &&
  (!walletStore.account || walletStore.account?.controlled_amount === '0'));

// Count verified, non-scam, non-ADA tokens.
const ftCount = computed(() => {
  const tokens = walletStore.tokens;
  if (!tokens) return 0;
  return Object.values(tokens).filter((t: { policy_id?: string; isScam?: boolean; verified?: boolean }) => {
    if (t.policy_id === '') return false;
    if (t.isScam) return false;
    if (!t.verified) return false;
    return true;
  }).length;
});

// Midnight shows NIGHT + DUST rows. For Cardano, match TokenList: a truly empty
// wallet (0 ADA, no tokens) shows no rows, so the header count is 0 (hidden).
// Otherwise ADA is pinned → +1.
const tokenCount = computed(() => {
  if (isMidnight.value) return 2; // NIGHT + DUST rows
  if (adaLovelace.value === 0 && ftCount.value === 0) return 0;
  return ftCount.value + 1; // +1 for ADA
});

function handleBuySell() {
  showBuySell.value = true;
}

function handleAction(id: string) {
  // Midnight send/receive are both native in the sidepanel now: MidnightSendSheet
  // (unshielded NIGHT only, mirrors MidnightSendDialog.vue) and ReceiveSheet
  // (Public/Private/DUST address tabs).
  switch (id) {
    case 'send':
      if (isMidnight.value) {
        showMidnightSend.value = true;
      } else {
        showSend.value = true;
      }
      break;
    case 'receive':
      showReceive.value = true;
      break;
    case 'perps':
      router.push('/perps');
      break;
  }
}

function handleTokenSelect(token: HomeTokenRow) {
  selectedToken.value = token;
  showTokenDetail.value = true;
}

// Look up market data for the selected token
const marketDetail = computed(() => {
  if (!selectedToken.value) return null;
  const unit = selectedToken.value.unit === 'lovelace' ? 'lovelace' : selectedToken.value.unit;
  return getTokenByUnit(unit) || null;
});

function formatPrice(price: number): string {
  if (!price) return '';
  if (price < 0.001) return '<$0.001';
  return '$' + price.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: price < 1 ? 6 : 2,
  });
}

function formatDetailAmount(token: HomeTokenRow): string {
  const decimals = token.decimals ?? 6;
  let amount = Number(token.quantity);
  if (decimals > 0) {
    amount = amount / Math.pow(10, decimals);
  }
  return amount.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }) + ' ' + (token.ticker || token.name || '');
}

function formatDetailValue(token: HomeTokenRow): string {
  if (!token.price) return '--';
  const decimals = token.decimals ?? 6;
  let amount = Number(token.quantity);
  if (decimals > 0) {
    amount = amount / Math.pow(10, decimals);
  }
  const value = amount * token.price;
  return '$' + value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatCompact(value: number): string {
  if (!value) return '--';
  if (value >= 1_000_000_000) return '$' + (value / 1_000_000_000).toFixed(2) + 'B';
  if (value >= 1_000_000) return '$' + (value / 1_000_000).toFixed(2) + 'M';
  if (value >= 1_000) return '$' + (value / 1_000).toFixed(2) + 'K';
  return '$' + value.toFixed(2);
}

function formatAdaPrice(price: number): string {
  if (!price) return '--';
  return '₳' + price.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: price < 1 ? 8 : 4,
  });
}
</script>

<style scoped>
.home-page {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding-bottom: 16px;
}

/* Empty-mainnet stack: the dashboard's hero cards, stacked for the narrow
   panel. The chart card needs a definite height (its chart area flex-grows). */
.empty-stack {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding: var(--g-s-3);
}

.empty-stack__chart {
  height: 200px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 16px 8px;
}

/* Token detail bottom sheet styles */
.token-detail {
  display: flex;
  flex-direction: column;
}

.detail-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--g-hairline-2);
}

.detail-row:last-child {
  border-bottom: none;
}

.green-text {
  color: var(--g-success);
}

.red-text {
  color: var(--g-error);
}
</style>
