<template>
  <div class="gero-wallet">
    <!-- Logout Button (shown for all states except auth and loading) -->
    <v-btn
      v-if="!showAuthPage && !showLoadingState && !showErrorState"
      icon
      class="logout-btn ma-3"
      @click="handleLogout"
      :title="$t('wallet.logout')"
    >
      <v-icon>mdi-logout</v-icon>
    </v-btn>

    <!-- Loading State -->
    <div v-if="showLoadingState" class="loading-container">
      <div class="loading-spinner"></div>
      <p class="loading-message">{{ loadingMessage || $t('wallet.loadingYourWallet') }}</p>
    </div>

    <!-- Error State -->
    <div v-else-if="showErrorState" class="error-container">
      <div class="error-icon">⚠️</div>
      <h3 class="error-title">{{ $t('wallet.somethingWentWrong') }}</h3>
      <p class="error-message">{{ error || $t('wallet.unexpectedError') }}</p>
      <button @click="handleRetry" class="retry-button">{{ $t('wallet.tryAgain') }}</button>
    </div>
    <!-- Main Content -->
    <component
      v-else
      :is="currentComponent"
      @auth-complete="handleAuthComplete"
      @kyc-complete="handleKYCComplete"
      @error="setError"
    />
  </div>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { computed, onMounted } from 'vue';
import { useWalletStatus } from '@/composables/useWalletStatus';
import cardStore from '@/stores/modules/card';

// Import components
import KaiserexAuthPage from '@/modules/wallet/components/KaiserexAuthPage.vue';
import OrderCardSection from '@/modules/wallet/pages/OrderCardSection.vue';
import PendingSection from '@/modules/wallet/pages/PendingSection.vue';
import HomeSection from '@/modules/wallet/pages/HomeSection.vue';

// ============================================================================
// COMPOSABLES AND STORES
// ============================================================================

const {
  currentState,
  error,
  loadingMessage,
  showLoadingState,
  showErrorState,
  showAuthPage,
  initialize,
  handleAuthComplete: onAuthComplete,
  handleKYCComplete: onKYCComplete,
  setError,
  clearError,
} = useWalletStatus();

const WALLET_COMPONENTS = {
  auth: KaiserexAuthPage, // Authentication required
  new: OrderCardSection, // Order Gero Card
  pending: PendingSection, // KYC under review
  approved: HomeSection, // Full wallet access
  loading: null, // Keep current component
  error: null, // Error handled in template
} as const;

const currentComponent = computed(() => {
  const state = currentState.value;
  return WALLET_COMPONENTS[state] || KaiserexAuthPage;
});

async function handleAuthComplete(): Promise<void> {
  try {
    await onAuthComplete();
    clearError();
  } catch (error) {
    console.error('Authentication completion failed:', error);
    setError('Authentication failed. Please try again.');
  }
}

/**
 * Handle KYC completion
 */
async function handleKYCComplete(status: string = 'pending', data?: any): Promise<void> {
  try {
    await onKYCComplete(status as any, data);
    clearError();
  } catch (error) {
    console.error('KYC completion failed:', error);
    setError('KYC submission failed. Please try again.');
  }
}

/**
 * Handle retry action from error state
 */
async function handleRetry(): Promise<void> {
  clearError();

  try {
    await cardStore.initialize();
  } catch (error) {
    setError('Failed to retry. Please refresh the page.');
  }
}

/**
 * Handle logout action
 */
async function handleLogout(): Promise<void> {
  try {
    await cardStore.logout();
  } catch (error) {
    console.error('Logout failed:', error);
    setError('Logout failed. Please try again.');
  }
}

// ============================================================================
// DEVELOPMENT HELPERS
// ============================================================================

/**
 * Set development status for testing different states
 */

// ============================================================================
// WATCHERS
// ============================================================================

/**
 * Watch for changes in wallet status and update dropdown
 */

// ============================================================================
// LIFECYCLE
// ============================================================================

onMounted(async () => {
  try {
    await initialize();
  } catch (error) {
    setError('Failed to initialize wallet. Please refresh the page.');
  }
});
</script>

<style lang="scss" scoped>
@import './styles/index.scss';

.gero-wallet {
  display: flex;
  flex-direction: column;
  gap: 32px;
  width: 100%;
  height: 100%;
  position: relative;

  // Only add padding for non-auth pages (auth page handles its own layout)
  &:not(:has(.kaiserex-auth-page)) {
    padding: 32px 0 0;
  }
}

// ============================================================================
// LOGOUT BUTTON
// ============================================================================

.logout-btn {
  position: absolute;
  top: 32px;
  right: 32px;
  background: rgba(255, 255, 255, 0.05) !important;
  border: 1px solid rgba(255, 255, 255, 0.1);
  transition: all 0.2s ease;
  z-index: 1000;

  &:hover {
    background: rgba(255, 77, 77, 0.15) !important;
    border-color: rgba(255, 77, 77, 0.3);
  }

  :deep(.v-icon) {
    color: #cecfd2;
  }

  &:hover :deep(.v-icon) {
    color: #ff4d4d;
  }
}

// ============================================================================
// LOADING STATE
// ============================================================================

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 400px;
  text-align: center;
  padding: 40px;
}

.loading-spinner {
  width: 48px;
  height: 48px;
  border: 4px solid rgba(255, 255, 255, 0.1);
  border-left: 4px solid #00c7f3;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 24px;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

.loading-message {
  color: #cecfd2;
  font-size: 16px;
  margin: 0;
}

// ============================================================================
// ERROR STATE
// ============================================================================

.error-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 400px;
  text-align: center;
  padding: 40px;
}

.error-icon {
  font-size: 64px;
  margin-bottom: 24px;
}

.error-title {
  color: #fff;
  font-size: 24px;
  font-weight: 600;
  margin: 0 0 16px 0;
}

.error-message {
  color: #cecfd2;
  font-size: 16px;
  margin: 0 0 32px 0;
  max-width: 400px;
  line-height: 1.5;
}

.retry-button {
  background: linear-gradient(135deg, #00c7f3 0%, #00ffd1 100%);
  border: none;
  border-radius: 8px;
  color: #0c0e12;
  font-size: 16px;
  font-weight: 600;
  padding: 12px 24px;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 25px rgba(0, 199, 243, 0.3);
  }

  &:active {
    transform: translateY(0);
  }
}

// ============================================================================
// RESPONSIVE DESIGN
// ============================================================================

@media (max-width: 768px) {
  .gero-wallet {
    padding: 16px;
    gap: 24px;
  }

  .loading-container,
  .error-container {
    min-height: 300px;
    padding: 24px;
  }

  .error-title {
    font-size: 20px;
  }

  .error-message {
    font-size: 14px;
  }
}
</style>
