<template>
  <div class="card-auth-view">
    <!-- Card promo image -->
    <div class="promo-section">
      <img src="@/assets/front_card_no_mcx2.png" alt="Gero Card" class="card-promo-image" />
      <h2 class="promo-title">{{ $t('card.getYourGeroCryptoCard') }}</h2>
      <p class="promo-subtitle">{{ $t('card.chooseOptionBelow') }}</p>
    </div>

    <!-- Feature highlights -->
    <div class="features">
      <div class="feature-item">
        <v-icon small :color="primaryColor">mdi-check-circle</v-icon>
        <span>{{ $t('card.zeroMonthlyFees') }}</span>
      </div>
      <div class="feature-item">
        <v-icon small :color="primaryColor">mdi-check-circle</v-icon>
        <span>{{ $t('card.zeroAdaEurFees') }}</span>
      </div>
      <div class="feature-item">
        <v-icon small :color="primaryColor">mdi-check-circle</v-icon>
        <span>{{ $t('card.topUpCardWithAda') }}</span>
      </div>
    </div>

    <!-- Auth actions -->
    <div class="auth-actions">
      <v-btn
        block
        class="login-btn"
        :loading="loading"
        :disabled="loading"
        @click="handleLogin"
      >
        <span class="btn-text-gradient">{{ $t('card.signIn') }}</span>
      </v-btn>

      <v-btn
        block
        outlined
        class="register-btn"
        @click="handleRegister"
      >
        {{ $t('card.orderYourGeroCard') }}
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { receiveKaiserExToken } from '@/services/kaiserEx.service';
import cardHelpers from '@/stores/modules/card';
import { useChainContext } from '../../composables/useChainContext';

const { themeColors } = useChainContext();
const primaryColor = computed(() => themeColors.value.primary);

const emit = defineEmits<{
  (e: 'auth-complete'): void;
}>();

const loading = ref(false);

async function handleLogin() {
  try {
    loading.value = true;
    await receiveKaiserExToken(async (tokenData) => {
      try {
        await cardHelpers.setKaiserExTokens(tokenData);
        loading.value = false;
        emit('auth-complete');
      } catch (error) {
        console.error('Failed to process KaiserEx token:', error);
        loading.value = false;
      }
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage !== 'Authentication window was closed by user') {
      console.error('Failed to receive KaiserEx token:', error);
    }
    loading.value = false;
  }
}

function handleRegister() {
  window.open('https://www.kaiserex.com/gerocard', '_blank');
}
</script>

<style scoped>
.card-auth-view {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 16px;
  gap: 24px;
  height: 100%;
}

.promo-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 12px;
}

.card-promo-image {
  width: 160px;
  height: auto;
  margin-bottom: 4px;
}

.promo-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--g-text-1);
  margin: 0;
  line-height: 1.2;
}

.promo-subtitle {
  font-size: 13px;
  color: var(--g-text-3);
  margin: 0;
}

.features {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  padding: 16px;
  background: var(--g-raised);
  border-radius: var(--g-r-card);
  border: 1px solid var(--g-hairline-3);
}

.feature-item {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--g-text-2);
}

.auth-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  margin-top: auto;
  padding-bottom: 8px;
}

.login-btn {
  height: 44px !important;
  border-radius: var(--g-r-control) !important;
  background: linear-gradient(135deg, var(--g-grad-1) 0%, var(--g-grad-2) 100%) !important;
  text-transform: none !important;
  font-weight: 600 !important;
  font-size: 14px !important;
  letter-spacing: 0 !important;
  color: var(--g-on-grad) !important;
}

.btn-text-gradient {
  color: var(--g-on-grad);
  font-weight: 600;
}

.register-btn {
  height: 44px !important;
  border-radius: var(--g-r-control) !important;
  border-color: var(--g-hairline-3) !important;
  text-transform: none !important;
  font-weight: 600 !important;
  font-size: 14px !important;
  letter-spacing: 0 !important;
  color: var(--g-accent) !important;
}

.register-btn:hover {
  border-color: var(--g-accent) !important;
  background: color-mix(in srgb, var(--g-accent) 8%, transparent) !important;
}
</style>
