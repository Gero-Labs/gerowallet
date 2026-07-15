<template>
  <!-- Midnight: NIGHT + DUST rows from midnightStore (mirrors the dashboard's
       Midnight holdings) — the Cardano rows below make no sense on this chain. -->
  <div v-if="isMidnight" class="token-list">
    <div class="token-item ada-row">
      <div class="token-left">
        <v-avatar size="36" class="token-avatar ada-avatar">
          <img :src="midnightLogo" alt="NIGHT" style="width: 24px; height: 24px" />
        </v-avatar>
        <div class="token-info">
          <div class="token-name text-body-2 white--text text-truncate" style="font-weight: 600">
            {{ nightTicker }}
            <v-icon x-small color="primary" class="ml-1" style="margin-top: -2px">mdi-check-decagram</v-icon>
          </div>
          <div class="token-amount text-caption grey--text">
            {{ hideBalances ? '••••••' : formattedNightBalance }}
          </div>
        </div>
      </div>
      <div class="token-right">
        <div class="token-value text-body-2 grey--text">--</div>
        <div v-if="showNightBreakdown" class="token-change t-caption g-num">
          {{ hideBalances ? '••••••' : nightBreakdownText }}
        </div>
      </div>
    </div>
  </div>

  <div v-else class="token-list">
    <!-- ADA pinned at top (hidden on a truly empty wallet) -->
    <div v-if="!isEmpty" class="token-item ada-row" @click="handleSelect(adaToken)">
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
            <v-icon v-else size="20" color="var(--g-text-3)">mdi-circle-outline</v-icon>
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

    <!-- Empty state: only a truly empty wallet (0 ADA, no tokens) reaches here,
         so the ADA row is hidden and this stands alone — no contradiction. -->
    <div v-if="isEmpty" class="empty-state">
      <v-icon size="40" color="var(--g-text-3)">mdi-wallet-outline</v-icon>
      <div class="text-body-2 grey--text mt-2">{{ $t('miniGero.noTokens') }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, toRefs } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { priceStore } from '@/stores/priceStore';
import { resolveIcon, applyTokenImageOverride } from '@/shared/utils/resolver';
import { useAdaLovelace } from '../composables/useAdaLovelace';
import { useMarketData } from '@/modules/market/composables/useMarketData';
import assetsUtil from '@/utils/assets';
import midnightLogo from '@/assets/svg/midnight.svg';
import { midnightStore } from '@/stores/midnightStore';
import { Blockchain, Network } from '@/models/types';
import { MIDNIGHT_DECIMALS } from '@/chains/midnight/midnightTypes';
import { useTranslation } from '@/shared/composables/useTranslation';

const { t } = useTranslation();
const adaLogo = assetsUtil.cardanoBlueLogo;

// ── Midnight branch ───────────────────────────────────────────────────────────
const isMidnight = computed(() => walletStore.loggedWallet?.chain === Blockchain.MIDNIGHT);
const isMidnightMainnet = computed(() => isMidnight.value && walletStore.loggedWallet?.network === Network.MAINNET);
const nightTicker = computed(() => (isMidnightMainnet.value ? 'NIGHT' : 'tNIGHT'));

const MN_NIGHT_DIVISOR = 10n ** BigInt(MIDNIGHT_DECIMALS.NIGHT);

function formatMidnightUnits(value: bigint, divisor: bigint, digits: number): string {
  const whole = value / divisor;
  const frac = (value % divisor).toString().padStart(divisor.toString().length - 1, '0');
  return `${whole.toLocaleString('en-US')}.${frac.slice(0, digits)}`;
}

const formattedNightBalance = computed(() => {
  const total = (midnightStore.balances.nightUnshielded ?? 0n) + (midnightStore.balances.nightShielded ?? 0n);
  return formatMidnightUnits(total, MN_NIGHT_DIVISOR, 2);
});

// Public/private breakdown - same visibility rule as the dashboard's
// MidnightHoldingsTable and the sidepanel's BalanceSection (mirror rule).
const showNightBreakdown = computed(() =>
  midnightStore.shieldedSyncAvailable || (midnightStore.balances.nightShielded ?? 0n) > 0n);

const nightBreakdownText = computed(() => {
  const pub = formatMidnightUnits(midnightStore.balances.nightUnshielded ?? 0n, MN_NIGHT_DIVISOR, 2);
  const priv = formatMidnightUnits(midnightStore.balances.nightShielded ?? 0n, MN_NIGHT_DIVISOR, 2);
  return `${t('midnight.common.public')} ${pub} / ${t('midnight.common.private')} ${priv}`;
});
const emit = defineEmits<{
  (e: 'select', token: any): void;
}>();

const { tokens: rawTokens } = toRefs(walletStore);
const hideBalances = computed(() => walletStore.config?.hideBalances || false);
const { allTokens: marketTokens, adaData } = useMarketData();

const adaPrice = computed(() => adaData.value?.priceUsd || priceStore.adaUsd?.lastPrice || 0);

// ADA balance from UTXOs (in lovelace) — shared composable
const { adaLovelace: adaBalanceLovelace } = useAdaLovelace();

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

// A truly empty wallet holds no ADA and no other tokens. In that case we hide
// the pinned ADA-0 row and show a single empty state instead of a "0" holding.
const isEmpty = computed(() => adaBalanceLovelace.value === 0 && filteredTokens.value.length === 0);

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
  border-radius: var(--g-r-control);
  margin: 2px 8px;
  border: 1px solid transparent;
}

.token-item.ada-row {
  background: color-mix(in srgb, var(--g-accent) 4%, transparent);
  border-color: color-mix(in srgb, var(--g-accent) 10%, transparent);
}

.ada-avatar {
  background: color-mix(in srgb, var(--g-accent) 12%, transparent) !important;
}

.token-item:hover {
  background: var(--g-hairline-1);
  border-color: var(--g-hairline-1);
}

.token-item:active {
  background: var(--g-hairline-1);
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
  background: var(--g-hairline-1);
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
  color: var(--g-success) !important;
}

.red-text {
  color: var(--g-error) !important;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 16px;
}
</style>
