<template>
  <div class="balance-section">
    <div class="balance-label t-label grey--text">
      {{ $t('miniGero.portfolioValue') }}
    </div>
    <div class="balance-row">
      <transition name="balance-fade" mode="out-in">
        <span v-if="hideBalances" key="masked" class="balance-amount text-h5 white--text font-weight-bold" style="opacity: 0.5">$•••</span>
        <v-skeleton-loader v-else-if="isMidnight && midnightLoading" key="loading" type="heading" width="140" />
        <span v-else key="visible" class="balance-amount text-h5 white--text font-weight-bold">{{ formattedBalance }}</span>
      </transition>
    </div>
    <div class="balance-sub text-caption" :class="changeColor">
      <template v-if="isMidnight">
        <span v-if="!midnightLoading">
          {{ hideBalances ? '••••••' : formattedDustBalance }} {{ dustTicker }}
        </span>
        <span v-if="nightChange24h !== null" class="ml-2">
          <v-icon x-small :color="nightChange24h >= 0 ? 'success' : 'error'">
            {{ nightChange24h >= 0 ? 'mdi-arrow-up' : 'mdi-arrow-down' }}
          </v-icon>
          {{ Math.abs(nightChange24h).toFixed(2) }}%
        </span>
      </template>
      <template v-else>
        <span v-if="adaBalance !== null">
          {{ hideBalances ? '••••••' : formattedAdaBalance }} {{ currencyTicker }}
        </span>
        <span v-if="priceChange !== null" class="ml-2">
          <v-icon x-small :color="priceChange >= 0 ? 'success' : 'error'">
            {{ priceChange >= 0 ? 'mdi-arrow-up' : 'mdi-arrow-down' }}
          </v-icon>
          {{ Math.abs(priceChange).toFixed(2) }}%
        </span>
      </template>
    </div>
    <v-btn
      v-if="showBuySell"
      rounded
      small
      class="buy-sell-btn mt-3 geroButton"
      :style="{ color: 'var(--g-accent)', borderColor: 'var(--g-accent)' }"
      @click="$emit('buy-sell')"
    >
      <v-icon small left>mdi-swap-horizontal</v-icon>
      {{ $t('miniGero.buySell', { ticker: currencyTicker }) }}
    </v-btn>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { priceStore } from '@/stores/priceStore';
import { useMarketData } from '@/modules/market/composables/useMarketData';
import { useHoldingsValuation } from '@/shared/composables/useHoldingsValuation';
import { useMidnightLoading } from '@/shared/composables/useMidnightLoading';
import { useNightFiat } from '@/shared/composables/useNightFiat';
import { midnightStore } from '@/stores/midnightStore';
import { Blockchain, Network } from '@/models/types';
import { MIDNIGHT_DECIMALS } from '@/chains/midnight/midnightTypes';
import { useChainContext } from '../composables/useChainContext';

defineEmits<{
  (e: 'buy-sell'): void;
}>();

const { networkInfo } = useChainContext();
const currencyTicker = computed(() => networkInfo.value?.currencyTicker || 'ADA');
const showBuySell = computed(() => !!networkInfo.value?.buySupport);
const hideBalances = computed(() => walletStore.config?.hideBalances || false);
const { adaData } = useMarketData();

// Portfolio value comes from the SAME composable the dashboard uses —
// mini-Gero must mirror the dashboard's numbers exactly (house rule). The
// old local re-implementation here lacked the DexHunter price fallback and
// drifted from the dashboard whenever a token was only priced there.
const { totals, adaBalance } = useHoldingsValuation();

const priceChange = computed<number | null>(() => {
  return adaData.value?.priceChange24h ?? priceStore.adaUsd?.priceChangePercentage ?? null;
});

// ── Midnight branch — mirror the dashboard's Midnight data, not Cardano's ────
const isMidnight = computed(() => walletStore.loggedWallet?.chain === Blockchain.MIDNIGHT);
const isMidnightMainnet = computed(() => isMidnight.value && walletStore.loggedWallet?.network === Network.MAINNET);
const midnightLoading = useMidnightLoading();
const nightFiat = useNightFiat();
// Only mainnet NIGHT has a market; kick a cached fetch when relevant.
watch(isMidnightMainnet, (on) => { if (on) void nightFiat.refresh(); }, { immediate: true });

const NIGHT_DIVISOR = 10n ** BigInt(MIDNIGHT_DECIMALS.NIGHT);
const DUST_DIVISOR = 10n ** BigInt(MIDNIGHT_DECIMALS.DUST);

const totalNight = computed(() =>
  (midnightStore.balances.nightUnshielded ?? 0n) + (midnightStore.balances.nightShielded ?? 0n));

const nightTicker = computed(() => (isMidnightMainnet.value ? 'NIGHT' : 'tNIGHT'));
const dustTicker = computed(() => (isMidnightMainnet.value ? 'DUST' : 'tDUST'));

const nightChange24h = computed(() =>
  (isMidnightMainnet.value && nightFiat.hasPrice.value) ? nightFiat.change24h.value : null);

function formatUnits(value: bigint, divisor: bigint, digits: number): string {
  const whole = value / divisor;
  const fracRaw = (value % divisor).toString().padStart(divisor.toString().length - 1, '0');
  return `${whole.toLocaleString('en-US')}.${fracRaw.slice(0, digits)}`;
}

const formattedDustBalance = computed(() => formatUnits(midnightStore.balances.dust ?? 0n, DUST_DIVISOR, 4));



const formattedBalance = computed(() => {
  if (isMidnight.value) {
    const night = formatUnits(totalNight.value, NIGHT_DIVISOR, 2);
    if (isMidnightMainnet.value && nightFiat.hasPrice.value && nightFiat.usd.value) {
      const usdVal = Number(totalNight.value) / Number(NIGHT_DIVISOR) * nightFiat.usd.value;
      return '$' + usdVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return `${night} ${nightTicker.value}`;
  }
  const val = totals.value.usd;
  if (val === 0) return '$0.00';
  if (val < 0.01) return '<$0.01';
  return '$' + val.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
});

const formattedAdaBalance = computed(() => {
  const val = totals.value.ada;
  if (val === 0) return '0';
  return val.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: val < 1 ? 6 : 2,
  });
});

const changeColor = computed(() => {
  const change = isMidnight.value ? nightChange24h.value : priceChange.value;
  if (change === null || change === 0) return 'grey--text';
  return change > 0 ? 'green-change' : 'red-change';
});
</script>

<style scoped>
.balance-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px 16px 12px;
}

.balance-row {
  margin-top: 4px;
}

.balance-amount {
  letter-spacing: -0.5px;
}

.balance-sub {
  display: flex;
  align-items: center;
  margin-top: 2px;
  font-size: 12px !important;
}

.green-change {
  color: var(--g-success) !important;
}

.red-change {
  color: var(--g-error) !important;
}

.buy-sell-btn {
  text-transform: none;
  font-weight: 600;
  letter-spacing: 0;
  font-size: 13px;
  padding: 0 20px !important;
}

.balance-fade-enter-active,
.balance-fade-leave-active {
  transition: opacity 0.22s ease, filter 0.22s ease;
}

.balance-fade-enter,
.balance-fade-leave-to {
  opacity: 0;
  filter: blur(4px);
}
</style>
