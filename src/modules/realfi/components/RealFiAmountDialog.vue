<template>
  <BaseDialog
    :isOpen="isOpen"
    size="sm"
    :min-height="0"
    :title="title"
    @close="$emit('close')"
  >
    <v-card-text class="pt-4 px-0">
      <div class="realfi-amount__head">
        <span class="t-caption">{{ $t('common.amount') }}</span>
        <span class="t-caption g-num">
          {{ $t('realfi.order.available', { amount: availableLabel }) }}
        </span>
      </div>

      <v-text-field
        v-model="input"
        outlined
        dense
        autofocus
        inputmode="decimal"
        class="g-num"
        :suffix="ticker"
        :error-messages="errorMessage"
        @keydown.enter="confirm()"
      >
        <template #append>
          <GButton tier="tertiary" compact @click="useMax()">{{ $t('common.max') }}</GButton>
        </template>
      </v-text-field>

      <!-- What comes back, before anything is signed: the other side of the trade at
           today's rate, and for a stake what a year at the average yield would add. -->
      <dl v-if="preview" class="realfi-amount__preview">
        <div class="realfi-amount__row">
          <dt class="t-caption">{{ $t('market.youReceive') }}</dt>
          <dd class="t-body g-num realfi-amount__strong">{{ preview.receive }}</dd>
        </div>
        <div class="realfi-amount__row">
          <dt class="t-caption">{{ $t('miniGero.rate') }}</dt>
          <dd class="t-body-sm g-num">{{ preview.rate }}</dd>
        </div>
        <div v-if="preview.earnings" class="realfi-amount__row">
          <dt class="t-caption">{{ $t('realfi.order.earnings') }}</dt>
          <dd class="t-body-sm g-num">{{ preview.earnings }}</dd>
        </div>
      </dl>

      <p class="t-body-sm realfi-amount__note">{{ note }}</p>
      <p v-if="preview && preview.earnings" class="t-caption realfi-amount__fine">
        {{ $t('realfi.order.earningsNote', { rate: apyLabel }) }}
      </p>

      <div class="realfi-amount__actions">
        <GButton tier="tertiary" @click="$emit('close')">{{ $t('common.cancel') }}</GButton>
        <GButton tier="primary" :disabled="!amountUnits" @click="confirm()">
          {{ confirmLabel }}
        </GButton>
      </div>
    </v-card-text>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import { formatUsd } from '@/shared/utils/format';
import i18n from '@/plugins/i18n';
import {
  compareUnits,
  fromSmallestUnit,
  REALFI_DECIMALS,
  susdrForUsdr,
  toSmallestUnit,
  usdrForSusdr,
  type SmallestUnit,
} from '../types';

/**
 * Amount entry for a stake (USDrf in) or an unstake (sUSDrf in).
 *
 * Works in smallest units throughout: what the user typed is parsed as a string and
 * compared with the balance as bigints, so "Max" stakes the exact balance rather than
 * a float's idea of it.
 */
const props = defineProps<{
  isOpen: boolean;
  mode: 'stake' | 'unstake';
  /** Spendable balance of the input token, smallest units. */
  balanceUnits: SmallestUnit;
  /** Unstake only: when the released USDrf becomes claimable, already formatted. */
  unlockDate?: string;
  /** USDrf per sUSDrf, scaled by 1e6, as a decimal string. Absent: no preview. */
  rate?: string | null;
  /** Stake only: the average yield the earnings estimate uses, percent. */
  apyPercent?: number | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'confirm', amountUnits: SmallestUnit): void;
}>();

const t = (key: string, values?: Record<string, unknown>) => i18n.t(key, values) as string;

const input = ref('');

// A fresh dialog starts empty, never with the last order's amount.
watch(
  () => props.isOpen,
  (open) => {
    if (open) input.value = '';
  },
);

const ticker = computed(() => (props.mode === 'stake' ? 'USDrf' : 'sUSDrf'));

const title = computed(() =>
  t(props.mode === 'stake' ? 'realfi.order.stakeTitle' : 'realfi.order.unstakeTitle'),
);

const confirmLabel = computed(() =>
  t(props.mode === 'stake' ? 'receive.tabStake' : 'staking.unstake'),
);

const availableLabel = computed(
  () => `${formatUsd(fromSmallestUnit(props.balanceUnits), { symbol: false })} ${ticker.value}`,
);

const note = computed(() => {
  if (props.mode === 'stake') return t('realfi.order.stakeNote');
  return props.unlockDate
    ? t('realfi.order.unstakeNote', { date: props.unlockDate })
    : t('realfi.order.unstakeNoteNoDate');
});

const parsed = computed<SmallestUnit | null>(() => toSmallestUnit(input.value));

const errorMessage = computed(() => {
  if (!input.value.trim()) return '';
  if (!parsed.value) return t('realfi.order.invalidAmount');
  if (compareUnits(parsed.value, props.balanceUnits) > 0) return t('errors.insufficientBalance');
  return '';
});

/** The amount to order, or null while the input is empty or invalid. */
const apyLabel = computed(() =>
  props.apyPercent != null ? props.apyPercent.toFixed(1) : '',
);

/**
 * The trade's other side at today's rate, for a valid amount. An estimate by nature:
 * the order fills at the rate when RealFi processes it, which drifts up with yield.
 */
const preview = computed(() => {
  const units = parsed.value;
  if (!units || errorMessage.value || !props.rate) return null;
  const rate = BigInt(props.rate);
  if (rate <= 0n) return null;
  const rateText = t('realfi.rate', { rate: fromSmallestUnit(props.rate).toFixed(4) });
  if (props.mode === 'stake') {
    const yearly =
      props.apyPercent != null && props.apyPercent > 0
        ? fromSmallestUnit(units) * (props.apyPercent / 100)
        : null;
    return {
      receive: `≈ ${unitsText(susdrForUsdr(units, rate), 'sUSDrf')}`,
      rate: rateText,
      earnings:
        yearly !== null ? `≈ ${formatUsd(yearly, { symbol: false })} USDrf` : '',
    };
  }
  return {
    receive: `≈ ${unitsText(usdrForSusdr(units, rate), 'USDrf')}`,
    rate: rateText,
    earnings: '',
  };
});

function unitsText(units: SmallestUnit, ticker: string): string {
  return `${formatUsd(fromSmallestUnit(units), { symbol: false })} ${ticker}`;
}

const amountUnits = computed<SmallestUnit | null>(() =>
  parsed.value && !errorMessage.value ? parsed.value : null,
);

function useMax(): void {
  const units = props.balanceUnits.padStart(REALFI_DECIMALS + 1, '0');
  const whole = units.slice(0, -REALFI_DECIMALS);
  const fraction = units.slice(-REALFI_DECIMALS).replace(/0+$/, '');
  input.value = fraction ? `${whole}.${fraction}` : whole;
}

function confirm(): void {
  if (amountUnits.value) emit('confirm', amountUnits.value);
}
</script>

<style lang="scss" scoped>
.realfi-amount__head {
  display: flex;
  justify-content: space-between;
  gap: var(--g-s-3);
  margin-bottom: var(--g-s-2);
}

.realfi-amount__note {
  margin: 0 0 var(--g-s-4);
  color: var(--g-text-2);
}

.realfi-amount__preview {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  padding: var(--g-s-3);
  margin: 0 0 var(--g-s-3);
  background: var(--g-overlay);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
}

.realfi-amount__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--g-s-3);

  dd {
    margin: 0;
    text-align: right;
  }
}

.realfi-amount__strong {
  color: var(--g-text-1);
  font-weight: 600;
}

.realfi-amount__fine {
  margin: calc(var(--g-s-2) * -1) 0 var(--g-s-4);
  color: var(--g-text-3);
}

.realfi-amount__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--g-s-2);
}
</style>
