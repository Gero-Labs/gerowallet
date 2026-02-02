<template>
  <button class="gradient-button" @click="$emit('click')" :disabled="disabled || loading">
    <v-progress-circular v-if="loading" indeterminate size="20" width="2" color="black" class="button-loader" />
    <template v-if="!loading">
      <!-- Image icon -->
      <img v-if="iconImage" :src="iconImage" class="button-icon-img" alt="icon" />
      <!-- Material Design icon -->
      <v-icon v-else-if="icon" small class="button-icon">{{ icon }}</v-icon>
      <span class="button-text">{{ text }}</span>
    </template>
  </button>
</template>

<script setup lang="ts">
interface Props {
  text: string;
  disabled?: boolean;
  loading?: boolean;
  icon?: string;
  iconImage?: string;
}

defineProps<Props>();
defineEmits<{
  (e: 'click'): void;
}>();
</script>

<style lang="scss" scoped>
@import '../styles/variables';
@import '../styles/mixins';
.gradient-button {
  @include gradient-button;
  @include button-size;
  width: fit-content;
  position: relative;
  overflow: hidden;
  border-radius: 8px;
  color: #0c0e12 !important; // Dark text color (override white from mixin)
  transition: opacity 0.3s ease, filter 0.3s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    filter: grayscale(50%);

    &:hover::before {
      left: -100%;
    }
  }
}

.gradient-button::before {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, transparent, $text-secondary, transparent);
    transition: left 0.5s ease;
  }

.gradient-button:hover::before {
    left: 100%;
  }

.gradient-button:active::before {
  left: 100%;
}

.button-icon {
  position: relative;
  z-index: 1;
  color: #0c0e12 !important;
}

.button-icon-img {
  position: relative;
  z-index: 1;
  width: 18px;
  height: 18px;
  object-fit: contain;
  filter: brightness(0);
}

.button-text {
  position: relative;
  z-index: 1;
}

.button-loader {
  position: relative;
  z-index: 1;
}
</style>
