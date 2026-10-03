<template>
  <div class="topup-amount">
    <div class="topup-amount__rate glass-tier">
      <span class="t-body-sm">{{ t('card.todaysRate') }}</span>
      <span class="t-body-lg g-num">{{ rateText }}</span>
    </div>

    <div class="topup-amount__fields">
      <label class="topup-amount__field is-primary">
        <span class="t-label">{{ t('card.amount') }}</span>
        <span class="topup-amount__input-row">
          <input
            :value="primaryValue"
            class="topup-amount__input g-num"
            inputmode="decimal"
            autocomplete="off"
            placeholder="0"
            :aria-label="`${t('card.amount')} (${primaryCurrency})`"
            @input="onPrimaryEvent"
          />
          <CardChip>{{ primaryCurrency }}</CardChip>
        </span>
      </label>

      <v-btn
        icon
        outlined
        class="topup-amount__swap"
        :aria-label="t('card.switchCurrency')"
        @click="inEur = !inEur"
      >
        <v-icon small>mdi-swap-vertical</v-icon>
      </v-btn>

      <div class="topup-amount__field">
        <span class="t-label">{{ t('card.cardWillReceiveExactly') }}</span>
        <span class="topup-amount__input-row">
          <span class="topup-amount__secondary g-num">{{ secondaryValue || '0' }}</span>
          <CardChip>{{ secondaryCurrency }}</CardChip>
        </span>
      </div>
    </div>

    <div class="topup-amount__meta">
      <span class="t-body-sm">{{ t('card.yourAdaBalance') }} <span class="g-num topup-amount__balance">₳{{ adaBalance }}</span></span>
      <span class="t-caption topup-amount__min" :class="{ 'is-error': belowMinimum }">
        <v-icon x-small>mdi-information-outline</v-icon>
        {{ t('card.minimumTopUp', { amount: minAda }) }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import walletStore from '@/stores/walletStore';
import { adaFigure, cardMoney } from '@/modules/wallet/utils/cardFormat';
import CardChip from '../../ui/CardChip.vue';

const props = defineProps<{
  modelValue: { adaAmount: string; eurAmount: string };
  /** EUR per ADA (the provider's buy rate), 0 while unknown. */
  rate: number;
  minAda: number;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: { adaAmount: string; eurAmount: string }): void;
}>();

const { t } = useTranslation();

/** Typing in euros instead of ADA. */
const inEur = ref(false);

const primaryCurrency = computed(() => (inEur.value ? 'EUR' : 'ADA'));
const secondaryCurrency = computed(() => (inEur.value ? 'ADA' : 'EUR'));
const primaryValue = computed(() => (inEur.value ? props.modelValue.eurAmount : props.modelValue.adaAmount));
const secondaryValue = computed(() => (inEur.value ? props.modelValue.adaAmount : props.modelValue.eurAmount));

const rateText = computed(() => (props.rate > 0 ? `₳1 ADA = ${cardMoney(props.rate)} EUR` : '—'));

const adaBalance = computed(() => {
  const lovelace = Number(walletStore.state.account?.controlled_amount ?? 0);
  return adaFigure(Number.isFinite(lovelace) ? lovelace / 1_000_000 : 0);
});

const belowMinimum = computed(() => {
  const ada = parseFloat(props.modelValue.adaAmount);
  return props.modelValue.adaAmount !== '' && (!Number.isFinite(ada) || ada < props.minAda);
});

/** Digits with one decimal point, ADA to 6 places and EUR to 2. */
function sanitize(raw: string, decimals: number): string {
  const cleaned = raw.replace(',', '.').replace(/[^\d.]/g, '');
  const [whole = '', ...rest] = cleaned.split('.');
  return rest.length ? `${whole}.${rest.join('').slice(0, decimals)}` : whole;
}

function onPrimaryInput(raw: string): void {
  const rate = props.rate;
  if (inEur.value) {
    const eurAmount = sanitize(raw, 2);
    const eur = parseFloat(eurAmount);
    const adaAmount = Number.isFinite(eur) && rate > 0 ? (eur / rate).toFixed(2) : '';
    emit('update:modelValue', { adaAmount, eurAmount });
  } else {
    const adaAmount = sanitize(raw, 6);
    const ada = parseFloat(adaAmount);
    const eurAmount = Number.isFinite(ada) && rate > 0 ? (ada * rate).toFixed(2) : '';
    emit('update:modelValue', { adaAmount, eurAmount });
  }
}

function onPrimaryEvent(event: Event): void {
  onPrimaryInput((event.target as HTMLInputElement).value);
}

// A rate that arrives (or moves) after typing re-derives the other side.
watch(
  () => props.rate,
  () => {
    if (primaryValue.value) onPrimaryInput(primaryValue.value);
  },
);
</script>

<style lang="scss" scoped>
.topup-amount {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
}

.topup-amount__rate {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
  padding: var(--g-s-3) var(--g-s-4);
}

.topup-amount__fields {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--g-s-2);
}

/* Justified solid: an amount field is a control. */
.topup-amount__field {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  padding: var(--g-s-3) var(--g-s-4);
  border-radius: var(--g-r-control);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-2);
}

.topup-amount__field.is-primary:focus-within {
  border-color: var(--g-accent);
}

.topup-amount__input-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
}

.topup-amount__input {
  width: 100%;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--g-text-1);
  font-family: inherit;
  font-size: 32px;
  font-weight: 620;
  letter-spacing: -0.02em;
}

.topup-amount__input:focus-visible {
  outline-offset: 4px;
}

.topup-amount__secondary {
  color: var(--g-text-1);
  font-size: 24px;
  font-weight: 620;
}

.topup-amount__swap {
  align-self: center;
  border-color: color-mix(in srgb, var(--g-accent) 40%, transparent);

  .v-icon {
    color: var(--g-accent);
  }
}

.topup-amount__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-2);
}

.topup-amount__balance {
  color: var(--g-text-1);
}

.topup-amount__min {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-1);

  &.is-error {
    color: var(--g-error);
  }
}
</style>
