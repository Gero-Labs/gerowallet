<template>
  <v-badge
    :color="color"
    :dot="dot"
    :content="content"
    :overlap="overlap"
    :bordered="bordered"
    :value="show"
    class="notification-badge"
    :class="{ 'notification-badge--pulse': pulse }"
  >
    <slot></slot>
  </v-badge>
</template>

<script setup lang="ts">
interface Props {
  show?: boolean;         // Whether to show the badge
  color?: string;         // Color of the badge
  dot?: boolean;          // Show as dot instead of content
  content?: string | number; // Badge content (number or text)
  overlap?: boolean;      // Whether badge overlaps the content
  bordered?: boolean;     // Show white border around badge
  pulse?: boolean;        // Whether to animate with pulse effect
}

withDefaults(defineProps<Props>(), {
  show: true,
  color: 'error',
  dot: true,
  overlap: false,
  bordered: false,
  pulse: false,
});
</script>

<style scoped lang="scss">
.notification-badge--pulse {
  ::v-deep .v-badge__badge {
    animation: pulse 2s ease-in-out infinite;
  }
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.7;
    transform: scale(1.15);
  }
}
</style>