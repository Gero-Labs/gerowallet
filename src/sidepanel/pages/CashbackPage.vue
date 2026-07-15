<template>
  <div class="cashback-page">
    <!-- Header with back button -->
    <div class="cashback-header pa-4">
      <div class="d-flex align-center">
        <v-btn icon small class="mr-2" @click="$router.push('/')">
          <v-icon color="white">mdi-arrow-left</v-icon>
        </v-btn>
        <div>
          <div class="text-h6 white--text">{{ $t('miniGero.cashback') }}</div>
          <div class="text-caption grey--text">{{ $t('miniGero.cashbackPoweredBy') }}</div>
        </div>
      </div>
    </div>

    <div class="cashback-body">
      <CashbackPortal />
    </div>
  </div>
</template>

<script setup lang="ts">
import CashbackPortal from '@/modules/cashback/CashbackPortal.vue';
</script>

<style scoped>
.cashback-page {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.cashback-header {
  padding-bottom: 8px !important;
  flex-shrink: 0;
}

.cashback-body {
  flex: 1;
  min-height: 0;
  display: flex;
}
</style>
