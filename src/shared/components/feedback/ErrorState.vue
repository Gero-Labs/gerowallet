<template>
  <div class="error-state">
    <v-icon class="error-state__icon" :size="iconSize">{{ icon }}</v-icon>
    <p class="t-body error-state__message">{{ message }}</p>
    <GButton v-if="retryable" tier="secondary" compact @click="$emit('retry')">
      {{ retryLabel || $t('common.retry') }}
    </GButton>
  </div>
</template>

<script setup lang="ts">
import GButton from '@/shared/components/GButton/GButton.vue';

withDefaults(defineProps<{
  message: string;
  icon?: string;
  iconSize?: number;
  retryable?: boolean;
  /** Falls back to the shared common.retry key. */
  retryLabel?: string;
}>(), {
  icon: 'mdi-alert-circle-outline',
  iconSize: 32,
  retryable: false,
});

defineEmits<{ (e: 'retry'): void }>();
</script>

<style scoped>
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--g-s-3);
  padding: var(--g-s-5);
  text-align: center;
}
.error-state__icon {
  color: var(--g-error);
}
.error-state__message {
  margin: 0;
  max-width: 42ch;
}
</style>
