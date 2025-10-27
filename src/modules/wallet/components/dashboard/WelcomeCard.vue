<template>
  <div class="welcome-container">
    <div class="welcome-text">
      <span class="welcome-title">{{ $t('wallet.welcomeBack') }}</span>
      <br />
      <span class="welcome-subtitle">{{ userName }}</span>
    </div>
  </div>
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

.welcome-container {
  background-repeat: no-repeat;
  height: 273px;
  border-radius: $border-radius-lg;
  display: flex;
  align-items: center;
  padding: 44px;
  width: 100%;
  background-size: cover;
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
