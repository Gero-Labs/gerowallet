<template>
  <div class="balance-cards">
    <BalanceCard title="Card Balance" :primary-value="`€${cardBalance}`" :secondary-value="cardBalanceAda" />
    <!-- <BalanceCard title="Total Deposit" :primary-value="`€${totalDeposit}`" :secondary-value="totalDepositAda" />
    <BalanceCard title="€GERO Tier" primary-value="GOLD" secondary-value="0% Fees on all services" :is-gero="true" /> -->
  </div>
</template>

<script setup lang="ts">
import BalanceCard from './BalanceCard.vue';

interface Props {
  cardBalance?: string;
  cardBalanceAda?: string;
  geroEarned?: string;
  totalDeposit?: string;
  totalDepositAda?: string;
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
