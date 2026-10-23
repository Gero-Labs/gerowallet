<template>
  <!-- What a dApp's PSBT does to the wallet, from the same decode the signer
       runs (psbtReview.ts): every output with its full address, the inputs
       this wallet signs, what leaves the wallet and the fee. Shared by the
       popup (BitcoinSignPsbt.vue) and the side panel (DAppOverlay.vue). -->
  <div class="psbt-review" data-testid="bitcoin-psbt-review">
    <div v-if="problem" class="psbt-review__problem" role="alert" data-testid="bitcoin-psbt-problem">
      <v-icon size="14" color="error" class="mr-1">mdi-alert-octagon-outline</v-icon>
      <span class="text-caption">{{ problem }}</span>
    </div>

    <template v-if="review && !unparseable">
      <div class="psbt-review__row psbt-review__total">
        <span class="psbt-review__label text-caption">
          {{ review.netSats >= 0n ? $t('bitcoin.psbtReview.leavesWallet') : $t('bitcoin.psbtReview.entersWallet') }}
        </span>
        <span class="psbt-review__value g-num" data-testid="bitcoin-psbt-net">{{ btc(review.netSats < 0n ? -review.netSats : review.netSats) }} BTC</span>
      </div>
      <div class="psbt-review__row">
        <span class="psbt-review__label text-caption">{{ $t('miniGero.fee') }}</span>
        <span class="psbt-review__value text-caption g-num">{{ review.feeSats === null ? $t('common.unknown') : `${btc(review.feeSats)} BTC` }}</span>
      </div>

      <div class="psbt-review__heading text-caption">{{ $t('bitcoin.outputs') }}</div>
      <div v-for="out in review.outputs" :key="'o' + out.index" class="psbt-review__entry" data-testid="bitcoin-psbt-output">
        <div class="psbt-review__row">
          <span class="psbt-review__tag text-caption" :class="{ 'psbt-review__tag--external': !out.own }">
            {{ out.own ? $t('bitcoin.psbtReview.yours') : $t('dashboard.external') }}
          </span>
          <span class="psbt-review__value text-caption g-num">{{ btc(out.valueSats) }} BTC</span>
        </div>
        <span class="psbt-review__address text-caption g-mono">{{ out.address ?? $t('bitcoin.psbtReview.dataOutput') }}</span>
      </div>

      <div class="psbt-review__heading text-caption">{{ $t('bitcoin.psbtReview.youSign') }}</div>
      <div v-for="input in signedInputs" :key="'i' + input.index" class="psbt-review__entry" data-testid="bitcoin-psbt-signed-input">
        <div class="psbt-review__row">
          <span class="psbt-review__address text-caption g-mono">{{ input.address ?? '' }}</span>
          <span class="psbt-review__value text-caption g-num">
            {{ input.valueSats === null ? $t('common.unknown') : `${btc(input.valueSats)} BTC` }}
          </span>
        </div>
      </div>
      <p v-if="othersCount" class="psbt-review__note text-caption">{{ $t('bitcoin.psbtReview.othersSign', { count: othersCount }) }}</p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { satsToBtcString } from '@/chains/bitcoin/btcAmount';
import type { PsbtReview, PsbtReviewProblem } from '@/chains/bitcoin/psbtReview';

const props = defineProps<{ review: PsbtReview | null }>();
const { t } = useTranslation();

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

const btc = satsToBtcString;
const unparseable = computed(() => props.review?.problems.some((p) => p.code === 'unparseable') ?? false);
const problem = computed(() => {
  const first = props.review?.problems[0];
  if (!first) return '';
  return t(PROBLEM_KEYS[first.code], { index: 'index' in first ? first.index : '' }) as string;
});
const signedInputs = computed(() => props.review?.inputs.filter((input) => input.willSign) ?? []);
const othersCount = computed(() => props.review?.inputs.filter((input) => !input.own).length ?? 0);
</script>

<style scoped lang="scss">
.psbt-review {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  margin-bottom: var(--g-s-3);
  text-align: left;
}

.psbt-review__problem {
  display: flex;
  align-items: flex-start;
  padding: var(--g-s-2);
  border: 1px solid var(--g-error-line);
  border-radius: var(--g-r-chip);
  background: var(--g-error-fill);
  color: var(--g-error);
}

.psbt-review__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--g-s-2);
}

.psbt-review__total {
  padding-bottom: var(--g-s-1);
  border-bottom: 1px solid var(--g-hairline-1);
}

.psbt-review__label,
.psbt-review__heading,
.psbt-review__note {
  color: var(--g-text-2);
}

.psbt-review__heading {
  margin-top: var(--g-s-2);
}

.psbt-review__note {
  margin: 0;
}

.psbt-review__value {
  color: var(--g-text-1);
  white-space: nowrap;
}

.psbt-review__entry {
  display: flex;
  flex-direction: column;
  padding: var(--g-s-1) 0;
  border-top: 1px solid var(--g-hairline-1);
}

.psbt-review__address {
  color: var(--g-text-2);
  overflow-wrap: anywhere;
}

.psbt-review__tag {
  color: var(--g-text-2);
}

.psbt-review__tag--external {
  color: var(--g-warning);
}
</style>
