<template>
  <div class="balance-cards">
    <BalanceCard
      title="Card Balance"
      :primary-value="cardBalance"
      :secondary-value="cardanoBalance"
    />
    <BalanceCard
      title="Total Deposit"
      primary-value="$569.00"
      secondary-value="₳469.00"
    />
    <BalanceCard
      title="$GERO Earned"
      :primary-value="geroEarned"
      secondary-value="₳69.42"
      :is-gero="true"
    />
  </div>
</template>

<script setup lang="ts">
import BalanceCard from './BalanceCard.vue';

interface Props {
  cardBalance?: string;
  cardanoBalance?: string;
  geroEarned?: string;
}

defineProps<Props>();
</script>

<style lang="scss" scoped>
@import '../../styles/variables';
@import '../../styles/mixins';

.balance-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: $spacing-lg;
}

@media (max-width: $breakpoint-md) {
  .balance-cards {
    grid-template-columns: 1fr;
  }
}
</style> 