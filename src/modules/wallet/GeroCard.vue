<template>
  <div class="gero-wallet">
    <!-- Status Dropdown (Development Only) -->
    <div class="status-controls" v-if="isDev">
      <div class="dropdown-container">
        <select v-model="currentStatus" @change="setStatus(currentStatus)" class="status-dropdown">
          <option value="auth">Unauthenticated</option>
          <option value="new">New User</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
        </select>
        <div class="debug-info" style="margin-top: 10px; font-size: 12px; color: #666;">
          <div>Current State: <strong>{{ currentState }}</strong></div>
          <div>KYC Status: <strong>{{ kycStatus }}</strong></div>
          <div>Kaiserex Auth: <strong>{{ isKaiserexAuthenticated }}</strong></div>
          <div>Has User Info: <strong>{{ hasUserInfo }}</strong></div>
          <div>Has Card Data: <strong>{{ hasCardData }}</strong></div>
        </div>
        <div style="margin-top: 10px; display: flex; gap: 5px; flex-wrap: wrap;">
          <button @click="testAuthState" style="padding: 5px 8px; font-size: 11px;">
            🔐 Auth
          </button>
          <button @click="testNewState" style="padding: 5px 8px; font-size: 11px;">
            🆕 New
          </button>
          <button @click="testPendingState" style="padding: 5px 8px; font-size: 11px;">
            ⏳ Pending
          </button>
          <button @click="testApprovedState" style="padding: 5px 8px; font-size: 11px;">
            ✅ Approved
          </button>
        </div>
      </div>
    </div>

    <component :is="section" @auth-complete="handleAuthComplete" />
  </div>
</template>

<script setup lang="ts">
import { ref, onBeforeMount, computed, watch } from 'vue';
import cardStore from '@/stores/modules/card';
import { useMockCardData } from '@/models/card-example';
import { useWalletStatus } from '@/composables/useWalletStatus';
import KaiserexAuthPage from '@/modules/wallet/components/KaiserexAuthPage.vue';
import OrderCardSection from '@/modules/wallet/pages/OrderCardSection.vue';
import PendingSection from '@/modules/wallet/pages/PendingSection.vue';
import HomeSection from '@/modules/wallet/pages/HomeSection.vue';
import geroStore from '@/stores/geroStore';

const store = geroStore;
const { initializeMockData } = useMockCardData();

// Use the new wallet status composable
const {
  currentState,
  kycStatus,
  isKaiserexAuthenticated,
  hasUserInfo,
  hasCardData,
  showAuthPage,
  showNewUserFlow, 
  showPendingKYC,
  showApprovedHome,
  showLoading,
  handleAuthComplete,
  setKaiserexAuthentication,
  setKYCStatus,
  clearAll,
  // Development helpers (only available in dev mode)
  setDevState,
  simulateKYCApproval,
  simulateKYCRejection,
  clearDevData
} = useWalletStatus();

const section = ref(KaiserexAuthPage);
const currentStatus = ref('auth' as 'auth' | 'new' | 'pending' | 'approved');
const isDev = import.meta.env.DEV;

// Determine status based on user data and card data
const determineStatus = computed(() => {
  // First check if user has authenticated with Kaiserex
  const isKaiserexAuthenticated = localStorage.getItem('kaiserexRegistered') === 'true';
  
  if (!isKaiserexAuthenticated) {
    return 'auth'; // Show auth page first
  }

  // If no user info but authenticated with Kaiserex, show order card section
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

const setStatus = (status: 'auth' | 'new' | 'pending' | 'approved') => {
  currentStatus.value = status;

  if (import.meta.env.DEV) {
    // In development, use the new wallet status store
    switch (status) {
      case 'auth':
        clearDevData?.();
        setDevState?.('auth');
        break;
      case 'new':
        clearDevData?.();
        setKaiserexAuthentication(true);
        setDevState?.('new');
        break;
      case 'pending':
        clearDevData?.();
        setKaiserexAuthentication(true);
        cardStore.state.userInfo = { email: 'test@example.com' };
        setKYCStatus('pending');
        setDevState?.('pending');
        break;
      case 'approved':
        clearDevData?.();
        setKaiserexAuthentication(true);
        cardStore.state.userInfo = { email: 'test@example.com' };
        cardStore.state.cardData = {
          pan: '**** **** **** 1234',
          currentBalance: '1000.00',
          currency: 'EUR',
        };
        simulateKYCApproval?.();
        setDevState?.('approved');
        break;
    }
  }

  setActiveStatus();
};

/**
 * Development testing utilities for wallet states
 * Each function simulates a specific user scenario
 */
const WalletStateTester = {
  /**
   * Test Rule 1: No authentication token
   * Expected: KaiserexAuthPage
   */
  testAuthState: () => {
    setKaiserexAuthentication(false);
  },

  /**
   * Test Rule 2: Has token but KYC not started
   * Expected: OrderCardSection
   */
  testNewState: () => {
    setKaiserexAuthentication(true);
    setKYCStatus('not_started');
  },

  /**
   * Test Rule 3: Has token and KYC pending
   * Expected: PendingSection
   */
  testPendingState: () => {
    setKaiserexAuthentication(true);
    setKYCStatus('pending');
  },

  /**
   * Test Rule 4: Has token and KYC approved
   * Expected: HomeSection
   */
  testApprovedState: () => {
    setKaiserexAuthentication(true);
    
    // Ensure required data exists for approved state
    if (!cardStore.state.userInfo) {
      cardStore.state.userInfo = { email: 'test@example.com' };
    }
    if (!cardStore.state.cardData) {
      cardStore.state.cardData = { cardNumber: '****1234' };
    }
    
    setKYCStatus('approved');
  }
};

// Expose test functions
const { testAuthState, testNewState, testPendingState, testApprovedState } = WalletStateTester;

/**
 * Component mapping for wallet states
 * Each state corresponds to a specific user flow
 */
const WALLET_COMPONENTS = {
  auth: KaiserexAuthPage,     // Authentication required
  new: OrderCardSection,      // Order Gero Card
  pending: PendingSection,    // KYC under review
  approved: HomeSection,      // Full wallet access
  loading: null,             // Keep current component
} as const;

/**
 * Updates the active component based on current wallet state
 * Uses centralized state from walletStatusStore
 */
const setActiveStatus = () => {
  const walletState = currentState.value;
  
  // Map state to component
  const targetComponent = WALLET_COMPONENTS[walletState];
  
  if (targetComponent) {
    section.value = targetComponent;
  } else if (walletState === 'loading') {
    // Keep current component during loading
  } else {
    // Fallback to auth for unknown states
    section.value = KaiserexAuthPage;
  }
};

onBeforeMount(async () => {
  // Initialize mock data in development
  if (import.meta.env.DEV) {
    console.log('Initializing mock data in GeroWallet...');
    await initializeMockData();
  } else {
    // Use real API in production
    console.log('Initializing real API in GeroWallet...');
    // Get the first available wallet or pass null if no wallets
    const wallets = Object.values(store.state.wallets);
    const wallet = wallets.length > 0 ? wallets[0] : null;
    await cardStore.initialize(wallet);
  }

  // Set active status after data is loaded
  setActiveStatus();
  
  // Force initialize wallet status store
  setTimeout(() => {
    setActiveStatus();
  }, 100);
});

// Handle auth completion is now handled by the composable
// const handleAuthComplete is imported from useWalletStatus

// Watch for changes in user data and update status

// Watch for changes in wallet status and update component
watch(
  () => currentState.value,
  (newState, oldState) => {
    setActiveStatus();
  }
);

// Watch for changes in card store data and update status
watch(
  [() => cardStore.state.userInfo, () => cardStore.state.cardData, () => localStorage.getItem('kaiserexRegistered')],
  () => {
    setActiveStatus();
  },
  { deep: true }
);
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

.status-controls {
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 1000;
  background: rgba(12, 17, 29, 0.8);
  border: 1px solid #1f242f;
  border-radius: 4px;
  padding: 4px 8px;
  backdrop-filter: blur(8px);
  opacity: 0.6;
  transition: opacity 0.2s ease;
  font-size: 10px;

  &:hover {
    opacity: 1;
  }

  .dropdown-container {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .dropdown-label {
    color: #cecfd2;
    font-size: 10px;
    font-weight: 500;
    white-space: nowrap;
  }

  .status-dropdown {
    background: #1f242f;
    border: 1px solid #2a3038;
    border-radius: 3px;
    color: #fff;
    font-size: 10px;
    padding: 2px 6px;
    outline: none;
    cursor: pointer;
    min-width: 80px;

    &:focus {
      border-color: #00c7f3;
    }

    option {
      background: #1f242f;
      color: #fff;
      font-size: 10px;
    }
  }
}
</style>
