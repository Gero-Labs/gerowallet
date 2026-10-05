<template>
  <div class="order-shipping">
    <div class="order-shipping__options" role="radiogroup" :aria-label="t('card.selectShippingMethod')">
      <CardOption
        v-for="option in options"
        :key="option.id"
        name="shipping-method"
        :value="option.id"
        :title="option.label"
        :description="option.description"
        :selected="selectedMethod === option.id"
        :disabled="option.disabled"
        @select="emit('select', option.id)"
      >
        <template #aside>
          <span v-if="!option.disabled" class="t-body-lg g-num">{{ option.price }}</span>
          <CardChip v-else>{{ t('common.comingSoon') }}</CardChip>
        </template>
      </CardOption>
    </div>
    <p class="t-caption order-shipping__eta">
      <v-icon x-small>mdi-truck-outline</v-icon>
      {{ t('card.estimatedDelivery') }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { cardMoney } from '@/modules/wallet/utils/cardFormat';
import CardChip from '../../ui/CardChip.vue';
import CardOption from '../../ui/CardOption.vue';
import type { ShippingMethod } from '@/modules/wallet/utils/cardOrder';

defineProps<{ selectedMethod: ShippingMethod }>();
const emit = defineEmits<{ (e: 'select', method: ShippingMethod): void }>();

const { t } = useTranslation();

/** The only live method today; express prices are not published by the provider yet. */
const STANDARD_FEE_EUR = 10;

const options = computed(() => [
  { id: 'regular' as ShippingMethod, label: t('card.standardShipping'), description: t('card.euOrWorldwide'), price: cardMoney(STANDARD_FEE_EUR), disabled: false },
  { id: 'express-eu' as ShippingMethod, label: t('card.expressShippingEU'), description: t('card.expressShippingEUTime'), price: '', disabled: true },
  { id: 'express-worldwide' as ShippingMethod, label: t('card.expressShippingWorldwide'), description: t('card.expressShippingWorldwideTime'), price: '', disabled: true },
]);
</script>

<style lang="scss" scoped>
.order-shipping {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
}

.order-shipping__options {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
}

.order-shipping__eta {
  display: flex;
  align-items: center;
  gap: var(--g-s-1);
  margin: 0;
}
</style>
