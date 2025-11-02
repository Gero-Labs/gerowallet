<template>
  <v-card class="exchange-rate-card" outlined>
    <div class="card-header">
      <h3 class="card-title">{{ $t('card.exchangeRate') }}</h3>
    </div>

    <div class="exchange-rate-content">
      <div v-if="loadingError" class="error-message">
        {{ $t('common.failed') }}: {{ $t('card.exchangeRate') }}
      </div>
      <div v-else class="rate-item" v-for="rate in exchangeRates" :key="rate.id">
        <div class="d-flex flex-column">
          <div class="rate-info">
            <div class="currency-icon">
              <img :src="rate.icon" :alt="rate.currency" />
            </div>
            <div class="rate-details">
              <div class="currency-pair">{{ rate.pair }}</div>
              <div class="rate-value">{{ rate.value }}</div>
            </div>
          </div>
          <div class="last-updated">{{ $t('dashboard.lastUpdated') }}: {{ lastUpdated }}</div>
        </div>
      </div>
    </div>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import type { ExchangeRate } from '@/models/types';
import cardStore from '@/stores/modules/card';
import currencyEuro from '@/modules/wallet/icons/currency-euro.svg?url';

// Get exchange rate from store
const EXCHANGE_RATE = computed(() => {
  return Number(cardStore.state.exchangeRate?.buy) || 0;
});

// Format exchange rate value
const formattedRateValue = computed(() => {
  if (!EXCHANGE_RATE.value || EXCHANGE_RATE.value === 0) {
    return '—';
  }
  return EXCHANGE_RATE.value.toFixed(2);
});

// Compute exchange rates array dynamically
const exchangeRates = computed<ExchangeRate[]>(() => [
  {
    id: 1,
    pair: 'ADA/EUR',
    value: formattedRateValue.value,
    currency: 'EUR',
    icon: currencyEuro,
    change: '—', // Not displayed in UI (trend section removed)
    trend: 'positive' as 'positive' | 'negative', // Not displayed in UI
    trendIcon: '', // Not displayed in UI (unused import removed)
  },
]);

const lastUpdated = ref('');
const loadingError = ref(false);

const updateLastUpdated = () => {
  const now = new Date();
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  lastUpdated.value = `Today, ${hours}:${minutes}`;
};

// Watch for exchange rate changes and update timestamp
watch(
  () => cardStore.state.exchangeRate?.buy,
  () => {
    if (cardStore.state.exchangeRate?.buy) {
      updateLastUpdated();
      loadingError.value = false;
    }
  }
);

onMounted(() => {
  updateLastUpdated();
  // Fetch exchange rate if not already loaded
  if (!cardStore.state.exchangeRate) {
    cardStore.getExchangeRate().catch((err) => {
      console.error(err);
      loadingError.value = true;
    });
  }
});
</script>

<style lang="scss" scoped>
@import '../../styles/variables';
@import '../../styles/mixins';

.exchange-rate-card {
  background: $background-card;
  border: 1px solid $border-secondary;
  border-radius: $border-radius-md;
  padding: $spacing-lg;

  .card-header {
    margin-bottom: $spacing-2xl;
  }

  .card-title {
    font-family: $font-family-primary;
    font-weight: $font-weight-semibold;
    font-size: 20px;
    line-height: 1.4;
    color: $text-primary;
    margin: 0;
  }

  .exchange-rate-content {
    .rate-item {
      background: $background-card;
      border-radius: $border-radius-md;
      padding: 10px 14px;
      box-shadow: $shadow-button;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 4px;
      margin-bottom: 8px;

      &:last-child {
        margin-bottom: 0;
      }

      .rate-info {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 1;
        height: 28px;

        .currency-icon {
          width: 32px;
          height: 32px;
          background: #333741;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;

          img {
            width: 16px;
            height: 16px;
          }
        }

        .rate-details {
          display: flex;
          flex-direction: column;

          .currency-pair {
            font-family: $font-family-primary;
            font-weight: $font-weight-medium;
            font-size: 12px;
            color: $text-secondary;
            line-height: 1;
          }

          .rate-value {
            font-family: $font-family-primary;
            font-weight: $font-weight-semibold;
            font-size: 20px;
            line-height: 1;
            color: $text-primary;
          }
        }
      }

    }

    .error-message {
      font-family: $font-family-primary;
      font-weight: $font-weight-medium;
      font-size: 12px;
      color: #f04438;
      text-align: center;
      padding: $spacing-md;
    }

    .last-updated {
      font-family: $font-family-primary;
      font-weight: $font-weight-medium;
      font-size: 12px;
      color: $text-muted;
      text-align: center;
      margin-top: 4px;
    }
  }
}
</style>
