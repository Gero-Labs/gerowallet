<template>
  <button class="gradient-button" @click="$emit('click')" :disabled="disabled || loading">
    <v-progress-circular v-if="loading" indeterminate size="20" width="2" color="black" class="button-loader" />
    <span v-if="!loading" class="button-text">{{ text }}</span>
  </button>
</template>

<script setup lang="ts">
interface Props {
  text: string;
  disabled?: boolean;
  loading?: boolean;
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

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    background: #1f242f;
    color: #666 !important;

    &::before {
      display: none;
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

.button-text {
  position: relative;
  z-index: 1;
}

.button-loader {
  position: relative;
  z-index: 1;
}
</style>
