<template>
  <button class="secondary-button" @click="$emit('click')">
    <span class="button-text">{{ text }}</span>
  </button>
</template>

<script setup lang="ts">
interface Props {
  text: string | any;
}

defineProps<Props>();
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
