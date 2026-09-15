<template>
  <div class="empty-state">
    <v-icon class="empty-state__icon" :size="iconSize">{{ icon }}</v-icon>
    <p class="t-body empty-state__message">{{ message }}</p>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  message: string;
  icon?: string;
  iconSize?: number;
}>(), {
  icon: 'mdi-inbox-outline',
  iconSize: 32,
});
</script>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--g-s-3);
  padding: var(--g-s-5);
  text-align: center;
}
.empty-state__icon {
  color: var(--g-text-3);
}
.empty-state__message {
  margin: 0;
  max-width: 42ch;
}
</style>
