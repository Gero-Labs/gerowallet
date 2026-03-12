<template>
  <div class="quick-actions">
    <button
      v-for="action in actions"
      :key="action.id"
      class="action-btn"
      @click="handleAction(action.id)"
    >
      <div
        class="action-icon"
        :style="{
          background: action.bgColor,
          borderColor: action.borderColor,
        }"
      >
        <v-avatar tile size="18">
          <v-img
            :src="action.svg"
            :alt="action.label"
            contain
            :style="{ filter: action.filter }"
          />
        </v-avatar>
      </div>
      <span class="action-label text-caption" :style="{ color: action.color }">{{ action.label }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import assets from '@/utils/assets';

const { t } = useTranslation();

const emit = defineEmits<{
  (e: 'action', id: string): void;
}>();

const actions = computed(() => [
  {
    id: 'send',
    svg: assets.sendSvg,
    label: t('dashboard.send'),
    color: '#00DFF3',
    bgColor: 'rgba(0, 223, 243, 0.12)',
    borderColor: 'rgba(0, 223, 243, 0.4)',
    filter: 'invert(83%) sepia(48%) saturate(3753%) hue-rotate(133deg) brightness(92%) contrast(108%)',
  },
  {
    id: 'receive',
    svg: assets.qrCodeSvg,
    label: t('dashboard.receive'),
    color: '#75E0A7',
    bgColor: 'rgba(117, 224, 167, 0.12)',
    borderColor: 'rgba(117, 224, 167, 0.4)',
    filter: 'invert(83%) sepia(16%) saturate(992%) hue-rotate(92deg) brightness(94%) contrast(92%)',
  },
  {
    id: 'swap',
    svg: assets.swapSvg,
    label: t('swap.swap'),
    color: '#FDA29B',
    bgColor: 'rgba(253, 162, 155, 0.12)',
    borderColor: 'rgba(253, 162, 155, 0.4)',
    filter: 'invert(62%) sepia(76%) saturate(306%) hue-rotate(314deg) brightness(105%) contrast(98%)',
  },
  {
    id: 'perps',
    svg: assets.barChart,
    label: t('miniGero.perps'),
    color: '#B794F4',
    bgColor: 'rgba(183, 148, 244, 0.12)',
    borderColor: 'rgba(183, 148, 244, 0.4)',
    filter: 'invert(66%) sepia(41%) saturate(458%) hue-rotate(226deg) brightness(95%) contrast(96%)',
  },
]);

function handleAction(id: string) {
  emit('action', id);
}
</script>

<style scoped>
.quick-actions {
  display: flex;
  justify-content: center;
  gap: 20px;
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
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  border: 1px solid;
  backdrop-filter: blur(12px);
}

.action-btn:hover .action-icon {
  box-shadow: 0 0 12px rgba(255, 255, 255, 0.1);
  transform: scale(1.05);
}

.action-label {
  font-size: 11px !important;
  font-weight: 500;
  letter-spacing: 0.3px;
}
</style>
