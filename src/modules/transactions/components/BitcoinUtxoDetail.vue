<template>
  <div v-if="utxo" class="tx-details">
    <!-- Hero: how much, and whether it has confirmed -->
    <header class="tx-hero">
      <div class="tx-hero__head">
        <TxGlyph icon="mdi-cube-outline" :tone="utxo.confirmed ? 'neutral' : 'warning'" />
        <div class="tx-hero__heading">
          <div class="tx-hero__title-row">
            <span class="tx-hero__title">{{ $t('transactions.utxoDetails') }}</span>
          </div>
          <span class="t-caption g-mono">{{ shortOutpoint(utxo) }}</span>
        </div>
        <div class="tx-hero__actions">
          <GButton
            v-if="transactionUrl"
            tier="secondary"
            compact
            :href="transactionUrl"
            target="_blank"
            rel="noopener noreferrer"
          >
            <v-icon size="small" start>mdi-open-in-new</v-icon>
            {{ $t('miniGero.viewOnExplorer') }}
          </GButton>
        </div>
      </div>

      <div class="tx-hero__value">
        <div class="tx-hero__amount">
          <span :class="['t-display', 'g-num', 'tx-hero__amount-value', { 'tx-hero__amount-value--pending': !utxo.confirmed }]">
            {{ formatBtc(utxo.sats) }} {{ ticker }}
          </span>
          <span class="t-caption g-num">{{ subLine }}</span>
        </div>
        <span :class="['tx-status', utxo.confirmed ? 'tx-status--confirmed' : 'tx-status--pending']">
          <v-icon size="x-small">{{ utxo.confirmed ? 'mdi-check-circle-outline' : 'mdi-clock-outline' }}</v-icon>
          {{ utxo.confirmed ? $t('transactions.confirmed') : $t('mempool.unconfirmed') }}
        </span>
      </div>

      <dl class="tx-facts">
        <!-- No explorer has a page for a single output, so link the transaction that made it. -->
        <div class="tx-fact tx-fact--wide">
          <dt class="t-label">{{ $t('transactions.transactionId') }}</dt>
          <dd>
            <a v-if="transactionUrl" class="g-mono tx-fact__link" :href="transactionUrl" target="_blank" rel="noopener noreferrer">
              {{ filters.truncate(utxo.txHash) }}
            </a>
            <span v-else class="g-mono">{{ filters.truncate(utxo.txHash) }}</span>
            <CopyButton x-small :value="utxo.txHash" />
          </dd>
        </div>
        <div class="tx-fact">
          <dt class="t-label">{{ $t('transactions.outputIndex') }}</dt>
          <dd class="g-num">{{ utxo.index }}</dd>
        </div>
        <div class="tx-fact tx-fact--wide">
          <dt class="t-label">{{ $t('transactions.address') }}</dt>
          <dd>
            <span class="g-mono" :title="utxo.address">{{ filters.truncate(utxo.address) }}</span>
            <CopyButton x-small :value="utxo.address" />
            <ExplorerLink type="address" :id="utxo.address" x-small />
          </dd>
        </div>
        <div v-if="kindLabel" class="tx-fact">
          <dt class="t-label">{{ $t('common.type') }}</dt>
          <dd>{{ kindLabel }}</dd>
        </div>
        <div v-if="path" class="tx-fact tx-fact--wide">
          <dt class="t-label">{{ $t('navigation.hdPath') }}</dt>
          <dd class="g-mono">{{ path }}</dd>
        </div>
      </dl>
    </header>
  </div>
</template>

<script setup lang="ts">
import { computed, toRefs } from 'vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import CopyButton from '@/shared/components/CopyButton.vue';
import ExplorerLink from '@/shared/components/ExplorerLink.vue';
import TxGlyph from '@/modules/transactions/components/TxGlyph.vue';
import filters from '@/shared/utils/filters';
import networks from '@/utils/networks';
import { walletStore } from '@/stores/walletStore';
import { priceStore } from '@/stores/priceStore';
import { formatBtc, formatSats } from '@/shared/utils/format';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useExplorer } from '@/shared/composables/useExplorer';
import { useCurrencyConverter } from '@/shared/composables/useCurrencyConverter';
import { bitcoinAddressPath } from '@/chains/bitcoin/bitcoinPaths';
import { resolveAccountIndex } from '@/shared/utils/walletAccount';
import { bitcoinUtxoRows, shortOutpoint, type BitcoinUtxoRow } from './bitcoinUtxoRows';

// The UTxOs tab's detail pane on a Bitcoin wallet, in BitcoinTransactionDetails'
// layout (shared styles in _tx-details.scss).
const props = defineProps<{ utxo: BitcoinUtxoRow }>();

const { t } = useTranslation();
const { explorerUrl } = useExplorer();
const { convertFiat, getCurrencySymbol } = useCurrencyConverter();
const { loggedWallet } = toRefs(walletStore);

// The store's current row: an unconfirmed output confirms when sync replaces the
// set, while the pane keeps the row that was clicked. The page is kept alive
// across wallet switches, so a row selected on another chain is not shown.
const utxo = computed<BitcoinUtxoRow | null>(() => {
  const id = props.utxo?.id;
  const live = id ? bitcoinUtxoRows(walletStore.utxos).find((row) => row.id === id) : undefined;
  if (live) return live;
  return typeof props.utxo?.sats === 'bigint' ? props.utxo : null;
});

const ticker = computed(() =>
  networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network)
);

// Sats, then fiat at the live BTC price, labelled as such (as on a transaction)
const subLine = computed(() => {
  if (!utxo.value) return '';
  const sats = Number(utxo.value.sats);
  const parts = [t('bitcoin.satsValue', { value: formatSats(utxo.value.sats) })];
  const price = priceStore.btcUsd?.lastPrice || 0;
  if (price && sats) {
    // Sats × USD price is the value in 1e-8 USD, hence the 8 decimals.
    const value = filters.toCurrency(convertFiat(sats * price), false, 0, getCurrencySymbol(), '', false, 8);
    parts.push(t('transactions.fiatAtTodaysPrice', { value }));
  }
  return parts.join(' · ');
});

const kindLabel = computed(() => {
  if (utxo.value?.kind === 'receive') return t('bitcoin.receiveAddress');
  if (utxo.value?.kind === 'change') return t('bitcoin.changeAddress');
  return '';
});

// The path sync derived the address at (WalletBg.fetchBitcoinUtxos: the account
// key, then chain and index).
const path = computed(() => {
  const wallet = loggedWallet.value;
  if (!wallet || !utxo.value?.kind || utxo.value.addressIndex === null) return '';
  try {
    return bitcoinAddressPath(wallet.network, wallet.addressType || 'segwit', resolveAccountIndex(wallet), utxo.value.kind === 'change', utxo.value.addressIndex);
  } catch {
    // An account index the record can't hold: no path rather than a wrong one.
    return '';
  }
});

const transactionUrl = computed(() => explorerUrl('tx', utxo.value?.txHash) || null);
</script>

<style scoped lang="scss">
@import '@/shared/styles/tx-details';
</style>
