<template>
  <v-card class="welcome-card" outlined>
    <div class="welcome-text">
      <span class="welcome-title">Welcome back, </span>
      <br />
      <span class="welcome-subtitle">{{ userName }}</span>
    </div>
  </v-card>
</template>

<script setup lang="ts">
interface Props {
  userName?: string;
}

defineProps<Props>();
</script>

<style lang="scss" scoped>
@import '../../styles/variables';
@import '../../styles/mixins';

.welcome-card {
  border-radius: $border-radius-lg;
  background-image: url('@/modules/wallet/icons/cardHomeBanner.svg');
  background-repeat: no-repeat;
  height: 232px;
  display: flex;
  align-items: center;
  padding: 44px;
}

.welcome-title {
  font-family: $font-family-primary;
  font-weight: 300;
  font-size: 32px;
  line-height: 1.366;
  color: $text-primary;
  margin: 0;
}

.welcome-subtitle {
  font-family: $font-family-secondary;
  font-weight: 600;
  font-size: 32px;
  line-height: 1.366;
  color: $text-primary;
}
</style>
