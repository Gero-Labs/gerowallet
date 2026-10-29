<template>
  <!-- What a dApp's PSBT does, on the same approval card as Cardano's: every
       output with whose it is, the amount leaving the wallet, the fee and the
       total. Shared by the popup (BitcoinSignPsbt.vue) and the side panel
       (DAppOverlay.vue). Display only: signing never reads it. -->
  <div class="btc-psbt-review">
    <template v-if="review">
      <TransactionDetailsCard
        :outputs="cardOutputs"
        :totals="cardTotals"
        :unit="ticker"
        :fee-unit="ticker"
      />
      <span v-if="youPayFiat" class="t-caption g-num btc-psbt-review__fiat">≈ {{ youPayFiat }}</span>
      <dl class="btc-psbt-review__meta">
        <div class="btc-psbt-review__fact">
          <dt class="t-label">{{ $t('bitcoin.inputs') }} → {{ $t('bitcoin.outputs') }}</dt>
          <dd class="g-num">{{ review.inputCount }} → {{ review.outputs.length }}</dd>
        </div>
        <div v-if="result" class="btc-psbt-review__fact">
          <dt class="t-label">{{ $t('bitcoin.result') }}</dt>
          <dd>{{ result }}</dd>
        </div>
      </dl>
      <p v-if="review.fee === null" class="t-caption btc-psbt-review__note">
        <v-icon size="x-small">mdi-information-outline</v-icon>
        {{ $t('bitcoin.psbtFeeUnknown') }}
      </p>
    </template>
    <p v-else-if="unreadable" class="btc-psbt-review__warning" role="alert">
      <v-icon size="small">mdi-alert-outline</v-icon>
      {{ $t('bitcoin.psbtUnreadable') }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef, toRefs, watch } from 'vue';
import TransactionDetailsCard, { type TxDetailsOutput, type TxDetailsTotals } from '@/shared/components/TransactionDetailsCard.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useCurrencyConverter } from '@/shared/composables/useCurrencyConverter';
import { walletStore } from '@/stores/walletStore';
import { priceStore } from '@/stores/priceStore';
import networks from '@/utils/networks';
import filters from '@/shared/utils/filters';
import { formatBtc } from '@/shared/utils/format';
import type { PsbtReview } from '@/chains/bitcoin/psbtReview';

const props = withDefaults(defineProps<{
  /** The PSBT as the dApp sent it (hex or base64). */
  psbtHex: string;
  /** What the signature produces (finalized transaction or signed PSBT), when known. */
  result?: string;
}>(), { result: '' });

const { t } = useTranslation();
const { convertFiat, getCurrencySymbol } = useCurrencyConverter();
const { loggedWallet } = toRefs(walletStore);

const review = shallowRef<PsbtReview | null>(null);
const unreadable = ref(false);

watch(
  () => [props.psbtHex, loggedWallet.value?.id] as const,
  async ([psbtHex]) => {
    review.value = null;
    unreadable.value = false;
    const wallet = loggedWallet.value;
    if (!psbtHex || !wallet) return;
    try {
      // bitcoinjs-lib and the key derivation load only when a PSBT is shown
      const [{ reviewPsbt }, { ownBitcoinAddresses }] = await Promise.all([
        import('@/chains/bitcoin/psbtReview'),
        import('@/chains/bitcoin/ownAddresses'),
      ]);
      if (psbtHex !== props.psbtHex) return; // a newer request replaced this one
      review.value = reviewPsbt(psbtHex, wallet.network, ownBitcoinAddresses(wallet, walletStore.keys));
    } catch (error) {
      console.error('[BitcoinPsbtReview] Failed to decode the PSBT:', error);
      if (psbtHex === props.psbtHex) unreadable.value = true;
    }
  },
  { immediate: true },
);

const ticker = computed(() =>
  networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network)
);

const cardOutputs = computed<TxDetailsOutput[]>(() =>
  (review.value?.outputs ?? []).map((output) => ({
    kind: output.owner,
    truncatedAddress: output.address ? filters.truncate(output.address) : t('bitcoin.dataOutput'),
    ada: formatBtc(output.value),
  }))
);

/** What leaves the wallet: outputs it does not own plus the fee; unknown without the fee. */
const youPaySats = computed(() => {
  const current = review.value;
  return current && current.fee !== null ? current.sending + current.fee : null;
});

const cardTotals = computed<TxDetailsTotals>(() => {
  const current = review.value;
  return {
    totalSendingAda: formatBtc(current?.sending ?? 0),
    feeAda: current?.fee != null ? formatBtc(current.fee) : '—',
    youPayAda: youPaySats.value !== null ? formatBtc(youPaySats.value) : '—',
    // Only a complete transaction can be called internal: a partial one gains outputs later
    isInternal: !!current && current.fee !== null && current.sending === 0 && current.outputs.length > 0,
  };
});

const youPayFiat = computed(() => {
  const price = priceStore.btcUsd?.lastPrice;
  if (!price || !youPaySats.value) return '';
  // Sats × USD price is the value in 1e-8 USD, hence the 8 decimals.
  return filters.toCurrency(convertFiat(youPaySats.value * price), false, 0, getCurrencySymbol(), '', false, 8);
});
</script>

<style scoped>
.btc-psbt-review {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}

.btc-psbt-review__fiat {
  align-self: flex-end;
}

.btc-psbt-review__meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--g-s-5);
  margin: 0;
}

.btc-psbt-review__fact {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.btc-psbt-review__fact dd {
  margin: 0;
  color: var(--g-text-1);
  font-size: 13px;
}

.btc-psbt-review__note {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-1);
  margin: 0;
}

.btc-psbt-review__note .v-icon {
  margin-top: 2px;
  color: var(--g-text-3);
}

.btc-psbt-review__warning {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  margin: 0;
  padding: var(--g-s-2) var(--g-s-3);
  border: 1px solid var(--g-warning-line);
  border-radius: var(--g-r-control);
  background: var(--g-warning-fill);
  color: var(--g-warning);
  font-size: 13px;
}

.btc-psbt-review__warning .v-icon {
  color: inherit;
}
</style>
