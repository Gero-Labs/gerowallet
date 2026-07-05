<template>
  <div class="token-list">
    <!-- ADA pinned at top -->
    <div class="token-item ada-row" @click="handleSelect(adaToken)">
      <div class="token-left">
        <v-avatar size="36" class="token-avatar ada-avatar">
          <img :src="adaLogo" alt="ADA" />
        </v-avatar>
        <div class="token-info">
          <div class="token-name text-body-2 white--text text-truncate" style="font-weight: 600">
            ADA
            <v-icon x-small color="primary" class="ml-1" style="margin-top: -2px">mdi-check-decagram</v-icon>
          </div>
          <div class="token-amount text-caption grey--text">
            {{ hideBalances ? '••••••' : formattedAdaBalance }}
          </div>
        </div>
      </div>
      <div class="token-right">
        <div class="token-value text-body-2 white--text" v-if="adaFiatValue">
          {{ hideBalances ? '$•••' : formattedAdaFiat }}
        </div>
        <div class="token-value text-body-2 grey--text" v-else>--</div>
        <div
          v-if="adaPriceChange !== null"
          class="token-change text-caption"
          :class="adaPriceChange >= 0 ? 'green-text' : 'red-text'"
        >
          {{ adaPriceChange >= 0 ? '+' : '' }}{{ adaPriceChange.toFixed(2) }}%
        </div>
      </div>
    </div>

    <!-- Token items -->
    <template v-if="filteredTokens.length > 0">
      <div
        v-for="token in filteredTokens"
        :key="token.unit"
        class="token-item"
        @click="handleSelect(token)"
      >
        <div class="token-left">
          <v-avatar size="36" class="token-avatar">
            <img
              v-if="getTokenImg(token)"
              :src="getTokenImg(token)"
              :alt="getTokenName(token)"
              @error="onImgError($event)"
            />
            <v-icon v-else size="20" color="#888">mdi-circle-outline</v-icon>
          </v-avatar>
          <div class="token-info">
            <div class="token-name text-body-2 white--text text-truncate">
              {{ getTokenName(token) }}
              <v-icon
                v-if="token.verified"
                x-small
                color="primary"
                class="ml-1"
                style="margin-top: -2px"
              >mdi-check-decagram</v-icon>
            </div>
            <div class="token-amount text-caption grey--text">
              {{ hideBalances ? '••••••' : formatTokenAmount(token) }}
            </div>
          </div>
        </div>
        <div class="token-right">
          <div class="token-value text-body-2 white--text" v-if="getTokenPrice(token)">
            {{ hideBalances ? '$•••' : formatFiatValue(token) }}
          </div>
          <div class="token-value text-body-2 grey--text" v-else>--</div>
          <div
            v-if="getTokenChange(token) !== null"
            class="token-change text-caption"
            :class="getTokenChange(token) >= 0 ? 'green-text' : 'red-text'"
          >
            {{ getTokenChange(token) >= 0 ? '+' : '' }}{{ getTokenChange(token).toFixed(2) }}%
          </div>
        </div>
      </div>
    </template>

    <!-- Empty state -->
    <div v-else class="empty-state">
      <v-icon size="40" color="#333">mdi-wallet-outline</v-icon>
      <div class="text-body-2 grey--text mt-2">{{ $t('miniGero.noTokens') }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, toRefs } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { priceStore } from '@/stores/priceStore';
import { resolveIcon, applyTokenImageOverride } from '@/shared/utils/resolver';
import { getBalance } from '@/chrome/serialization';
import { useMarketData } from '@/modules/market/composables/useMarketData';
import assetsUtil from '@/utils/assets';

const adaLogo = assetsUtil.cardanoBlueLogo;

const emit = defineEmits<{
  (e: 'select', token: any): void;
}>();

const { tokens: rawTokens, utxos, collateral } = toRefs(walletStore);
const hideBalances = computed(() => walletStore.config?.hideBalances || false);
const { allTokens: marketTokens, adaData } = useMarketData();

const adaPrice = computed(() => adaData.value?.priceUsd || priceStore.adaUsd?.lastPrice || 0);

// ADA balance from UTXOs (in lovelace)
const adaBalanceLovelace = computed(() => {
  if (!utxos.value || utxos.value.length === 0) return 0;
  try {
    const balance = getBalance(utxos.value, collateral.value);
    return Number(balance.coin().toString());
  } catch {
    return 0;
  }
});

const adaBalanceAda = computed(() => adaBalanceLovelace.value / 1_000_000);

const formattedAdaBalance = computed(() => {
  const val = adaBalanceAda.value;
  if (val === 0) return '0';
  return val.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: val < 1 ? 6 : 2,
  });
});

const adaFiatValue = computed(() => adaBalanceAda.value * adaPrice.value);

const formattedAdaFiat = computed(() => {
  const val = adaFiatValue.value;
  if (val < 0.01) return '<$0.01';
  return '$' + val.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
});

const adaPriceChange = computed<number | null>(() => {
  return adaData.value?.priceChange24h ?? priceStore.adaUsd?.priceChangePercentage ?? null;
});

const adaToken = computed(() => ({
  unit: 'lovelace',
  policy_id: '',
  name: 'ADA',
  ticker: 'ADA',
  img: adaLogo,
  quantity: adaBalanceLovelace.value,
  decimals: 6,
  verified: true,
  price: adaPrice.value,
  change: adaPriceChange.value,
}));

// Use walletStore.tokens (enriched with img, verified, isScam from resolver)
// Filter out: native ADA (shown in BalanceSection), scam tokens, unverified tokens
const filteredTokens = computed(() => {
  if (!rawTokens.value) return [];

  return Object.values(rawTokens.value)
    .filter((token: any) => {
      if (token.policy_id === '') return false;
      if (token.isScam) return false;
      if (!token.verified) return false;
      return true;
    })
    .sort((a: any, b: any) => {
      return getTokenFiatValue(b) - getTokenFiatValue(a);
    });
});

function getTokenImg(token: any): string {
  const name = token.metadata?.ticker || token.name || token.metadata?.name;
  // Prefer main-page market data logo (single source of truth, keyed by unit),
  // then fall back to the token's own / on-chain metadata image.
  const marketImg = marketTokens.value.find(t => t.unit === token.unit)?.img;
  const baseImg = marketImg || token.img || (token.metadata?.logo ? resolveIcon(token.metadata.logo) : '') || (token.metadata?.image ? resolveIcon(token.metadata.image) : '') || '';
  return applyTokenImageOverride(name, baseImg);
}

function getTokenName(token: any): string {
  return token.metadata?.ticker || token.name || token.metadata?.name || 'Unknown';
}

function getTokenPrice(token: any): number {
  const marketToken = marketTokens.value.find(t => t.unit === token.unit);
  if (marketToken?.price) return marketToken.price;
  return 0;
}

function getTokenChange(token: any): number | null {
  const marketToken = marketTokens.value.find(t => t.unit === token.unit);
  return marketToken?.change24h ?? null;
}

function getTokenFiatValue(token: any): number {
  const price = getTokenPrice(token);
  if (!price) return 0;
  const decimals = token.metadata?.decimals ?? 0;
  let amount = Number(token.quantity || 0);
  if (decimals > 0) amount = amount / Math.pow(10, decimals);
  return amount * price;
}

function formatTokenAmount(token: any): string {
  const decimals = token.metadata?.decimals ?? 0;
  let amount = Number(token.quantity || 0);
  if (decimals > 0) amount = amount / Math.pow(10, decimals);
  if (amount === 0) return '0';
  if (amount < 0.001) return '<0.001';
  return amount.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: amount < 1 ? 6 : 2,
  });
}

function formatFiatValue(token: any): string {
  const value = getTokenFiatValue(token);
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
  transition: background 0.15s ease, border-color 0.15s ease;
  border-radius: 10px;
  margin: 2px 8px;
  border: 1px solid transparent;
}

.token-item.ada-row {
  background: color-mix(in srgb, var(--chain-primary) 4%, transparent);
  border-color: color-mix(in srgb, var(--chain-primary) 10%, transparent);
}

.ada-avatar {
  background: color-mix(in srgb, var(--chain-primary) 12%, transparent) !important;
}

.token-item:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.08);
}

.token-item:active {
  background: rgba(255, 255, 255, 0.08);
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
  background: rgba(255, 255, 255, 0.06);
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
