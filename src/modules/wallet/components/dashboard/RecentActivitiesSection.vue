<template>
  <v-card class="activities-card" outlined>
    <div class="card-header">
      <h3 class="card-title">Recent Activities</h3>
    </div>

    <div class="activities-list" :key="activities.length">
      <div class="activity-item" v-for="activity in activities" :key="`activity-${activity.id}-${activity.date}`">
        <div class="activity-content">
          <div class="activity-main">
            <div class="activity-type">{{ activity.type }}</div>
            <div class="activity-amounts">
              <span class="crypto-amount">{{ activity.cryptoAmount }}</span>
              <span class="fiat-amount" :class="{ positive: activity.fiatAmount.startsWith('+') }">
                {{ activity.fiatAmount }}
              </span>
            </div>
            <div class="activity-details">
              <span class="activity-date">{{ activity.date }}</span>
              <span class="activity-status">{{ activity.status }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="see-all-section">
      <span class="see-all-text">see all</span>
    </div>
  </v-card>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import cardStore from '@/stores/modules/card';
import type { Activity } from '@/models/types';

const activities = computed(() => {
  // Force reactivity by accessing the store directly
  const storeActivities = [...(cardStore.state.activities || [])];
  console.log('🎯 RecentActivitiesSection computed triggered!');
  console.log('🎯 cardStore.state:', cardStore.state);
  console.log('🎯 cardStore.state.activities:', cardStore.state.activities);
  console.log('🎯 activities length:', storeActivities.length);
  
  // Only show the last 3 activities
  const recentActivities = storeActivities.slice(0, 3);
  
  recentActivities.forEach((activity, index) => {
    console.log(`🎯 Activity ${index}:`, activity);
  });
  
  return recentActivities;
});
</script>

<style lang="scss" scoped>
@import '../../styles/variables';
@import '../../styles/mixins';

.activities-card {
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
    font-size: $font-size-xl;
    line-height: 1.4;
    color: $text-primary;
    margin: 0;
  }

  .activities-list {
    display: flex;
    flex-direction: column;
    gap: $spacing-sm;

    .activity-item {
      background: $background-card;
      border-radius: $border-radius-md;
      padding: 10px 16px;
      box-shadow: $shadow-button;

      .activity-content {
        .activity-main {
          display: flex;
          flex-direction: column;
          gap: 4px;

          .activity-type {
            font-family: $font-family-primary;
            font-weight: $font-weight-medium;
            font-size: $font-size-xs;
            line-height: 1.33;
            color: $text-secondary;
          }

          .activity-amounts {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 4px;

            .crypto-amount {
              font-family: $font-family-primary;
              font-weight: $font-weight-semibold;
              font-size: 20px;
              line-height: 1.2;
              color: $text-primary;
            }

            .fiat-amount {
              font-family: $font-family-primary;
              font-weight: $font-weight-medium;
              font-size: 20px;
              line-height: 1.2;
              color: $text-primary;
              text-align: right;

              &.positive {
                color: $text-primary;
              }
            }
          }

          .activity-details {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 4px;

            .activity-date {
              font-family: $font-family-primary;
              font-weight: $font-weight-medium;
              font-size: $font-size-xs;
              line-height: 1.33;
              color: $text-muted;
            }

            .activity-status {
              font-family: $font-family-primary;
              font-weight: $font-weight-medium;
              font-size: $font-size-xs;
              line-height: 1.33;
              color: #4ca30d;
              text-align: right;
            }
          }
        }
      }
    }
  }

  .see-all-section {
    margin-top: $spacing-lg;
    display: flex;
    justify-content: center;

    .see-all-text {
      font-family: $font-family-primary;
      font-weight: $font-weight-medium;
      font-size: $font-size-sm;
      line-height: 1.43;
      color: $text-muted;
      cursor: pointer;
      text-decoration: none;

      &:hover {
        color: $text-secondary;
      }
    }
  }
}
</style>
