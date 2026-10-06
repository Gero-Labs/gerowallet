<template>
  <div class="card-address">
    <div class="card-address__head">
      <span class="t-label">{{ label }}</span>
      <span class="card-address__verified">
        <v-icon x-small>mdi-shield-check-outline</v-icon>
        {{ t('card.depositAddressVerified') }}
      </span>
    </div>
    <div class="card-address__value">
      <span class="g-mono" :title="address">{{ short }}</span>
      <CopyButton x-small :value="address" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import CopyButton from '@/shared/components/CopyButton.vue';

const props = defineProps<{
  label: string;
  /** Already validated with isCardDepositAddress by the caller. */
  address: string;
}>();

const { t } = useTranslation();

// Enough of both ends to compare against another screen, which a 16-character cut hides.
const short = computed(() =>
  props.address.length > 28 ? `${props.address.slice(0, 14)}…${props.address.slice(-10)}` : props.address,
);
</script>

<style lang="scss" scoped>
/* Justified solid: an address is a control-like value block, not a surface. */
.card-address {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  padding: var(--g-s-3) var(--g-s-4);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
}

.card-address__head,
.card-address__value {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-2);
}

.card-address__verified {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-1);
  font-size: 12px;
  color: var(--g-success);

  .v-icon {
    color: var(--g-success);
  }
}

.card-address__value .g-mono {
  word-break: normal;
}
</style>
