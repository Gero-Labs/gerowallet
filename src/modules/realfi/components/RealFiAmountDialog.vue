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

      <p class="t-body-sm realfi-amount__note">{{ note }}</p>

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
  toSmallestUnit,
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

.realfi-amount__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--g-s-2);
}
</style>
