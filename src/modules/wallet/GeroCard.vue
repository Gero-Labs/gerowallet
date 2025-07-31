<template>
  <div class="gero-wallet">
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

const setActiveStatus = () => {
  const currentStatus = determineStatus.value;
  console.log('Current status:', currentStatus);
  console.log('User info:', cardStore.state.userInfo);
  console.log('Card data:', cardStore.state.cardData);

  switch (currentStatus) {
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
    await cardStore.initialize(store.getWallet);
  }

  // Set active status after data is loaded
  setActiveStatus();
});

// Watch for changes in user data and update status
import { watch } from 'vue';

watch(
  [() => cardStore.state.userInfo, () => cardStore.state.cardData],
  () => {
    console.log('User data changed, updating status...');
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
  padding: 32px;
}
</style>
