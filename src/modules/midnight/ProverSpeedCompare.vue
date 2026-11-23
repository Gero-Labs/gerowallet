<template>
  <div class="psc-card" data-testid="prover-speed-compare">
    <!-- "Speed on this computer": the same test proof made by each way of
         proving on this computer (useProverSpeedTest.ts). The numbers are this
         machine's own, measured when the user asks. -->
    <div class="psc-head">
      <div>
        <h2 class="t-heading">{{ t('midnight.prover.speedTitle') }}</h2>
        <p class="t-body-sm psc-sub">{{ t('midnight.prover.speedBody') }}</p>
      </div>
      <GButton tier="secondary" compact :loading="running" data-testid="prover-speed-run" @click="run()">
        {{ measured ? t('midnight.prover.speedRunAgain') : t('midnight.prover.speedRun') }}
      </GButton>
    </div>

    <div class="psc-rows">
      <div v-for="row in rows" :key="row.id" class="psc-row" :data-testid="`prover-speed-${row.id}`">
        <div class="psc-label">
          <span class="t-body">{{ rowLabel(row) }}</span>
          <span v-if="fastest === row.id" class="psc-fastest t-caption">{{ t('midnight.prover.speedFastest') }}</span>
        </div>
        <div class="psc-track" aria-hidden="true">
          <div
            v-if="row.state.status === 'done'"
            class="psc-bar"
            :class="{ 'psc-bar--fastest': fastest === row.id }"
            :style="{ width: barWidth(row.state.ms) }"
          ></div>
        </div>
        <div class="psc-value t-body g-num" role="status">
          <v-progress-circular v-if="row.state.status === 'running'" indeterminate size="14" width="2" color="var(--g-accent)" />
          <template v-else>{{ rowValue(row) }}</template>
        </div>
      </div>
    </div>

    <p class="t-caption psc-note">{{ t('midnight.prover.speedNote') }}</p>
  </div>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import GButton from '@/shared/components/GButton/GButton.vue';
import { useProverSpeedTest, type SpeedRow } from '@/chains/midnight/useProverSpeedTest';

const props = defineProps<{
  /** "In this browser" (several threads) is on offer. */
  browserOffered: boolean;
  /** Gero Prover is on offer. */
  helperOffered: boolean;
}>();

const { t } = useTranslation();

const { rows, run, running, fastest, slowestMs, measured, plannedThreads } = useProverSpeedTest(
  () => ({ browser: props.browserOffered, helper: props.helperOffered }),
);

function rowLabel(row: SpeedRow): string {
  if (row.id === 'helper') return t('midnight.prover.engineHelper');
  if (row.id === 'standard') return t('midnight.prover.speedStandard');
  const threads = row.state.status === 'done' && row.state.threads ? row.state.threads : plannedThreads.value;
  return threads > 1 ? t('midnight.prover.speedThreaded', { n: threads }) : t('midnight.prover.engineBrowser');
}

function rowValue(row: SpeedRow): string {
  switch (row.state.status) {
    case 'done': return t('midnight.send.provingElapsed', { n: (row.state.ms / 1000).toFixed(1) });
    case 'unavailable': return t(row.id === 'helper' ? 'midnight.prover.speedNotSetUp' : 'midnight.prover.speedNoThreads');
    case 'failed': return t('midnight.prover.speedFailed');
    default: return t('midnight.prover.speedNotRun');
  }
}

/** Longest bar is the slowest prover; never thinner than a sliver, so a fast one still shows. */
function barWidth(ms: number): string {
  if (slowestMs.value <= 0) return '0%';
  return `${Math.max(2, Math.round((ms / slowestMs.value) * 100))}%`;
}
</script>

<style scoped lang="scss">
.psc-card {
  @include g-glass-panel(false);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-sheet);
  padding: var(--g-s-5);
  margin-bottom: var(--g-s-4);
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
}

.psc-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--g-s-3);
}

.psc-sub {
  margin-top: var(--g-s-1);
  margin-bottom: 0;
}

.psc-rows {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
}

.psc-row {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 2fr) minmax(88px, auto);
  align-items: center;
  gap: var(--g-s-3);
}

@media (max-width: 620px) {
  .psc-row { grid-template-columns: minmax(0, 1fr) auto; }
  .psc-track { grid-column: 1 / -1; order: 3; }
}

.psc-label {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--g-s-2);
  min-width: 0;
}

.psc-fastest {
  color: var(--g-success);
}

/* The track is a control-sized solid: a bar needs an opaque ground to be read against. */
.psc-track {
  height: 8px;
  border-radius: var(--g-r-pill);
  background: var(--g-raised);
  overflow: hidden;
}

.psc-bar {
  height: 100%;
  border-radius: var(--g-r-pill);
  background: var(--g-text-3);
  transition: width var(--g-dur-base) ease;
}

.psc-bar--fastest {
  background: var(--g-accent);
}

.psc-value {
  text-align: right;
  white-space: nowrap;
  color: var(--g-text-2);
}

.psc-note {
  margin: 0;
}
</style>
