<template>
  <div class="gero-wallet wallet-module">
    <component :is="section" />
  </div>
</template>

<script setup lang="ts">
import { ref, onBeforeMount } from 'vue';
import OrderCardSection from '@/modules/wallet/pages/OrderCardSection.vue';
import PendingSection from '@/modules/wallet/pages/PendingSection.vue';

const status = ref('new');
const section = ref(OrderCardSection);

const setActiveStatus = () => {
  switch (status.value) {
    case 'new':
      section.value = OrderCardSection;
      break;
    case 'pending':
      section.value = PendingSection;
      break;
  }
};

watchEffect(() => {
  status.value = localStorage.getItem('kycStatus') || 'new';
  console.log('status', status.value);
  setActiveStatus();
});

onBeforeMount(() => {
  setActiveStatus();
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
  padding: 32px;
}
</style>
