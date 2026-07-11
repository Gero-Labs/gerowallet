<template>
  <div class="gero-wallet">
    <!-- Logout Button (shown for all states except auth, loading, and pending) -->
    <v-btn
      v-if="!showAuthPage && !showLoadingState && !showErrorState && currentState !== 'pending'"
      icon
      class="logout-btn my-3"
      @click="handleLogout"
      :title="$t('wallet.logout')"
    >
      <v-icon>mdi-logout</v-icon>
    </v-btn>

    <!-- Loading State -->
    <div v-if="devState === 'loading' || showLoadingState" class="loading-container">
      <div class="loading-spinner"></div>
      <p class="loading-message">{{ loadingMessage || $t('wallet.loadingYourWallet') }}</p>
    </div>

    <!-- Error State -->
    <div v-else-if="devState === 'error' || showErrorState" class="error-container">
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

    <!-- Dev State Toggler (Bottom Right) -->
    <div class="dev-state-toggler" v-if="false">
      <v-select
        v-model="devState"
        :items="devStateOptions"
        dense
        outlined
        hide-details
        label="Dev State"
        clearable
        attach=".dev-state-toggler"
        :menu-props="{ top: true, offsetY: true }"
      >
        <template #prepend-inner>
          <v-icon small color="warning">mdi-wrench</v-icon>
        </template>
      </v-select>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
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

// ============================================================================
// DEVELOPMENT STATE TOGGLER
// ============================================================================

const devState = ref<string | null>(null);
const devStateOptions = [
  { text: 'Auth (Login/Register)', value: 'auth' },
  { text: 'New (Order Card)', value: 'new' },
  { text: 'Pending (KYC Review)', value: 'pending' },
  { text: 'Approved (Full Access)', value: 'approved' },
  { text: 'Loading', value: 'loading' },
  { text: 'Error', value: 'error' },
];

// Override currentState when devState is set
const effectiveState = computed(() => {
  return devState.value || currentState.value;
});

const currentComponent = computed(() => {
  const state = effectiveState.value;
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
  background: var(--g-hairline-1) !important;
  border: 1px solid var(--g-hairline-2);
  transition: all 0.2s ease;
  z-index: var(--g-z-sticky);

  &:hover {
    background: var(--g-error-fill) !important;
    border-color: var(--g-error-line);
  }

  :deep(.v-icon) {
    color: var(--g-text-2);
  }

  &:hover :deep(.v-icon) {
    color: var(--g-error);
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
  border: 4px solid var(--g-hairline-2);
  border-left: 4px solid var(--g-accent);
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
  color: var(--g-text-2);
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
  color: var(--g-text-1);
  font-size: 24px;
  font-weight: 600;
  margin: 0 0 16px 0;
}

.error-message {
  color: var(--g-text-2);
  font-size: 16px;
  margin: 0 0 32px 0;
  max-width: 400px;
  line-height: 1.5;
}

.retry-button {
  background: var(--g-grad);
  border: none;
  border-radius: var(--g-r-control);
  color: var(--g-on-grad);
  font-size: 16px;
  font-weight: 600;
  padding: 12px 24px;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    transform: translateY(-2px);
  }

  &:active {
    transform: translateY(0);
  }
}

// ============================================================================
// DEV STATE TOGGLER
// ============================================================================

.dev-state-toggler {
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 280px;
  z-index: var(--g-z-toast);
  background: var(--g-surface);
  border: 2px solid var(--g-warning-line);
  border-radius: var(--g-r-control);
  padding: 12px;
  box-shadow: var(--g-shadow-menu);

  :deep(.v-input__control) {
    background: var(--g-raised);
    border-radius: 4px;
  }

  :deep(.v-select__selection) {
    color: var(--g-text-1);
    font-size: 13px;
  }

  :deep(.v-input__slot) {
    min-height: 36px !important;
  }

  :deep(.v-label) {
    color: var(--g-warning);
    font-weight: 600;
    font-size: 12px;
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

  .dev-state-toggler {
    bottom: 10px;
    right: 10px;
    width: 240px;
  }
}
</style>
