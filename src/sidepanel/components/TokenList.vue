<template>
  <div class="token-list">
    <!-- Token items -->
    <template v-if="tokens.length > 0">
      <div
        v-for="token in tokens"
        :key="token.unit || token.policy_id"
        class="token-item"
        @click="handleSelect(token)"
      >
        <div class="token-left">
          <v-avatar size="36" class="token-avatar">
            <img
              v-if="token.img"
              :src="token.img"
              :alt="token.ticker || token.name"
              @error="onImgError($event)"
            />
            <v-icon v-else size="20" color="#888">mdi-circle-outline</v-icon>
          </v-avatar>
          <div class="token-info">
            <div class="token-name text-body-2 white--text text-truncate">
              {{ token.ticker || token.name || 'Unknown' }}
              <v-icon
                v-if="token.verified"
                x-small
                color="primary"
                class="ml-1"
                style="margin-top: -2px"
              >mdi-check-decagram</v-icon>
            </div>
            <div class="token-amount text-caption grey--text">
              {{ formatTokenAmount(token) }}
            </div>
          </div>
        </div>
        <div class="token-right">
          <div class="token-value text-body-2 white--text" v-if="token.price">
            {{ formatFiatValue(token) }}
          </div>
          <div class="token-value text-body-2 grey--text" v-else>--</div>
          <div
            v-if="token.change !== undefined && token.change !== null"
            class="token-change text-caption"
            :class="token.change >= 0 ? 'green-text' : 'red-text'"
          >
            {{ token.change >= 0 ? '+' : '' }}{{ token.change.toFixed(2) }}%
          </div>
        </div>
      </div>
    </template>

    <!-- Empty state -->
    <div v-else class="empty-state">
      <v-icon size="40" color="#333">mdi-wallet-outline</v-icon>
      <div class="text-body-2 grey--text mt-2">{{ $t('miniGero.noTokens') }}</div>
      <div class="text-caption grey--text mt-1" style="color: #555 !important">
        {{ $t('miniGero.startAddingTokens') }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, toRefs } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { tapToolsStore } from '@/stores/tapToolsStore';
import { priceStore } from '@/stores/priceStore';
import { getBalance } from '@/chrome/serialization';

const emit = defineEmits<{
  (e: 'select', token: any): void;
}>();

const { utxos, collateral, tokens: rawTokens } = toRefs(walletStore);

const adaPrice = computed(() => priceStore.adaUsd?.lastPrice || 0);

const tokens = computed(() => {
  const portfolio = tapToolsStore.portfolio;
  const result: any[] = [];

  // Always show ADA as the first item
  const adaBalance = getAdaBalance();
  if (adaBalance > 0 || Object.keys(rawTokens.value || {}).length === 0) {
    result.push({
      unit: 'lovelace',
      policy_id: '',
      name: 'Cardano',
      ticker: 'ADA',
      img: 'https://assets.coingecko.com/coins/images/975/small/cardano.png',
      quantity: adaBalance * 1_000_000, // Store in lovelace for consistency
      price: adaPrice.value,
      change: priceStore.adaUsd?.priceChangePercentage ?? null,
      verified: true,
      adaValue: adaBalance,
      decimals: 6,
    });
  }

  // Add FT positions from TapTools portfolio (enriched data with prices)
  if (portfolio?.positionsFt && Array.isArray(portfolio.positionsFt)) {
    portfolio.positionsFt.forEach((position: any) => {
      result.push({
        unit: position.unit || position.fingerprint,
        policy_id: position.policyId || position.policy_id || '',
        name: position.name || position.ticker || 'Unknown',
        ticker: position.ticker || position.name || '',
        img: position.img || position.logo || '',
        quantity: position.quantity || position.balance || 0,
        price: position.price ? position.price * adaPrice.value : null,
        change: position.change24h ?? position.change ?? null,
        verified: position.verified ?? false,
        adaValue: position.adaValue || 0,
        decimals: position.decimals ?? 0,
      });
    });
  }

  return result;
});

function getAdaBalance(): number {
  if (!utxos.value || utxos.value.length === 0) return 0;
  try {
    const balance = getBalance(utxos.value, collateral.value);
    return Number(balance.coin().toString()) / 1_000_000;
  } catch {
    return 0;
  }
}

function formatTokenAmount(token: any): string {
  const decimals = token.decimals ?? 6;
  let amount = Number(token.quantity);
  if (decimals > 0) {
    amount = amount / Math.pow(10, decimals);
  }
  if (amount === 0) return '0';
  if (amount < 0.001) return '<0.001';
  return amount.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: amount < 1 ? 6 : 2,
  });
}

function formatFiatValue(token: any): string {
  if (!token.price) return '--';
  const decimals = token.decimals ?? 6;
  let amount = Number(token.quantity);
  if (decimals > 0) {
    amount = amount / Math.pow(10, decimals);
  }
  const value = amount * token.price;
  if (value < 0.01) return '<$0.01';
  return '$' + value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function handleSelect(token: any) {
  emit('select', token);
}

function onImgError(event: Event) {
  const img = event.target as HTMLImageElement;
  img.style.display = 'none';
}
</script>

<style scoped>
.token-list {
  display: flex;
  flex-direction: column;
}

.token-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 16px;
  cursor: pointer;
  transition: background 0.15s ease;
  border-radius: 8px;
  margin: 0 8px;
}

.token-item:hover {
  background: #1a1a1a;
}

.token-item:active {
  background: #222;
}

.token-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.token-avatar {
  flex-shrink: 0;
  background: #1a1a1a;
}

.token-info {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.token-name {
  font-size: 13px !important;
  font-weight: 500;
  max-width: 140px;
}

.token-amount {
  font-size: 11px !important;
}

.token-right {
  text-align: right;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
}

.token-value {
  font-size: 13px !important;
  font-weight: 500;
}

.token-change {
  font-size: 11px !important;
}

.green-text {
  color: #47CD89 !important;
}

.red-text {
  color: #F97066 !important;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 16px;
}
</style>
