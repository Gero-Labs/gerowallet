<template>
  <!-- What a dApp's PSBT does, on the same approval card as Cardano's, from the
       same decode the signer enforces (psbtReview.ts): every output with whose
       it is, what leaves the wallet, the fee, and the inputs this wallet signs.
       Shared by the popup (BitcoinSignPsbt.vue) and the side panel
       (DAppOverlay.vue); their approve buttons wait on useBitcoinPsbtReview. -->
  <div class="btc-psbt-review" data-testid="bitcoin-psbt-review">
    <p v-if="problem" class="btc-psbt-review__problem" role="alert" data-testid="bitcoin-psbt-problem">
      <v-icon size="small">mdi-alert-octagon-outline</v-icon>
      {{ problem }}
    </p>

    <template v-if="review && !unparseable">
      <TransactionDetailsCard
        :outputs="cardOutputs"
        :totals="cardTotals"
        :unit="ticker"
        :fee-unit="ticker"
      />
      <span v-if="youPayFiat" class="t-caption g-num btc-psbt-review__fiat">≈ {{ youPayFiat }}</span>
      <!-- The card shortens addresses; every output leaving the wallet is also shown in full,
           so a look-alike address (same start and end) cannot pass for the one the user meant. -->
      <template v-if="externalOutputs.length">
        <div class="t-label btc-psbt-review__heading">{{ $t('wallet.recipients') }}</div>
        <div v-for="output in externalOutputs" :key="output.index" class="btc-psbt-review__input" data-testid="bitcoin-psbt-output">
          <span class="t-caption g-mono btc-psbt-review__address">{{ output.address ?? $t('bitcoin.dataOutput') }}</span>
          <span class="t-caption g-num">{{ formatBtc(output.valueSats) }} {{ ticker }}</span>
        </div>
      </template>
      <p v-if="review.netSats < 0n" class="t-caption g-num btc-psbt-review__note" data-testid="bitcoin-psbt-net">
        {{ $t('bitcoin.psbtReview.entersWallet') }}: {{ formatBtc(-review.netSats) }} {{ ticker }}
      </p>
      <dl class="btc-psbt-review__meta">
        <div class="btc-psbt-review__fact">
          <dt class="t-label">{{ $t('bitcoin.inputs') }} → {{ $t('bitcoin.outputs') }}</dt>
          <dd class="g-num">{{ review.inputs.length }} → {{ review.outputs.length }}</dd>
        </div>
        <div v-if="result" class="btc-psbt-review__fact">
          <dt class="t-label">{{ $t('bitcoin.result') }}</dt>
          <dd>{{ result }}</dd>
        </div>
      </dl>
      <p v-if="feeSats === null" class="t-caption btc-psbt-review__note">
        <v-icon size="x-small">mdi-information-outline</v-icon>
        {{ $t('bitcoin.psbtFeeUnknown') }}
      </p>

      <div class="t-label btc-psbt-review__heading">{{ $t('bitcoin.psbtReview.youSign') }}</div>
      <div v-for="input in signedInputs" :key="input.index" class="btc-psbt-review__input" data-testid="bitcoin-psbt-signed-input">
        <span class="t-caption g-mono btc-psbt-review__address">{{ input.address ?? '' }}</span>
        <span class="t-caption g-num">{{ input.valueSats === null ? $t('common.unknown') : `${formatBtc(input.valueSats)} ${ticker}` }}</span>
      </div>
      <p v-if="othersCount" class="t-caption btc-psbt-review__note">{{ $t('bitcoin.psbtReview.othersSign', { count: othersCount }) }}</p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, toRefs } from 'vue';
import TransactionDetailsCard, { type TxDetailsOutput, type TxDetailsTotals } from '@/shared/components/TransactionDetailsCard.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useCurrencyConverter } from '@/shared/composables/useCurrencyConverter';
import { walletStore } from '@/stores/walletStore';
import { priceStore } from '@/stores/priceStore';
import networks from '@/utils/networks';
import filters from '@/shared/utils/filters';
import { formatBtc } from '@/shared/utils/format';
import type { PsbtReview, PsbtReviewProblem } from '@/chains/bitcoin/psbtReview';

const props = withDefaults(defineProps<{
  /** The decode useBitcoinPsbtReview produced: null while it loads. */
  review: PsbtReview | null;
  /** What the signature produces (finalized transaction or signed PSBT), when known. */
  result?: string;
}>(), { result: '' });

const { t } = useTranslation();
const { convertFiat, getCurrencySymbol } = useCurrencyConverter();
const { loggedWallet } = toRefs(walletStore);

const PROBLEM_KEYS: Record<PsbtReviewProblem['code'], string> = {
  unparseable: 'bitcoin.psbtReview.problemUnparseable',
  invalidToSignInputs: 'bitcoin.psbtReview.problemToSignInputs',
  badIndex: 'bitcoin.psbtReview.problemBadIndex',
  notOwn: 'bitcoin.psbtReview.problemNotOwn',
  addressMismatch: 'bitcoin.psbtReview.problemAddressMismatch',
  unsupportedSighash: 'bitcoin.psbtReview.problemSighash',
  missingValue: 'bitcoin.psbtReview.problemMissingValue',
  valueMismatch: 'bitcoin.psbtReview.problemValueMismatch',
  nothingToSign: 'bitcoin.psbtReview.problemNothingToSign',
};

const unparseable = computed(() => props.review?.problems.some((p) => p.code === 'unparseable') ?? false);
/** The first reason the wallet will not sign: the approve button is held back while there is one. */
const problem = computed(() => {
  const first = props.review?.problems[0];
  if (!first) return '';
  return t(PROBLEM_KEYS[first.code], { index: 'index' in first ? first.index : '' }) as string;
});
const signedInputs = computed(() => props.review?.inputs.filter((input) => input.willSign) ?? []);
const externalOutputs = computed(() => props.review?.outputs.filter((output) => !output.own) ?? []);
const othersCount = computed(() => props.review?.inputs.filter((input) => !input.own).length ?? 0);

const ticker = computed(() =>
  networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network)
);

/** Inputs minus outputs; unknown when an input's amount is missing or a partial PSBT's inputs cover less. */
const feeSats = computed(() => {
  const fee = props.review?.feeSats ?? null;
  return fee !== null && fee >= 0n ? fee : null;
});

/** Paid to outputs that are not the wallet's own (derived) addresses. */
const sendingSats = computed(() =>
  (props.review?.outputs ?? []).filter((output) => !output.own).reduce((sum, output) => sum + output.valueSats, 0n)
);

const cardOutputs = computed<TxDetailsOutput[]>(() =>
  (props.review?.outputs ?? []).map((output) => ({
    kind: output.change ? 'change' : output.own ? 'own' : 'external',
    truncatedAddress: output.address ? filters.truncate(output.address) : t('bitcoin.dataOutput'),
    ada: formatBtc(output.valueSats),
  }))
);

/** What leaves the wallet: the inputs it signs minus what comes back to it. Unknown without every amount. */
const youPaySats = computed(() => {
  const current = props.review;
  if (!current || current.inputs.some((input) => input.willSign && input.valueSats === null)) return null;
  return current.netSats > 0n ? current.netSats : 0n;
});

const cardTotals = computed<TxDetailsTotals>(() => ({
  totalSendingAda: formatBtc(sendingSats.value),
  feeAda: feeSats.value !== null ? formatBtc(feeSats.value) : '—',
  youPayAda: youPaySats.value !== null ? formatBtc(youPaySats.value) : '—',
  // Only a complete transaction can be called internal: a partial one gains outputs later
  isInternal: !!props.review && feeSats.value !== null && sendingSats.value === 0n && props.review.outputs.length > 0,
}));

const youPayFiat = computed(() => {
  const price = priceStore.btcUsd?.lastPrice;
  if (!price || !youPaySats.value) return '';
  // Sats × USD price is the value in 1e-8 USD, hence the 8 decimals.
  return filters.toCurrency(convertFiat(Number(youPaySats.value) * price), false, 0, getCurrencySymbol(), '', false, 8);
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

.btc-psbt-review__problem {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  margin: 0;
  padding: var(--g-s-2) var(--g-s-3);
  border: 1px solid var(--g-error-line);
  border-radius: var(--g-r-control);
  background: var(--g-error-fill);
  color: var(--g-error);
  font-size: 13px;
}

.btc-psbt-review__problem .v-icon {
  color: inherit;
}

.btc-psbt-review__heading {
  margin-top: var(--g-s-1);
  color: var(--g-text-2);
}

.btc-psbt-review__input {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--g-s-2);
  padding: var(--g-s-1) 0;
  border-top: 1px solid var(--g-hairline-1);
}

.btc-psbt-review__address {
  color: var(--g-text-2);
  overflow-wrap: anywhere;
}
</style>
