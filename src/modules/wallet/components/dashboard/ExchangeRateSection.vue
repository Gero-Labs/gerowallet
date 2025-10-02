<template>
  <v-card class="exchange-rate-card" outlined>
    <div class="card-header">
      <h3 class="card-title">Exchange Rate</h3>
    </div>

    <div class="exchange-rate-content">
      <div class="rate-item" v-for="rate in exchangeRates" :key="rate.id">
        <div class="d-flex flex-column">
          <div class="rate-info">
            <div class="currency-icon">
              <img :src="rate.icon" :alt="rate.currency" />
            </div>
            <div class="rate-details">
              <div class="currency-pair">{{ rate.pair }}</div>
              <div class="rate-value" v-if="rate.value">{{ Number(rate.value).toFixed(2) }}</div>
            </div>
          </div>
          <!-- <div class="last-updated">Last updated: {{ lastUpdated }}</div> -->
        </div>

        <!-- <div class="rate-change">
          <div class="change-indicator" :class="rate.trend">
            <img :src="rate.trendIcon" :alt="rate.trend" class="trend-icon" />
            <span class="change-percentage">{{ rate.change }}</span>
          </div>
        </div> -->
      </div>
    </div>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import trendUpSvg from '@/assets/svg/trend-up-01.svg';
import currencyEuro from '@/modules/wallet/icons/currency-euro.svg?url';
import cardStore from '@/stores/modules/card';

const exchangeRates = computed(() => {
  return [
    {
      id: 1,
      pair: 'ADA/EUR',
      value: cardStore.state.exchangeRate?.buy,
      currency: 'EUR',
      icon: currencyEuro,
      change: '0%',
      trend: 'positive',
      trendIcon: trendUpSvg,
    },
  ];
});

const lastUpdated = ref('Today, 15:42');

const updateLastUpdated = () => {
  const now = new Date();
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  lastUpdated.value = `Today, ${hours}:${minutes}`;
};

updateLastUpdated();
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

      .rate-change {
        display: flex;
        justify-content: center;
        align-items: center;

        .change-indicator {
          display: flex;
          align-items: center;
          gap: 4px;

          &.positive {
            .change-percentage {
              color: #079455;
            }
          }

          &.negative {
            .change-percentage {
              color: #f04438;
            }
          }

          .trend-icon {
            width: 20px;
            height: 20px;
          }

          .change-percentage {
            font-family: $font-family-primary;
            font-weight: $font-weight-medium;
            font-size: $font-size-sm;
          }
        }
      }
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
