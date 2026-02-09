<template>
  <button class="secondary-button" :disabled="disabled" @click="$emit('click')">
    <span class="button-text">{{ text }}</span>
  </button>
</template>

<script setup lang="ts">
interface Props {
  text: string;
  disabled?: boolean;
}

withDefaults(defineProps<Props>(), {
  text: '',
  disabled: false
});

defineEmits<{
  click: [];
}>();
</script>

<style lang="scss" scoped>
@import '../styles/variables';
@import '../styles/mixins';
.secondary-button {
  @include secondary-button;
  @include button-size;
  width: fit-content;
  transition: opacity 0.3s ease, filter 0.3s ease;

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    filter: grayscale(50%);

    &:hover {
      background: inherit;
      border-color: inherit;
      color: inherit;
      transform: none;
      box-shadow: none;
    }

    &:active {
      transform: none;
    }
  }
}

.secondary-button:hover {
  background: $background-dark;
  border-color: $border-secondary;
  color: $text-secondary;
  transform: translateY(-1px);
  box-shadow: $shadow-md;
}

.secondary-button:active {
  transform: translateY(0);
}

.button-text {
  position: relative;
  z-index: 1;
}

@media (max-width: $breakpoint-md) {
  .secondary-button {
    padding: $spacing-sm $spacing-md;
    @include body-text($font-size-base);
  }
}
</style>
