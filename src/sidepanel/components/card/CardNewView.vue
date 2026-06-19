<template>
  <div class="card-new-view">
    <!-- Header -->
    <div class="new-header">
      <v-icon large color="#00c7f3">mdi-card-plus-outline</v-icon>
      <h2 class="new-title">{{ $t('card.getYourGeroCryptoCard') }}</h2>
      <p class="new-subtitle">{{ $t('card.chooseOptionBelow') }}</p>
    </div>

    <!-- Steps -->
    <div class="steps-section">
      <div class="step" v-for="(step, i) in steps" :key="i">
        <div class="step-number">{{ i + 1 }}</div>
        <div class="step-content">
          <span class="step-text">{{ step }}</span>
        </div>
      </div>
    </div>

    <!-- Feature cards -->
    <div class="feature-cards">
      <div class="feature-card">
        <v-icon small color="#00c7f3">mdi-credit-card-outline</v-icon>
        <span>{{ $t('card.zeroMonthlyFees') }}</span>
      </div>
      <div class="feature-card">
        <v-icon small color="#00c7f3">mdi-swap-horizontal</v-icon>
        <span>{{ $t('card.zeroAdaEurFees') }}</span>
      </div>
    </div>

    <!-- CTA -->
    <div class="cta-section">
      <v-btn
        block
        class="order-btn"
        :loading="ordering"
        @click="handleStartKYC"
      >
        {{ $t('card.startKYCVerification') }}
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
import { useTranslation } from '@/shared/composables/useTranslation';
import cardHelpers from '@/stores/modules/card';

const { t } = useTranslation();

const ordering = ref(false);

const steps = [
  t('card.registerOnKaiserex'),
  t('card.activateViaEmail'),
  t('card.signInCompleteKYC'),
  t('card.onceApprovedOrder'),
];

async function handleStartKYC() {
  try {
    ordering.value = true;
    await cardHelpers.fetchKYCLink();
  } catch (error) {
    console.error('Failed to start KYC:', error);
  } finally {
    ordering.value = false;
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
.card-new-view {
  display: flex;
  flex-direction: column;
  padding: 24px 16px;
  gap: 20px;
  height: 100%;
}

.new-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 8px;
}

.new-title {
  font-size: 18px;
  font-weight: 700;
  color: #fff;
  margin: 0;
}

.new-subtitle {
  font-size: 13px;
  color: #888;
  margin: 0;
}

.steps-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: #1a1a1a;
  border-radius: 12px;
  border: 1px solid #2a2a2a;
}

.step {
  display: flex;
  align-items: center;
  gap: 12px;
}

.step-number {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: rgba(0, 199, 243, 0.15);
  color: #00c7f3;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}

.step-text {
  font-size: 13px;
  color: #ccc;
  line-height: 1.3;
}

.feature-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.feature-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 14px 10px;
  background: #1a1a1a;
  border-radius: 10px;
  border: 1px solid #2a2a2a;
  text-align: center;
  font-size: 12px;
  color: #ccc;
}

.cta-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: auto;
  padding-bottom: 8px;
}

.order-btn {
  height: 44px !important;
  border-radius: 10px !important;
  background: linear-gradient(135deg, #00c7f3 0%, #00ffd1 100%) !important;
  text-transform: none !important;
  font-weight: 600 !important;
  font-size: 14px !important;
  letter-spacing: 0 !important;
  color: #0a0a0a !important;
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
