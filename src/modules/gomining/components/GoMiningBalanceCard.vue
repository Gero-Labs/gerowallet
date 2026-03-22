<template>
  <v-card outlined class="liquid-glass pa-4">
    <div class="d-flex align-center mb-3" style="gap: 12px;">
      <v-icon color="#F7931A">mdi-bitcoin</v-icon>
      <span class="text-subtitle-1 font-weight-bold">{{ $t('gomining.miningBalance') }}</span>
    </div>

    <!-- Available balance -->
    <div class="text-center my-4">
      <div class="text-caption text--secondary mb-1">{{ $t('gomining.availableBalance') }}</div>
      <div class="text-h5 font-weight-bold">
        {{ balance ? formatBtc(balance.btc) : '0.00000000' }}
        <span class="text-subtitle-2 text--secondary ml-1">BTC</span>
      </div>
      <div class="text-caption text--secondary mt-1" v-if="balance && balance.pendingBtc > 0">
        <v-icon x-small class="mr-1">mdi-clock-outline</v-icon>
        {{ formatBtc(balance.pendingBtc) }} BTC {{ $t('gomining.pending') }}
      </div>
    </div>

    <!-- Withdraw button -->
    <v-btn
      block
      color="primary"
      outlined
      :disabled="!balance || balance.btc <= 0 || loading"
      :loading="loading"
      @click="$emit('withdraw')"
    >
      <v-icon left small>mdi-arrow-up-circle-outline</v-icon>
      {{ $t('gomining.withdraw') }}
    </v-btn>

    <!-- BTC address info -->
    <div class="mt-3 d-flex align-center" style="gap: 8px;" v-if="btcAddress">
      <v-icon x-small color="success">mdi-check-circle</v-icon>
      <span class="text-caption text--secondary">
        {{ $t('gomining.payoutAddress') }}: {{ shortAddress(btcAddress) }}
      </span>
    </div>
  </v-card>
</template>

<script setup lang="ts">
import type { GoMiningBalance } from '@/api/gomining-api';

defineProps<{
  balance: GoMiningBalance | null;
  btcAddress?: string;
  loading?: boolean;
}>();

defineEmits<{ withdraw: [] }>();

function formatBtc(btc: number): string {
  return btc.toFixed(8);
}

function shortAddress(addr: string): string {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}
</script>