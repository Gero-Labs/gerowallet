<template>
  <!-- The Bitcoin dashboard's balance hero. Shared glass-panel material; only
       layout lives here. -->
  <div class="fill-height d-flex flex-column glass-panel btc-balance">
    <div class="btc-balance__header">
      <div class="btc-balance__identity">
        <img :src="bitcoinLogo" class="btc-balance__logo" alt="" />
        <div class="btc-balance__names">
          <span class="t-heading">{{ $t('assets.bitcoin') }}</span>
          <span class="t-caption">{{ networkLabel }}</span>
        </div>
      </div>
      <v-btn
        icon
        variant="text"
        size="small"
        :loading="refreshing"
        :disabled="refreshing"
        :aria-label="$t('common.refresh')"
        :title="$t('common.refresh')"
        @click="refreshBalance()"
      >
        <v-icon size="small">mdi-refresh</v-icon>
      </v-btn>
    </div>

    <template v-if="loggedWallet">
      <div class="btc-balance__amount">
        <span class="t-label">{{ $t('common.available') }}</span>
        <div class="btc-balance__primary">
          <span class="t-display g-num">{{ hideBalances ? '••••••' : formatBtc(availableBalance) }}</span>
          <span class="btc-balance__unit g-mono">{{ ticker }}</span>
        </div>
        <span class="t-caption g-num">
          {{ hideBalances ? '••••' : $t('bitcoin.satsValue', { value: formatSats(availableBalance) }) }}
        </span>
        <span v-if="fiatValue" class="btc-balance__fiat g-num">
          {{ hideBalances ? `${getCurrencySymbol()}•••` : fiatValue }}
        </span>
      </div>

      <div v-if="unconfirmedBalance > 0" class="btc-balance__pending">
        <v-icon size="x-small">mdi-clock-outline</v-icon>
        <span class="g-num">{{ $t('bitcoin.unconfirmedAmount', { amount: `${formatBtc(unconfirmedBalance)} ${ticker}` }) }}</span>
      </div>

      <div class="btc-balance__address">
        <span class="t-label">{{ $t('common.address') }}</span>
        <span class="btc-balance__address-value g-mono">{{ baseAddress }}</span>
        <CopyButton x-small :value="baseAddress" />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRefs } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { priceStore } from '@/stores/priceStore';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { Network } from '@/models/types';
import networks from '@/utils/networks';
import filters from '@/shared/utils/filters';
import { formatBtc, formatSats } from '@/shared/utils/format';
import { useCurrencyConverter } from '@/shared/composables/useCurrencyConverter';
import CopyButton from '@/shared/components/CopyButton.vue';
import bitcoinLogo from '@/assets/bitcoin-logo.svg';

const { loggedWallet, bitcoinBalance } = toRefs(walletStore);
const { convertFiat, getCurrencySymbol } = useCurrencyConverter();

const refreshing = ref(false);

const baseAddress = computed(() => loggedWallet.value?.baseAddress ?? '');

const ticker = computed(() =>
  networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network)
);

// Testnet is specifically testnet4 (backend Esplora = mempool.space/testnet4),
// matching the onboarding label, so say "Testnet4", never a bare "Testnet".
const networkLabel = computed(() => {
  const network = loggedWallet.value?.network;
  return network === Network.TESTNET ? 'Testnet4' : (network || Network.MAINNET);
});

const availableBalance = computed<bigint>(() => bitcoinBalance.value?.available ?? BigInt(0));

const unconfirmedBalance = computed<bigint>(() => {
  if (!bitcoinBalance.value) return BigInt(0);
  return bitcoinBalance.value.total - bitcoinBalance.value.available;
});

const hideBalances = computed(() => walletStore.config?.hideBalances || false);

// Fiat at the live BTC price, in the wallet's chosen currency
const fiatValue = computed(() => {
  const price = priceStore.btcUsd?.lastPrice;
  if (!price) return '';
  // Sats × USD price is the value in 1e-8 USD, hence the 8 decimals.
  return filters.toCurrency(convertFiat(Number(availableBalance.value) * price), false, 0, getCurrencySymbol(), '', false, 8);
});

async function refreshBalance(): Promise<void> {
  if (refreshing.value) return;
  refreshing.value = true;
  try {
    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SYNC_BITCOIN,
      data: {},
    }) as { data?: { success?: boolean; error?: string } };
    if (!response.data?.success) {
      console.error('Failed to refresh Bitcoin wallet:', response.data?.error);
    }
  } catch (error) {
    console.error('Failed to refresh Bitcoin wallet:', error);
  } finally {
    refreshing.value = false;
  }
}
</script>

<style scoped>
/* Surface (background/border/radius) comes from the shared .glass-panel material. */
.btc-balance {
  gap: var(--g-s-4);
  padding: var(--g-s-4);
}

.btc-balance__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
}

.btc-balance__identity {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
}

.btc-balance__logo {
  width: 32px;
  height: 32px;
}

.btc-balance__names {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.btc-balance__amount {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}

.btc-balance__primary {
  display: flex;
  align-items: baseline;
  gap: var(--g-s-2);
  line-height: 1.1;
}

.btc-balance__unit {
  font-size: 14px;
  color: var(--g-text-3);
}

.btc-balance__fiat {
  font-size: 20px;
  font-weight: 600;
  color: var(--g-text-1);
}

.btc-balance__pending {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  color: var(--g-warning);
  font-size: 12px;
}

.btc-balance__pending .v-icon {
  color: inherit;
}

/* An address field is a control, not a surface: solid raised fill (glass rule exception). */
.btc-balance__address {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  margin-top: auto;
  padding: var(--g-s-2) var(--g-s-3);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
  background: var(--g-raised);
}

.btc-balance__address-value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--g-text-2);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
