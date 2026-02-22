<template>
  <v-card outlined class="liquid-glass">
    <v-card-title class="d-flex align-center" style="gap: 8px;">
      <v-icon color="primary" small>mdi-store</v-icon>
      <span class="text-subtitle-1 font-weight-bold">{{ $t('gomining.minerShop') }}</span>
      <v-spacer />
      <v-chip x-small outlined color="success">
        <v-icon x-small left>mdi-check-circle</v-icon>
        {{ $t('gomining.poweredByGoMining') }}
      </v-chip>
    </v-card-title>

    <v-divider />

    <!-- Loading skeleton -->
    <v-card-text v-if="loading">
      <v-row>
        <v-col v-for="i in 4" :key="i" cols="12" sm="6" md="3">
          <v-skeleton-loader type="card" />
        </v-col>
      </v-row>
    </v-card-text>

    <!-- Empty state -->
    <div v-else-if="collections.length === 0" class="text-center pa-8">
      <v-icon size="56" color="grey" class="mb-3">mdi-store-off</v-icon>
      <div class="text-body-1">{{ $t('gomining.noCollectionsAvailable') }}</div>
    </div>

    <!-- Collections grid -->
    <v-card-text v-else>
      <v-row>
        <v-col
          v-for="collection in collections"
          :key="collection.id"
          cols="12"
          sm="6"
          md="4"
          lg="3"
        >
          <v-card outlined class="collection-card pa-3 d-flex flex-column" style="height: 100%;">
            <!-- Collection image -->
            <v-img
              :src="collection.imageUrl"
              height="140"
              contain
              class="mb-3 rounded"
            >
              <template #placeholder>
                <v-row class="fill-height ma-0" align="center" justify="center">
                  <v-icon size="48" color="#F7931A40">mdi-pickaxe</v-icon>
                </v-row>
              </template>
            </v-img>

            <!-- Collection name -->
            <div class="text-subtitle-2 font-weight-bold text-truncate mb-2">
              {{ collection.name }}
            </div>

            <!-- Stats -->
            <div class="d-flex align-center justify-space-between mb-1">
              <span class="text-caption text--secondary">{{ $t('gomining.hashrate') }}</span>
              <span class="text-caption font-weight-medium primary--text">
                {{ collection.hashrate }} TH/s
              </span>
            </div>

            <div class="d-flex align-center justify-space-between mb-1">
              <span class="text-caption text--secondary">{{ $t('gomining.efficiency') }}</span>
              <span class="text-caption font-weight-medium">
                ${{ collection.efficiency.toFixed(2) }}/TH
              </span>
            </div>

            <div class="d-flex align-center justify-space-between mb-3">
              <span class="text-caption text--secondary">{{ $t('gomining.available') }}</span>
              <span class="text-caption font-weight-medium">
                {{ collection.available }}
              </span>
            </div>

            <v-spacer />

            <!-- Price + Buy button -->
            <div class="d-flex align-center justify-space-between mt-2">
              <div>
                <div class="text-caption text--secondary">{{ $t('gomining.price') }}</div>
                <div class="text-subtitle-2 font-weight-bold">
                  {{ collection.price.toFixed(2) }} {{ collection.currency }}
                </div>
              </div>
              <v-btn
                small
                color="primary"
                :disabled="collection.available === 0"
                @click="$emit('buy', collection)"
              >
                <v-icon small left>mdi-cart-plus</v-icon>
                {{ $t('gomining.buy') }}
              </v-btn>
            </div>
          </v-card>
        </v-col>
      </v-row>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import type { GoMiningCollection } from '@/api/gomining-api';

defineProps<{
  collections: GoMiningCollection[];
  loading?: boolean;
}>();

defineEmits<{ buy: [collection: GoMiningCollection] }>();
</script>

<style scoped>
.collection-card {
  transition: border-color 0.2s, transform 0.15s;
  border-radius: 12px !important;
}
.collection-card:hover {
  border-color: #F7931A80;
  transform: translateY(-2px);
}
</style>