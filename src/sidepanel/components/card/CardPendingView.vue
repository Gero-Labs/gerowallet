<template>
  <div class="card-pending-view">
    <!-- Progress indicator -->
    <div class="pending-visual">
      <div class="progress-ring">
        <v-progress-circular
          :size="80"
          :width="4"
          indeterminate
          color="#00c7f3"
        />
        <v-icon class="ring-icon" color="#00c7f3" size="28">mdi-file-document-check-outline</v-icon>
      </div>
    </div>

    <!-- Status info -->
    <div class="status-section">
      <h2 class="status-title">{{ $t('card.kycUnderReview') }}</h2>
      <p class="status-message">
        {{ $t('card.kycReviewMessage') }}
      </p>
    </div>

    <!-- Status steps -->
    <div class="status-steps">
      <div class="status-step completed">
        <v-icon small color="#4caf50">mdi-check-circle</v-icon>
        <span>{{ $t('card.accountCreated') }}</span>
      </div>
      <div class="status-step completed">
        <v-icon small color="#4caf50">mdi-check-circle</v-icon>
        <span>{{ $t('card.kycDocumentsSubmitted') }}</span>
      </div>
      <div class="status-step active">
        <v-icon small color="#00c7f3">mdi-clock-outline</v-icon>
        <span>{{ $t('card.verificationInProgress') }}</span>
      </div>
      <div class="status-step pending">
        <v-icon small color="#555">mdi-circle-outline</v-icon>
        <span>{{ $t('card.orderYourCard') }}</span>
      </div>
    </div>

    <!-- Actions -->
    <div class="pending-actions">
      <v-btn
        block
        outlined
        class="refresh-btn"
        :loading="refreshing"
        @click="handleRefresh"
      >
        <v-icon small class="mr-1">mdi-refresh</v-icon>
        {{ $t('card.checkStatus') }}
      </v-btn>

      <v-btn
        block
        text
        class="logout-btn"
        @click="handleLogout"
      >
        <v-icon small class="mr-1">mdi-logout</v-icon>
        {{ $t('wallet.logout') }}
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import cardHelpers from '@/stores/modules/card';

const refreshing = ref(false);

async function handleRefresh() {
  try {
    refreshing.value = true;
    await cardHelpers.fetchUserKYCStatus();
  } catch (error) {
    console.error('Failed to refresh KYC status:', error);
  } finally {
    refreshing.value = false;
  }
}

async function handleLogout() {
  try {
    await cardHelpers.logout();
  } catch (error) {
    console.error('Logout failed:', error);
  }
}
</script>

<style scoped>
.card-pending-view {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 16px;
  gap: 20px;
  height: 100%;
}

.pending-visual {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px 0;
}

.progress-ring {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.ring-icon {
  position: absolute;
}

.status-section {
  text-align: center;
}

.status-title {
  font-size: 18px;
  font-weight: 700;
  color: #fff;
  margin: 0 0 8px;
}

.status-message {
  font-size: 13px;
  color: #888;
  margin: 0;
  line-height: 1.5;
}

.status-steps {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  padding: 16px;
  background: #1a1a1a;
  border-radius: 12px;
  border: 1px solid #2a2a2a;
}

.status-step {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}

.status-step.completed span {
  color: #aaa;
}

.status-step.active span {
  color: #00c7f3;
  font-weight: 600;
}

.status-step.pending span {
  color: #555;
}

.pending-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  margin-top: auto;
  padding-bottom: 8px;
}

.refresh-btn {
  height: 44px !important;
  border-radius: 10px !important;
  border-color: #333 !important;
  text-transform: none !important;
  font-weight: 600 !important;
  font-size: 14px !important;
  letter-spacing: 0 !important;
  color: #00c7f3 !important;
}

.refresh-btn:hover {
  border-color: #00c7f3 !important;
  background: rgba(0, 199, 243, 0.08) !important;
}

.logout-btn {
  height: 36px !important;
  text-transform: none !important;
  font-size: 13px !important;
  letter-spacing: 0 !important;
  color: #888 !important;
}

.logout-btn:hover {
  color: #ff4d4d !important;
}
</style>
