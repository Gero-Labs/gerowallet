<template>
  <div class="gero-wallet">
    <!-- Development Status Controls (Development Only) -->
    <div class="status-controls" v-if="isDev">
      <div class="dropdown-container">
        <select v-model="currentStatus" @change="setStatus(currentStatus)" class="status-dropdown">
          <option value="auth">🔐 Unauthenticated</option>
          <option value="new">🆕 New User</option>
          <option value="pending">⏳ Pending KYC</option>
          <option value="approved">✅ Approved</option>
        </select>

        <!-- Debug Information Panel -->
        <div class="debug-info">
          <div><strong>Current State:</strong> {{ currentState }}</div>
          <div><strong>KYC Status:</strong> {{ kycStatus }}</div>
          <div><strong>Kaiserex Auth:</strong> {{ isKaiserexAuthenticated }}</div>
          <div><strong>Has User Info:</strong> {{ hasUserInfo }}</div>
          <div><strong>Has Card Data:</strong> {{ hasCardData }}</div>
        </div>

        <!-- Development Test Buttons -->
        <div class="dev-buttons">
          <button @click="testAuthState" :class="{ active: currentState === 'auth' }">🔐 Auth</button>
          <button @click="testNewState" :class="{ active: currentState === 'new' }">🆕 New</button>
          <button @click="testPendingState" :class="{ active: currentState === 'pending' }">⏳ Pending</button>
          <button @click="testApprovedState" :class="{ active: currentState === 'approved' }">✅ Approved</button>
        </div>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="showLoadingState" class="loading-container">
      <div class="loading-spinner"></div>
      <p class="loading-message">{{ loadingMessage || 'Loading your wallet...' }}</p>
    </div>

    <!-- Error State -->
    <div v-else-if="showErrorState" class="error-container">
      <div class="error-icon">⚠️</div>
      <h3 class="error-title">Something went wrong</h3>
      <p class="error-message">{{ error || 'An unexpected error occurred' }}</p>
      <button @click="handleRetry" class="retry-button">Try Again</button>
    </div>

    <!-- Main Content -->
    <component
      v-else
      :is="currentComponent"
      @auth-complete="handleAuthComplete"
      @kyc-complete="handleKYCComplete"
      @error="handleError"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useWalletStatus } from '@/composables/useWalletStatus';
import cardStore from '@/stores/modules/card';
import { useMockCardData } from '@/models/card-example';
import geroStore from '@/stores/geroStore';

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
  kycStatus,
  isKaiserexAuthenticated,
  hasUserInfo,
  hasCardData,
  showLoadingState,
  showErrorState,
  initialize,
  handleAuthComplete: onAuthComplete,
  handleKYCComplete: onKYCComplete,
  setError,
  clearError,
  // Development helpers
  clearDevData,
  testAuthState,
  testNewState,
  testPendingState,
  testApprovedState,
} = useWalletStatus();
const geroStoreInstance = geroStore;
const { initializeMockData } = useMockCardData();

// ============================================================================
// LOCAL STATE
// ============================================================================

const currentStatus = ref<'auth' | 'new' | 'pending' | 'approved'>('auth');
const isDev = process.env['NODE_ENV'] === 'development';

// ============================================================================
// COMPUTED PROPERTIES
// ============================================================================

/**
 * Component mapping for wallet states
 * Each state corresponds to a specific user flow as per WALLET_STATE_ARCHITECTURE.md
 */
const WALLET_COMPONENTS = {
  auth: KaiserexAuthPage, // Authentication required
  new: OrderCardSection, // Order Gero Card
  pending: PendingSection, // KYC under review
  approved: HomeSection, // Full wallet access
  loading: null, // Keep current component
  error: null, // Error handled in template
} as const;

/**
 * Determine the current component to display based on wallet state
 */
const currentComponent = computed(() => {
  const state = currentState.value;
  return WALLET_COMPONENTS[state] || KaiserexAuthPage;
});

// ============================================================================
// EVENT HANDLERS
// ============================================================================

/**
 * Handle authentication completion
 */
async function handleAuthComplete(): Promise<void> {
  try {
    await onAuthComplete();
    clearError();
  } catch (error) {
    console.error('Authentication completion failed:', error);
    handleError('Authentication failed. Please try again.');
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
    handleError('KYC submission failed. Please try again.');
  }
}

/**
 * Handle errors from child components
 */
function handleError(errorMessage: string): void {
  setError(errorMessage);
}

/**
 * Handle retry action from error state
 */
async function handleRetry(): Promise<void> {
  clearError();

  try {
    // Get the first available wallet or pass null if no wallets
    const wallets = Object.values(geroStoreInstance.state.wallets);
    const wallet = wallets.length > 0 ? wallets[0] : null;

    if (isDev) {
      await initializeMockData();
    } else {
      await cardStore.initialize(wallet);
    }
  } catch (error) {
    console.error('Retry failed:', error);
    handleError('Failed to retry. Please refresh the page.');
  }
}

// ============================================================================
// DEVELOPMENT HELPERS
// ============================================================================

/**
 * Set development status for testing different states
 */
function setStatus(status: typeof currentStatus.value): void {
  if (!isDev) return;

  currentStatus.value = status;
  clearDevData?.();

  switch (status) {
    case 'auth':
      testAuthState?.();
      break;
    case 'new':
      testNewState?.();
      break;
    case 'pending':
      testPendingState?.();
      break;
    case 'approved':
      testApprovedState?.();
      break;
  }
}



// ============================================================================
// WATCHERS
// ============================================================================

/**
 * Watch for changes in wallet status and update dropdown
 */
watch(currentState, newState => {
  if (isDev) {
    currentStatus.value = newState as any;
  }
});

// ============================================================================
// LIFECYCLE
// ============================================================================

onMounted(async () => {
  try {
    if (isDev) {
      console.log('🚀 Initializing Gero Wallet in development mode');
      await initializeMockData();
    } else {
      console.log('🚀 Initializing Gero Wallet in production mode');
      // Get the first available wallet or pass null if no wallets
      const wallets = Object.values(geroStoreInstance.state.wallets);
      const wallet = wallets.length > 0 ? wallets[0] : null;
      await initialize(wallet);
    }
  } catch (error) {
    console.error('Failed to initialize Gero Wallet:', error);
    handleError('Failed to initialize wallet. Please refresh the page.');
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

  // Only add padding for non-auth pages (auth page handles its own layout)
  &:not(:has(.kaiserex-auth-page)) {
    padding: 32px;
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
// DEVELOPMENT CONTROLS
// ============================================================================

.status-controls {
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 1000;
  background: rgba(12, 17, 29, 0.95);
  border: 1px solid #1f242f;
  border-radius: 8px;
  padding: 12px;
  backdrop-filter: blur(12px);
  opacity: 0.8;
  transition: opacity 0.2s ease;
  font-size: 11px;
  max-width: 280px;

  &:hover {
    opacity: 1;
  }

  .dropdown-container {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .status-dropdown {
    background: #1f242f;
    border: 1px solid #2a3038;
    border-radius: 4px;
    color: #fff;
    font-size: 11px;
    padding: 6px 8px;
    outline: none;
    cursor: pointer;
    width: 100%;

    &:focus {
      border-color: #00c7f3;
    }

    option {
      background: #1f242f;
      color: #fff;
    }
  }

  .debug-info {
    padding: 8px;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 4px;
    font-size: 10px;
    line-height: 1.4;

    div {
      color: #cecfd2;
      margin-bottom: 2px;

      strong {
        color: #00c7f3;
      }
    }
  }

  .dev-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;

    button {
      padding: 4px 8px;
      font-size: 10px;
      background: #2a3038;
      border: 1px solid #3a4048;
      border-radius: 3px;
      color: #cecfd2;
      cursor: pointer;
      transition: all 0.2s ease;

      &:hover {
        background: #3a4048;
        border-color: #4a5058;
      }

      &.active {
        background: #00c7f3;
        border-color: #00c7f3;
        color: #0c0e12;
        font-weight: 600;
      }

      &.error-btn {
        background: #dc3545;
        border-color: #dc3545;
        color: #fff;

        &:hover {
          background: #c82333;
          border-color: #c82333;
        }
      }
    }
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

  .status-controls {
    bottom: 8px;
    right: 8px;
    max-width: 240px;
    padding: 8px;
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
