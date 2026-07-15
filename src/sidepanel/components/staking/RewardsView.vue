<template>
  <div class="rewards-view">
    <div v-if="!rewards.length" class="empty-state">
      <v-icon size="40" class="mb-2" :color="themeColors.primary">mdi-trophy-outline</v-icon>
      <div class="text-body-2 grey--text">{{ $t('miniGero.rewardsEmpty') }}</div>
    </div>

    <div v-else class="rewards-list">
      <div
        v-for="r in rewards"
        :key="r.epoch"
        class="reward-row"
      >
        <div class="reward-icon">
          <v-icon small :color="themeColors.primary">mdi-star-circle-outline</v-icon>
        </div>
        <div class="reward-info">
          <div class="reward-title text-body-2 white--text">{{ $t('miniGero.rewardsEpoch', { epoch: r.epoch }) }}</div>
          <div class="reward-date text-caption grey--text">{{ formatPool(r.pool_id) }}</div>
        </div>
        <div class="reward-amount text-body-2" :style="{ color: themeColors.primary }">+{{ formatAmount(r.amount) }} {{ currencyTicker }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { useChainContext } from '../../composables/useChainContext';

const { themeColors, networkInfo } = useChainContext();

interface RewardEntry {
  epoch: number;
  amount: bigint | number | string;
  pool_id?: string;
  type?: string;
}

const rewards = computed<RewardEntry[]>(() => {
  const history = walletStore.rewards;
  if (!history || !Array.isArray(history)) return [];
  // Newest epochs first for a chronological payout list.
  return [...(history as RewardEntry[])].sort((a, b) => Number(b.epoch) - Number(a.epoch));
});

const currencyTicker = computed(() => networkInfo.value?.currencyTicker || 'AP3X');

function formatAmount(amount: bigint | number | string): string {
  const n = Number(amount);
  if (!isFinite(n)) return '0';
  const inUnits = n / 1_000_000;
  return inUnits.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function formatPool(poolId?: string): string {
  if (!poolId) return '';
  if (poolId.length <= 16) return poolId;
  return `${poolId.slice(0, 10)}…${poolId.slice(-6)}`;
}
</script>

<style scoped>
.rewards-view {
  display: flex;
  flex-direction: column;
  padding: 8px 16px;
}

.empty-state {
  text-align: center;
  padding: 40px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.rewards-list {
  display: flex;
  flex-direction: column;
}

.reward-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--g-hairline-1);
}

.reward-icon {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--g-accent) 16%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
}

.reward-info {
  flex: 1;
}

.reward-title {
  font-weight: 600;
}

.reward-date {
  font-size: 11px;
}

.reward-amount {
  font-weight: 600;
}
</style>
