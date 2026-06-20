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
import { useChainContext } from '../composables/useChainContext';
import assets from '@/utils/assets';

const { t } = useTranslation();
const { networkInfo, themeColors, isApex } = useChainContext();

const emit = defineEmits<{
  (e: 'action', id: string): void;
}>();

interface QuickAction {
  id: string;
  svg: string;
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  filter: string;
  enabled: boolean;
}

const allActions = computed<QuickAction[]>(() => {
  const primaryColor = themeColors.value.primary;
  // For Send icon: use the chain-specific iconFilter (terracotta on Apex, cyan on Cardano)
  const sendFilter = isApex.value
    ? 'brightness(0) saturate(100%) invert(52%) sepia(85%) saturate(1100%) hue-rotate(345deg) brightness(108%) contrast(98%)'
    : 'invert(83%) sepia(48%) saturate(3753%) hue-rotate(133deg) brightness(92%) contrast(108%)';

  return [
    {
      id: 'send',
      svg: assets.sendSvg,
      label: t('dashboard.send'),
      color: primaryColor,
      bgColor: `color-mix(in srgb, ${primaryColor} 12%, transparent)`,
      borderColor: `color-mix(in srgb, ${primaryColor} 40%, transparent)`,
      filter: sendFilter,
      enabled: !!networkInfo.value?.transactionSupport,
    },
    {
      id: 'receive',
      svg: assets.qrCodeSvg,
      label: t('dashboard.receive'),
      color: '#75E0A7',
      bgColor: 'rgba(117, 224, 167, 0.12)',
      borderColor: 'rgba(117, 224, 167, 0.4)',
      filter: 'invert(83%) sepia(16%) saturate(992%) hue-rotate(92deg) brightness(94%) contrast(92%)',
      enabled: !!networkInfo.value?.transactionSupport,
    },
    {
      id: 'swap',
      svg: assets.swapSvg,
      label: t('swap.swap'),
      color: '#FDA29B',
      bgColor: 'rgba(253, 162, 155, 0.12)',
      borderColor: 'rgba(253, 162, 155, 0.4)',
      filter: 'invert(62%) sepia(76%) saturate(306%) hue-rotate(314deg) brightness(105%) contrast(98%)',
      enabled: !!networkInfo.value?.swapSupport,
    },
    {
      id: 'perps',
      svg: assets.barChart,
      label: t('miniGero.perps'),
      color: '#B794F4',
      bgColor: 'rgba(183, 148, 244, 0.12)',
      borderColor: 'rgba(183, 148, 244, 0.4)',
      filter: 'invert(66%) sepia(41%) saturate(458%) hue-rotate(226deg) brightness(95%) contrast(96%)',
      enabled: !!networkInfo.value?.perpetualsSupport,
    },
  ];
});

const actions = computed(() => allActions.value.filter(a => a.enabled));

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
