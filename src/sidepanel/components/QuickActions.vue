<template>
  <div class="quick-actions">
    <button
      v-for="action in actions"
      :key="action.id"
      class="action-btn"
      @click="handleAction(action.id)"
    >
      <div class="action-icon">
        <v-icon size="20" color="white">{{ action.icon }}</v-icon>
      </div>
      <span class="action-label text-caption white--text">{{ action.label }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';

const { t } = useTranslation();

const emit = defineEmits<{
  (e: 'action', id: string): void;
}>();

const actions = computed(() => [
  { id: 'send', icon: 'mdi-arrow-top-right', label: t('dashboard.send') },
  { id: 'receive', icon: 'mdi-arrow-bottom-left', label: t('dashboard.receive') },
  { id: 'swap', icon: 'mdi-swap-horizontal', label: t('swap.swap') },
  { id: 'perps', icon: 'mdi-chart-line', label: t('miniGero.perps') },
]);

function handleAction(id: string) {
  console.log('[MiniGero] QuickAction:', id);
  emit('action', id);
}
</script>

<style scoped>
.quick-actions {
  display: flex;
  justify-content: center;
  gap: 24px;
  padding: 12px 16px 16px;
}

.action-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  outline: none;
  -webkit-tap-highlight-color: transparent;
}

.action-btn:active .action-icon {
  transform: scale(0.92);
}

.action-icon {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #1a1a1a;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.15s ease, background 0.15s ease;
  border: 1px solid #2a2a2a;
}

.action-btn:hover .action-icon {
  background: #222;
  border-color: #00c7f3;
}

.action-label {
  font-size: 11px !important;
  letter-spacing: 0.3px;
}
</style>
