<template>
  <!-- Shown once the delivery fee was submitted; the dashboard tracker follows the rest. -->
  <div class="order-done">
    <p class="order-done__row t-body">
      <v-icon small>mdi-truck-outline</v-icon>
      {{ t('card.estimatedDelivery') }}
    </p>
    <p class="order-done__row t-body">
      <v-icon small>mdi-email-outline</v-icon>
      {{ t('card.confirmationEmailSent') }}
    </p>
    <p class="t-caption">{{ t('card.followOrderOnDashboard') }}</p>
  </div>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';

const { t } = useTranslation();
</script>

<style lang="scss" scoped>
.order-done {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);

  p {
    margin: 0;
  }
}

.order-done__row {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  color: var(--g-text-1);

  .v-icon {
    color: var(--g-accent);
  }
}
</style>
