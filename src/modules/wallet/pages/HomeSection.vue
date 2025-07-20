<template>
  <div class="home-section">
    <v-row no-gutters>
      <v-col cols="12">
        <!-- Welcome Section -->
        <WelcomeCard @top-up="handleTopUp" @manage-card="handleManageCard" @qr-scan="handleQrScan" />
      </v-col>
    </v-row>
  </div>
</template>

<script setup lang="ts">
import WelcomeCard from '../components/dashboard/WelcomeCard.vue';

const handleTopUp = () => {
  console.log('Top up clicked');
  // Handle top up action
};

const handleManageCard = () => {
  console.log('Manage card clicked');
  // Handle manage card action
};

const handleQrScan = () => {
  console.log('QR scan clicked');
  // Handle QR scan action
};
</script>

<style lang="scss" scoped>
@import '../styles/variables';
@import '../styles/mixins';

.home-section {
  background: $background-dark;
  min-height: 100vh;
  padding: 12px 32px 96px;
  display: flex;
  flex-direction: column;
  gap: 32px;
}

@media (max-width: $breakpoint-md) {
  .home-section {
    padding: 8px 16px 64px;
  }
}
</style>
