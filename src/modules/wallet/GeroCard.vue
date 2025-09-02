<template>
  <div class="gero-wallet">
    <!-- Status Dropdown (Development Only) -->
    <div class="status-controls">
      <div class="dropdown-container">
        <select v-model="currentStatus" @change="setStatus(currentStatus)" class="status-dropdown">
          <option value="auth">Unauthenticated</option>
          <option value="new">New User</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
        </select>
      </div>
    </div>

    <component :is="section" @auth-complete="handleAuthComplete" />
  </div>
</template>

<script setup lang="ts">
import { ref, onBeforeMount, computed } from 'vue';
import cardStore from '@/stores/modules/card';
import { useMockCardData } from '@/models/card-example';
import KaiserexAuthPage from '@/modules/wallet/components/KaiserexAuthPage.vue';
import OrderCardSection from '@/modules/wallet/pages/OrderCardSection.vue';
import PendingSection from '@/modules/wallet/pages/PendingSection.vue';
import HomeSection from '@/modules/wallet/pages/HomeSection.vue';
import geroStore from '@/stores/geroStore';

const store = geroStore;
const { initializeMockData } = useMockCardData();

const section = ref(KaiserexAuthPage);
const currentStatus = ref('auth' as 'auth' | 'new' | 'pending' | 'approved');

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

  // Clear existing data
  cardStore.state.userInfo = null;
  cardStore.state.cardData = null;
  localStorage.removeItem('kycStatus');
  localStorage.removeItem('kaiserexRegistered');

  // Set data based on status
  switch (status) {
    case 'auth':
      // No authentication - show auth page
      break;
    case 'new':
      // Authenticated but no KYC data - show order page
      localStorage.setItem('kaiserexRegistered', 'true');
      break;
    case 'pending':
      localStorage.setItem('kaiserexRegistered', 'true');
      cardStore.state.userInfo = { email: 'test@example.com' };
      localStorage.setItem('kycStatus', 'pending');
      break;
    case 'approved':
      localStorage.setItem('kaiserexRegistered', 'true');
      cardStore.state.userInfo = { email: 'test@example.com' };
      cardStore.state.cardData = {
        pan: '**** **** **** 1234',
        currentBalance: '1000.00',
        currency: 'EUR',
      };
      break;
  }

  setActiveStatus();
};

const setActiveStatus = () => {
  const status = import.meta.env.DEV ? currentStatus.value : determineStatus.value;
  console.log('Current status:', status);
  console.log('User info:', cardStore.state.userInfo);
  console.log('Card data:', cardStore.state.cardData);
  console.log('Kaiserex authenticated:', localStorage.getItem('kaiserexRegistered') === 'true');

  switch (status) {
    case 'auth':
      section.value = KaiserexAuthPage;
      break;
    case 'new':
      section.value = OrderCardSection;
      break;
    case 'pending':
      section.value = PendingSection;
      break;
    case 'approved':
      section.value = HomeSection;
      break;
    default:
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
});

// Handle auth completion from KaiserexAuthPage
const handleAuthComplete = () => {
  console.log('Kaiserex authentication completed');
  // Re-evaluate status after authentication
  if (!import.meta.env.DEV) {
    setActiveStatus();
  } else {
    // In dev mode, switch to 'new' status
    currentStatus.value = 'new';
    setStatus('new');
  }
};

// Watch for changes in user data and update status
import { watch } from 'vue';

watch(
  [() => cardStore.state.userInfo, () => cardStore.state.cardData, () => localStorage.getItem('kaiserexRegistered')],
  () => {
    if (!import.meta.env.DEV) {
      console.log('User data changed, updating status...');
      setActiveStatus();
    }
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
