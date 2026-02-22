<template>
  <v-card outlined class="liquid-glass">
    <v-card-title class="d-flex align-center" style="gap: 8px;">
      <v-icon color="primary" small>mdi-pickaxe</v-icon>
      <span class="text-subtitle-1 font-weight-bold">{{ $t('gomining.myMiners') }}</span>
      <v-chip x-small color="primary" class="ml-1" v-if="miners.length">
        {{ miners.length }}
      </v-chip>
      <v-spacer />
      <v-btn text small color="primary" @click="$emit('buy-more')">
        <v-icon small left>mdi-plus</v-icon>
        {{ $t('gomining.buyMore') }}
      </v-btn>
    </v-card-title>

    <v-divider />

    <!-- Empty state -->
    <div v-if="!loading && miners.length === 0" class="text-center pa-8">
      <v-icon size="56" color="#F7931A40" class="mb-3">mdi-pickaxe</v-icon>
      <div class="text-body-1 font-weight-medium mb-2">{{ $t('gomining.noMinersYet') }}</div>
      <div class="text-caption text--secondary mb-4">{{ $t('gomining.noMinersDescription') }}</div>
      <v-btn color="primary" @click="$emit('buy-more')">
        <v-icon left small>mdi-cart-plus</v-icon>
        {{ $t('gomining.browseMinerShop') }}
      </v-btn>
    </div>

    <!-- Loading skeleton -->
    <v-card-text v-else-if="loading">
      <v-row>
        <v-col v-for="i in 3" :key="i" cols="12" sm="6" md="4">
          <v-skeleton-loader type="card" />
        </v-col>
      </v-row>
    </v-card-text>

    <!-- Miners grid -->
    <v-card-text v-else>
      <v-row>
        <v-col
          v-for="miner in miners"
          :key="miner.id"
          cols="12"
          sm="6"
          md="4"
          lg="3"
        >
          <v-card outlined class="miner-card pa-3">
            <!-- Miner image -->
            <v-img
              :src="miner.imageUrl || defaultMinerImage"
              height="120"
              contain
              class="mb-3 rounded"
            >
              <template #placeholder>
                <v-row class="fill-height ma-0" align="center" justify="center">
                  <v-icon size="48" color="#F7931A40">mdi-pickaxe</v-icon>
                </v-row>
              </template>
            </v-img>

            <!-- Miner info -->
            <div class="text-subtitle-2 font-weight-bold text-truncate mb-1">
              {{ miner.name }}
            </div>

            <div class="d-flex align-center justify-space-between mb-1">
              <span class="text-caption text--secondary">{{ $t('gomining.hashrate') }}</span>
              <span class="text-caption font-weight-medium primary--text">
                {{ miner.hashrate }} TH/s
              </span>
            </div>

            <div class="d-flex align-center justify-space-between mb-2">
              <span class="text-caption text--secondary">{{ $t('gomining.dailyIncome') }}</span>
              <span class="text-caption font-weight-medium success--text">
                +{{ miner.dailyIncomeBtc.toFixed(8) }} BTC
              </span>
            </div>

            <!-- Status chip -->
            <v-chip
              x-small
              :color="miner.status === 'active' ? 'success' : 'grey'"
              class="mt-1"
            >
              <v-icon x-small left>
                {{ miner.status === 'active' ? 'mdi-circle' : 'mdi-circle-outline' }}
              </v-icon>
              {{ miner.status === 'active' ? $t('gomining.active') : $t('gomining.inactive') }}
            </v-chip>
          </v-card>
        </v-col>
      </v-row>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import type { GoMiningNft } from '@/api/gomining-api';

defineProps<{
  miners: GoMiningNft[];
  loading?: boolean;
}>();

defineEmits<{ 'buy-more': [] }>();

const defaultMinerImage = '';
</script>

<style scoped>
.miner-card {
  transition: border-color 0.2s;
  border-radius: 12px !important;
}
.miner-card:hover {
  border-color: #F7931A80;
}
</style>