<template>
  <v-card outlined class="liquid-glass pa-4">
    <div class="d-flex align-center mb-4" style="gap: 12px;">
      <v-avatar size="40" color="#F7931A20">
        <v-icon color="#F7931A" size="22">mdi-pickaxe</v-icon>
      </v-avatar>
      <div>
        <div class="text-subtitle-1 font-weight-bold">{{ $t('gomining.miningOverview') }}</div>
        <div class="text-caption text--secondary">{{ $t('gomining.poweredByGoMining') }}</div>
      </div>
      <v-spacer />
      <v-btn icon small :loading="loading" @click="$emit('refresh')">
        <v-icon small>mdi-refresh</v-icon>
      </v-btn>
    </div>

    <v-row no-gutters>
      <!-- Total Hashrate -->
      <v-col cols="6" sm="3" class="pa-2">
        <div class="stat-block">
          <div class="text-caption text--secondary mb-1">{{ $t('gomining.totalHashrate') }}</div>
          <div class="text-h6 font-weight-bold primary--text">
            {{ stats ? formatHashrate(stats.totalHashrate) : '—' }}
          </div>
        </div>
      </v-col>

      <!-- Active Miners -->
      <v-col cols="6" sm="3" class="pa-2">
        <div class="stat-block">
          <div class="text-caption text--secondary mb-1">{{ $t('gomining.activeMiners') }}</div>
          <div class="text-h6 font-weight-bold">
            <span class="success--text">{{ stats ? stats.activeMiners : '—' }}</span>
            <span class="text-caption text--secondary ml-1" v-if="stats">
              / {{ stats.totalMiners }}
            </span>
          </div>
        </div>
      </v-col>

      <!-- Daily Earnings -->
      <v-col cols="6" sm="3" class="pa-2">
        <div class="stat-block">
          <div class="text-caption text--secondary mb-1">{{ $t('gomining.dailyEarnings') }}</div>
          <div class="text-h6 font-weight-bold success--text">
            {{ stats ? formatBtc(stats.dailyIncomeBtc) : '—' }}
          </div>
        </div>
      </v-col>

      <!-- Total Earned -->
      <v-col cols="6" sm="3" class="pa-2">
        <div class="stat-block">
          <div class="text-caption text--secondary mb-1">{{ $t('gomining.totalEarned') }}</div>
          <div class="text-h6 font-weight-bold">
            {{ stats ? formatBtc(stats.totalEarnedBtc) : '—' }}
          </div>
        </div>
      </v-col>
    </v-row>
  </v-card>
</template>

<script setup lang="ts">
import type { GoMiningUserStats } from '@/api/gomining-api';

defineProps<{
  stats: GoMiningUserStats | null;
  loading?: boolean;
}>();

defineEmits<{ refresh: [] }>();

function formatHashrate(ths: number): string {
  if (ths >= 1000) return `${(ths / 1000).toFixed(2)} PH/s`;
  return `${ths.toFixed(2)} TH/s`;
}

function formatBtc(btc: number): string {
  if (!btc) return '0.00000000 BTC';
  return `${btc.toFixed(8)} BTC`;
}
</script>

<style scoped>
.stat-block {
  text-align: center;
  padding: 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
}
</style>