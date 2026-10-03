<template>
  <div class="order-type" role="radiogroup" :aria-label="t('card.cardType')">
    <CardOption
      name="card-type"
      value="virtual"
      :title="t('card.virtualCardOnly')"
      :description="t('card.virtualCardDescription')"
      :selected="selectedType === 'virtual'"
      :disabled="hasVirtualCard"
      @select="emit('select', 'virtual')"
    >
      <template #badge>
        <CardChip :tone="hasVirtualCard ? 'neutral' : 'success'">
          {{ hasVirtualCard ? t('card.alreadyOrdered') : t('card.free') }}
        </CardChip>
      </template>
      <ul class="order-type__checks">
        <li><v-icon small>mdi-check</v-icon>{{ t('card.instantActivation') }}</li>
        <li><v-icon small>mdi-check</v-icon>{{ t('card.onlinePayments') }}</li>
        <li><v-icon small>mdi-check</v-icon>{{ t('card.noShippingRequired') }}</li>
      </ul>
      <template #aside>
        <IsoScene name="virtual" class="order-type__art" />
      </template>
    </CardOption>

    <CardOption
      name="card-type"
      value="physical"
      :title="t('card.physicalPlusVirtualCard')"
      :description="t('card.physicalCardDescription')"
      :selected="selectedType === 'physical'"
      :disabled="physicalUnavailable"
      @select="emit('select', 'physical')"
    >
      <template #badge>
        <CardChip>{{ physicalBadge }}</CardChip>
      </template>
      <ul class="order-type__checks">
        <li><v-icon small>mdi-check</v-icon>{{ t('card.physicalCardDelivered') }}</li>
        <li><v-icon small>mdi-check</v-icon>{{ t('card.inStorePayments') }}</li>
        <li><v-icon small>mdi-check</v-icon>{{ t('card.atmWithdrawals') }}</li>
      </ul>
      <template #aside>
        <IsoScene name="physical" class="order-type__art" />
      </template>
    </CardOption>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import featureFlagsStore from '@/stores/featureFlagsStore';
import IsoScene from '@/shared/components/iso/IsoScene.vue';
import CardChip from '../../ui/CardChip.vue';
import CardOption from '../../ui/CardOption.vue';

const props = withDefaults(defineProps<{
  selectedType?: 'virtual' | 'physical';
  hasVirtualCard?: boolean;
  hasPhysicalCard?: boolean;
}>(), { selectedType: undefined, hasVirtualCard: false, hasPhysicalCard: false });

const emit = defineEmits<{ (e: 'select', type: 'virtual' | 'physical'): void }>();

const { t } = useTranslation();

const orderingEnabled = computed(() => featureFlagsStore.isPhysicalCardOrderingEnabled());
const physicalUnavailable = computed(() => props.hasPhysicalCard || !orderingEnabled.value);
const physicalBadge = computed(() => {
  if (props.hasPhysicalCard) return t('card.alreadyOrdered');
  if (!orderingEnabled.value) return t('common.comingSoon');
  return t('card.shippingFeeApplies');
});
</script>

<style lang="scss" scoped>
.order-type {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
}

.order-type__checks {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
  color: var(--g-text-2);

  li {
    display: flex;
    align-items: center;
    gap: var(--g-s-2);
  }

  .v-icon {
    color: var(--g-accent);
  }
}

.order-type__art {
  width: 112px;
}

@media (max-width: 520px) {
  .order-type__art {
    display: none;
  }
}
</style>
