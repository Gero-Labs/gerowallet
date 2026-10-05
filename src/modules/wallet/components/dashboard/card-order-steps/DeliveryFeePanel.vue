<template>
  <div class="fee-panel">
    <div class="fee-panel__amount glass-tier">
      <span class="t-label">{{ t('card.shippingFee') }}</span>
      <span class="fee-panel__figures">
        <span class="t-title g-num">{{ estimate ? '≈ ' : '' }}{{ adaText }} ADA</span>
        <span class="t-body g-num">{{ eurText }}</span>
      </span>
      <span v-if="estimate" class="t-caption">{{ t('card.feeEstimateNote') }}</span>
    </div>

    <CardAddressRow v-if="address" :label="t('card.payTo')" :address="address" />

    <p v-if="countdown" class="fee-panel__expiry t-body-sm">
      <v-icon small>mdi-clock-outline</v-icon>
      {{ t('card.addressValidFor', { time: countdown }) }}
    </p>
    <p v-else-if="expired" class="fee-panel__expiry is-expired t-body-sm" role="alert">
      <v-icon small>mdi-clock-alert-outline</v-icon>
      {{ t('card.paymentExpired') }}
    </p>

    <div class="fee-panel__notice">
      <v-icon small>mdi-information-outline</v-icon>
      <div>
        <p class="t-body-sm fee-panel__notice-title">{{ t('card.importantInformation') }}</p>
        <p class="t-body-sm">{{ t('card.paymentCoversShippingOnly') }} {{ t('card.notATopUp') }}</p>
        <p v-if="address" class="t-caption">{{ t('card.oneTimePaymentAddress') }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { adaFigure, cardMoney } from '@/modules/wallet/utils/cardFormat';
import CardAddressRow from '../../ui/CardAddressRow.vue';

const props = withDefaults(defineProps<{
  amountAda?: number;
  amountEur: number;
  /** The amount is computed from today's rate; the provider sets the final one. */
  estimate?: boolean;
  /** The provider's one-time deposit address, validated by the caller. */
  address?: string;
  expiresAt?: string;
}>(), { amountAda: undefined, estimate: false, address: undefined, expiresAt: undefined });

const { t } = useTranslation();

const adaText = computed(() => (props.amountAda && props.amountAda > 0 ? adaFigure(props.amountAda) : '—'));
const eurText = computed(() => cardMoney(props.amountEur || 0));

const now = ref(Date.now());
const deadline = computed(() => (props.expiresAt ? Date.parse(props.expiresAt) : NaN));
const expired = computed(() => Number.isFinite(deadline.value) && deadline.value <= now.value);
const countdown = computed(() => {
  if (!Number.isFinite(deadline.value)) return '';
  const left = deadline.value - now.value;
  if (left <= 0) return '';
  const minutes = Math.floor(left / 60000);
  const seconds = Math.floor((left % 60000) / 1000);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
});

let clock: ReturnType<typeof setInterval> | null = null;
watch(
  () => props.expiresAt,
  expiresAt => {
    if (clock) clearInterval(clock);
    clock = expiresAt ? setInterval(() => { now.value = Date.now(); }, 1000) : null;
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  if (clock) clearInterval(clock);
});
</script>

<style lang="scss" scoped>
.fee-panel {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);

  p {
    margin: 0;
  }
}

.fee-panel__amount {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  padding: var(--g-s-4);
}

.fee-panel__figures {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--g-s-3);
}

.fee-panel__expiry {
  display: flex;
  align-items: center;
  gap: var(--g-s-1);
  font-variant-numeric: tabular-nums;

  &.is-expired {
    color: var(--g-error);

    .v-icon {
      color: var(--g-error);
    }
  }
}

.fee-panel__notice {
  display: flex;
  gap: var(--g-s-3);
  padding: var(--g-s-3) var(--g-s-4);
  border-radius: var(--g-r-control);
  background: color-mix(in srgb, var(--g-accent) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--g-accent) 22%, transparent);

  > .v-icon {
    align-self: flex-start;
    color: var(--g-accent);
  }

  > div {
    display: flex;
    flex-direction: column;
    gap: var(--g-s-1);
  }
}

.fee-panel__notice-title {
  color: var(--g-text-1);
  font-weight: 550;
}
</style>
