<template>
  <!-- Shared glass-panel material; only layout lives here. -->
  <section class="glass-panel gm-balance" :aria-label="$t('gomining.miningBalance')">
    <div class="gm-balance__head">
      <span class="gm-balance__icon"><v-icon size="18">mdi-bitcoin</v-icon></span>
      <span class="t-body-lg">{{ $t('gomining.miningBalance') }}</span>
    </div>

    <div class="gm-balance__amount">
      <span class="t-label">{{ $t('gomining.availableBalance') }}</span>
      <div class="gm-balance__primary">
        <span class="t-display g-num">{{ formatBtc(balances?.availableSats ?? 0) }}</span>
        <span class="gm-balance__unit g-mono">BTC</span>
      </div>
      <span v-if="balances && balances.withdrawnSats > 0" class="t-caption g-num gm-balance__pending">
        <v-icon size="x-small">mdi-arrow-up-circle-outline</v-icon>
        {{ $t('gomining.withdrawnToDate', { amount: `${formatBtc(balances.withdrawnSats)} BTC` }) }}
      </span>
    </div>

    <GButton
      tier="primary"
      block
      :disabled="!balances || balances.availableSats <= 0 || !payoutAddress || loading"
      :loading="loading"
      @click="$emit('withdraw')"
    >
      <v-icon size="small" start>mdi-arrow-up-circle-outline</v-icon>
      {{ $t('gomining.withdraw') }}
    </GButton>

    <div v-if="payoutAddress" class="gm-balance__address" :title="payoutAddress">
      <v-icon size="x-small" class="gm-balance__check">mdi-check-circle</v-icon>
      <span class="t-caption">{{ $t('gomining.payoutAddress') }}</span>
      <span class="g-mono gm-balance__address-value">{{ shortAddress(payoutAddress) }}</span>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { GoMiningBalances } from '@/api/gomining-api';
import { formatBtc } from '@/shared/utils/format';
import GButton from '@/shared/components/GButton/GButton.vue';

defineProps<{
  balances: GoMiningBalances | null;
  /** The linked address GoMining pays withdrawals to. */
  payoutAddress?: string | null;
  loading?: boolean;
}>();

defineEmits<{ withdraw: [] }>();

function shortAddress(addr: string): string {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}
</script>

<style scoped lang="scss">
.gm-balance {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  height: 100%;
  padding: var(--g-s-4);
}

.gm-balance__head {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
}

.gm-balance__icon {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--g-r-control);
  background: var(--g-hairline-1);
}

.gm-balance__icon .v-icon {
  color: var(--g-text-2);
}

.gm-balance__amount {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}

.gm-balance__primary {
  display: flex;
  align-items: baseline;
  gap: var(--g-s-2);
  line-height: 1.1;
}

.gm-balance__unit {
  color: var(--g-text-3);
}

.gm-balance__pending {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-1);
}

.gm-balance__address {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--g-s-1);
}

.gm-balance__check {
  color: var(--g-success);
}

.gm-balance__address-value {
  color: var(--g-text-1);
}
</style>
