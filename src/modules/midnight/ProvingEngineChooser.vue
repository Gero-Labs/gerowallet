<template>
  <div class="pe-wrap" data-testid="proving-engine-chooser">
    <!-- How "This computer" proves: the browser's own prover, the Gero Prover
         app, or a Docker proof server. One is always chosen; the choice is
         stored as proofServer.localEngine (useProofServerSettings.ts). -->
    <h2 id="proving-engine-title" class="t-heading pe-title">{{ t('midnight.prover.engineTitle') }}</h2>
    <div class="pe-grid" role="radiogroup" aria-labelledby="proving-engine-title">
      <button
        v-for="option in options"
        :key="option.id"
        type="button"
        role="radio"
        class="pe-card"
        :class="{ 'pe-card--active': modelValue === option.id }"
        :aria-checked="modelValue === option.id"
        :disabled="disabled"
        :data-testid="`proving-engine-${option.id}`"
        @click="emit('update:modelValue', option.id)"
      >
        <span class="pe-icon"><v-icon size="20" aria-hidden="true">{{ option.icon }}</v-icon></span>
        <span class="pe-body">
          <span class="pe-title-row">
            <span class="t-body-lg">{{ t(option.title) }}</span>
            <span class="pe-badge t-caption">{{ t(option.badge) }}</span>
          </span>
          <span class="t-caption pe-hint">{{ t(option.body) }}</span>
        </span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import type { LocalProvingEngine } from '@/chains/midnight/midnightProvingTarget';

const props = defineProps<{
  modelValue: LocalProvingEngine;
  /** "In this browser" is on offer. */
  browserOffered: boolean;
  /** Gero Prover is on offer. */
  helperOffered: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{ (event: 'update:modelValue', engine: LocalProvingEngine): void }>();

const { t } = useTranslation();

interface EngineOption { id: LocalProvingEngine; icon: string; title: string; badge: string; body: string }

const ALL: EngineOption[] = [
  {
    id: 'browser', icon: 'mdi-application-outline', title: 'midnight.prover.engineBrowser',
    badge: 'midnight.prover.engineBrowserBadge', body: 'midnight.prover.engineBrowserBody',
  },
  {
    id: 'helper', icon: 'mdi-memory', title: 'midnight.prover.engineHelper',
    badge: 'midnight.prover.engineHelperBadge', body: 'midnight.prover.engineHelperBody',
  },
  {
    id: 'docker', icon: 'mdi-docker', title: 'midnight.prover.engineDocker',
    badge: 'midnight.prover.engineDockerBadge', body: 'midnight.prover.engineDockerBody',
  },
];

const options = computed(() => ALL.filter((option) => (
  option.id === 'docker' || (option.id === 'browser' ? props.browserOffered : props.helperOffered)
)));
</script>

<style scoped lang="scss">
.pe-wrap {
  margin-bottom: var(--g-s-4);
}

.pe-title {
  margin-bottom: var(--g-s-3);
}

.pe-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--g-s-3);
}

.pe-card {
  @include g-glass-tier(false);
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-3);
  text-align: left;
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-sheet);
  padding: var(--g-s-4);
  cursor: pointer;
  transition: border-color var(--g-dur-fast) ease, background var(--g-dur-fast) ease;
  font: inherit;
  color: inherit;
}

.pe-card:hover:not(:disabled) {
  border-color: var(--g-hairline-2);
}

.pe-card:disabled {
  cursor: default;
  opacity: 0.7;
}

.pe-card--active {
  border-color: var(--g-accent);
  background: var(--g-raised);
}

.pe-icon {
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: var(--g-r-control);
  background: var(--g-raised);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--g-text-2);
}

.pe-card--active .pe-icon {
  color: var(--g-accent);
}

.pe-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}

.pe-title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-2);
}

/* A label-sized chip: a justified solid. */
.pe-badge {
  flex: none;
  padding: 2px 8px;
  border-radius: var(--g-r-pill);
  background: var(--g-raised);
  color: var(--g-text-2);
}

.pe-card--active .pe-badge {
  color: var(--g-accent);
}

.pe-hint {
  display: block;
}
</style>
