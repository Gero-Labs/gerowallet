<template>
  <div class="card-page">
    <!-- Loading State -->
    <div v-if="showLoadingState" class="card-loading">
      <v-progress-circular
        indeterminate
        :size="40"
        :width="3"
        :color="primaryColor"
      />
      <span class="loading-text">{{ loadingMessage || $t('wallet.loadingYourWallet') }}</span>
    </div>

    <!-- Error State -->
    <div v-else-if="showErrorState" class="card-error">
      <v-icon large color="error">mdi-alert-circle-outline</v-icon>
      <h3 class="error-title">{{ $t('wallet.somethingWentWrong') }}</h3>
      <p class="error-message">{{ error || $t('wallet.unexpectedError') }}</p>
      <v-btn
        outlined
        class="retry-btn"
        @click="handleRetry"
      >
        <v-icon small class="mr-1">mdi-refresh</v-icon>
        {{ $t('wallet.tryAgain') }}
      </v-btn>
    </div>

    <!-- State machine views -->
    <CardAuthView
      v-else-if="currentState === 'auth'"
      @auth-complete="handleAuthComplete"
    />

    <CardNewView
      v-else-if="currentState === 'new'"
    />

    <CardPendingView
      v-else-if="currentState === 'pending'"
    />

    <CardApprovedView
      v-else-if="currentState === 'approved'"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, computed } from 'vue';
import { useWalletStatus } from '@/composables/useWalletStatus';
import cardHelpers from '@/stores/modules/card';
import CardAuthView from '@/sidepanel/components/card/CardAuthView.vue';
import CardNewView from '@/sidepanel/components/card/CardNewView.vue';
import CardPendingView from '@/sidepanel/components/card/CardPendingView.vue';
import CardApprovedView from '@/sidepanel/components/card/CardApprovedView.vue';
import { useChainContext } from '../composables/useChainContext';

const { themeColors } = useChainContext();
const primaryColor = computed(() => themeColors.value.primary);

const {
  currentState,
  error,
  loadingMessage,
  showLoadingState,
  showErrorState,
  initialize,
  handleAuthComplete: onAuthComplete,
  setError,
  clearError,
} = useWalletStatus();

async function handleAuthComplete() {
  try {
    await onAuthComplete();
    clearError();
  } catch (err) {
    console.error('Authentication completion failed:', err);
    setError('Authentication failed. Please try again.');
  }
}

async function handleRetry() {
  clearError();
  try {
    await cardHelpers.initialize();
  } catch (err) {
    setError('Failed to retry. Please try again.');
  }
}

onMounted(async () => {
  try {
    await initialize();
  } catch (err) {
    setError('Failed to initialize. Please try again.');
  }
});
</script>

<style scoped>
.card-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
}

.card-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  height: 100%;
  min-height: 300px;
  padding: 24px;
}

.loading-text {
  font-size: 14px;
  color: var(--g-text-3);
}

.card-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  height: 100%;
  min-height: 300px;
  padding: 24px;
  text-align: center;
}

.error-title {
  font-size: 20px;
  font-weight: 700;
  color: var(--g-text-1);
  margin: 0;
}

.error-message {
  font-size: 13px;
  color: var(--g-text-3);
  margin: 0;
  max-width: 280px;
  line-height: 1.5;
}

.retry-btn {
  height: 40px !important;
  border-radius: var(--g-r-control) !important;
  border-color: var(--g-hairline-2) !important;
  text-transform: none !important;
  font-weight: 600 !important;
  font-size: 13px !important;
  letter-spacing: 0 !important;
  color: var(--g-accent) !important;
  margin-top: 8px;
}

.retry-btn:hover {
  border-color: var(--g-accent) !important;
  background: color-mix(in srgb, var(--g-accent) 8%, transparent) !important;
}
</style>
