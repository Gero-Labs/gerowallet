<template>
  <div class="quick-actions">
    <!-- A held action stays in place and focusable (aria-disabled), with its
         reason linked by aria-describedby; the parent shows the reason. -->
    <button
      v-for="action in actions"
      :key="action.id"
      type="button"
      class="action-btn"
      :class="{ 'action-btn--held': isHeld(action.id) }"
      :aria-disabled="isHeld(action.id) ? 'true' : undefined"
      :aria-describedby="isHeld(action.id) ? describedBy : undefined"
      :data-testid="`quick-action-${action.id}`"
      @click="handleAction(action.id)"
    >
      <div
        class="action-icon"
        :style="isHeld(action.id) ? undefined : {
          background: action.bgColor,
          borderColor: action.borderColor,
        }"
      >
        <v-avatar rounded="0" size="18">
          <v-img
            :src="action.svg"
            :alt="action.label"

            :style="{ filter: action.filter }"
          />
        </v-avatar>
      </div>
      <span class="action-label text-caption" :style="isHeld(action.id) ? undefined : { color: action.color }">{{ action.label }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useChainContext } from '../composables/useChainContext';
import assets from '@/utils/assets';

const { t } = useTranslation();
const { networkInfo } = useChainContext();

const props = withDefaults(defineProps<{
  /** Actions shown but held (for example Send while the network is paused). */
  disabledIds?: readonly string[];
  /** The id of the element that says why. */
  describedBy?: string;
}>(), { disabledIds: () => [], describedBy: undefined });

const emit = defineEmits<{
  (e: 'action', id: string): void;
}>();

const isHeld = (id: string) => props.disabledIds.includes(id);

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
  return [
    // Fixed tokens for every action - the chain accent is deliberately NOT
    // used here (it previously made Send a mixed purple-circle/cyan-icon odd
    // one out on Midnight while its siblings kept stable colors). Send is
    // neutral white rather than a semantic color: it's the primary action, and
    // the semantic tokens are spoken for by its siblings (success/info).
    // Swap is not here — it owns the center slot of the bottom nav.
    {
      id: 'send',
      svg: assets.sendSvg,
      label: t('dashboard.send'),
      color: 'var(--g-text-1)',
      bgColor: 'color-mix(in srgb, var(--g-text-1) 10%, transparent)',
      borderColor: 'color-mix(in srgb, var(--g-text-1) 35%, transparent)',
      filter: 'brightness(0) invert(1)',
      enabled: !!networkInfo.value?.transactionSupport,
    },
    {
      id: 'receive',
      svg: assets.qrCodeSvg,
      label: t('dashboard.receive'),
      color: 'var(--g-success)',
      bgColor: 'color-mix(in srgb, var(--g-success) 12%, transparent)',
      borderColor: 'color-mix(in srgb, var(--g-success) 40%, transparent)',
      filter: 'invert(83%) sepia(16%) saturate(992%) hue-rotate(92deg) brightness(94%) contrast(92%)',
      enabled: !!networkInfo.value?.transactionSupport,
    },
    {
      id: 'perps',
      svg: assets.barChart,
      label: t('miniGero.perps'),
      color: 'var(--g-info)',
      bgColor: 'color-mix(in srgb, var(--g-info) 12%, transparent)',
      borderColor: 'color-mix(in srgb, var(--g-info) 40%, transparent)',
      filter: 'invert(66%) sepia(41%) saturate(458%) hue-rotate(226deg) brightness(95%) contrast(96%)',
      enabled: !!networkInfo.value?.perpetualsSupport,
    },
  ];
});

const actions = computed(() => allActions.value.filter(a => a.enabled));

function handleAction(id: string) {
  if (isHeld(id)) return;
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
}

.action-btn:hover .action-icon {
  transform: scale(1.05);
}

.action-label {
  font-size: 11px !important;
  font-weight: 500;
}

/* Held: the design system's disabled look (raised fill, hairline, muted text), no motion. */
.action-btn--held {
  cursor: not-allowed;
}

.action-btn--held .action-icon {
  background: var(--g-raised);
  border-color: var(--g-hairline-1);
}

.action-btn--held:hover .action-icon,
.action-btn--held:active .action-icon {
  transform: none;
}

.action-btn--held .action-label {
  color: var(--g-text-3);
}

.action-btn--held :deep(.v-img) {
  opacity: 0.4;
}
</style>
