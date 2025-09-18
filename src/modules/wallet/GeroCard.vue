<template>
  <div class="gero-wallet">
    <!-- Status Dropdown (Development Only) -->
    <div class="status-controls">
      <div class="dropdown-container">
        <select v-model="currentStatus" @change="setStatus(currentStatus)" class="status-dropdown">
          <option value="new">New User</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
        </select>
      </div>
    </div>

    <component :is="section" />
  </div>
</template>

<script setup lang="ts">
import { ref, onBeforeMount, computed } from 'vue';
import cardStore from '@/stores/modules/card';
import { useMockCardData } from '@/models/card-example';
import OrderCardSection from '@/modules/wallet/pages/OrderCardSection.vue';
import PendingSection from '@/modules/wallet/pages/PendingSection.vue';
import HomeSection from '@/modules/wallet/pages/HomeSection.vue';
import geroStore from '@/stores/geroStore';

const store = geroStore;
const { initializeMockData } = useMockCardData();

const section = ref(OrderCardSection);
const currentStatus = ref('new' as 'new' | 'pending' | 'approved');

// Determine status based on user data and card data
const determineStatus = computed(() => {
  // If no user info, show order card section
  if (!cardStore.state.userInfo) {
    return 'new';
  }

  // If user exists but no card data, show pending section
  if ((cardStore.state.userInfo && !cardStore.state.cardData) || localStorage.getItem('kycStatus') === 'pending') {
    return 'pending';
  }

  // If user and card data exist, show home section
  if (cardStore.state.userInfo && cardStore.state.cardData) {
    localStorage.removeItem('kycStatus');
    return 'approved';
  }

  return 'new';
});

const setStatus = (status: 'new' | 'pending' | 'approved') => {
  currentStatus.value = status;

/**
 * Handle retry action from error state
 */
async function handleRetry(): Promise<void> {
  clearError();

  try {
    await cardStore.initialize();
  } catch (error) {
    handleError('Failed to retry. Please refresh the page.');
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
    await initialize(walletStore.loggedWallet);
  } catch (error) {
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
