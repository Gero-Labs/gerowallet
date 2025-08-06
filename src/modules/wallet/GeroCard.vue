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

  // Clear existing data
  cardStore.state.userInfo = null;
  cardStore.state.cardData = null;
  localStorage.removeItem('kycStatus');

  // Set data based on status
  switch (status) {
    case 'new':
      // No data needed
      break;
    case 'pending':
      cardStore.state.userInfo = { email: 'test@example.com' };
      localStorage.setItem('kycStatus', 'pending');
      break;
    case 'approved':
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

  switch (status) {
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
      section.value = OrderCardSection;
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

// Watch for changes in user data and update status
import { watch } from 'vue';

watch(
  [() => cardStore.state.userInfo, () => cardStore.state.cardData],
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
  padding: 32px;
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
