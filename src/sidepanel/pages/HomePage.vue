<template>
  <div class="home-page">
    <BalanceSection @buy-sell="handleBuySell" />

    <QuickActions @action="handleAction" />

    <FeaturedCarousel />

    <div class="section-header">
      <span class="text-subtitle-2 white--text font-weight-bold">
        {{ $t('miniGero.tokens') }}
      </span>
      <span v-if="tokenCount > 0" class="text-caption grey--text">
        {{ tokenCount }}
      </span>
    </div>

    <TokenList @select="handleTokenSelect" />

    <!-- Flow sheets -->
    <SendSheet v-model="showSend" />
    <ReceiveSheet v-model="showReceive" />
    <SwapSheet v-model="showSwap" />
    <PerpsStubSheet v-model="showPerps" />

    <!-- Token Detail Bottom Sheet -->
    <BottomSheet
      :value="showTokenDetail"
      @input="showTokenDetail = $event"
      :title="selectedToken?.ticker || selectedToken?.name || ''"
      height="60%"
    >
      <div v-if="selectedToken" class="token-detail">
        <div class="detail-header">
          <v-avatar size="48" class="mb-3">
            <img
              v-if="selectedToken.img"
              :src="selectedToken.img"
              :alt="selectedToken.ticker || selectedToken.name"
            />
            <v-icon v-else size="28" color="#888">mdi-circle-outline</v-icon>
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

        <div class="detail-row">
          <span class="text-caption grey--text">Balance</span>
          <span class="text-body-2 white--text">{{ formatDetailAmount(selectedToken) }}</span>
        </div>
        <div class="detail-row" v-if="selectedToken.price">
          <span class="text-caption grey--text">Value</span>
          <span class="text-body-2 white--text">{{ formatDetailValue(selectedToken) }}</span>
        </div>
      </div>
    </BottomSheet>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { tapToolsStore } from '@/stores/tapToolsStore';
import { walletStore } from '@/stores/walletStore';
import BalanceSection from '../components/BalanceSection.vue';
import QuickActions from '../components/QuickActions.vue';
import FeaturedCarousel from '../components/FeaturedCarousel.vue';
import TokenList from '../components/TokenList.vue';
import BottomSheet from '../components/BottomSheet.vue';
import SendSheet from '../components/flows/SendSheet.vue';
import ReceiveSheet from '../components/flows/ReceiveSheet.vue';
import SwapSheet from '../components/flows/SwapSheet.vue';
import PerpsStubSheet from '../components/flows/PerpsStubSheet.vue';

const showSend = ref(false);
const showReceive = ref(false);
const showSwap = ref(false);
const showPerps = ref(false);
const showTokenDetail = ref(false);
const selectedToken = ref<any>(null);

const tokenCount = computed(() => {
  const portfolio = tapToolsStore.portfolio;
  const ftCount = portfolio?.positionsFt?.length || 0;
  const rawCount = Object.keys(walletStore.tokens || {}).length;
  // +1 for ADA itself
  return Math.max(ftCount, rawCount) + 1;
});

function handleBuySell() {
  console.log('[MiniGero] Buy/Sell ADA');
  // Future: open buy/sell sheet
}

function handleAction(id: string) {
  switch (id) {
    case 'send':
      showSend.value = true;
      break;
    case 'receive':
      showReceive.value = true;
      break;
    case 'swap':
      showSwap.value = true;
      break;
    case 'perps':
      showPerps.value = true;
      break;
  }
}

function handleTokenSelect(token: any) {
  selectedToken.value = token;
  showTokenDetail.value = true;
}

function formatPrice(price: number): string {
  if (!price) return '';
  if (price < 0.001) return '<$0.001';
  return '$' + price.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: price < 1 ? 6 : 2,
  });
}

function formatDetailAmount(token: any): string {
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

function formatDetailValue(token: any): string {
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
  border-bottom: 1px solid #2a2a2a;
}

.detail-row:last-child {
  border-bottom: none;
}

.green-text {
  color: #47CD89 !important;
}

.red-text {
  color: #F97066 !important;
}
</style>
