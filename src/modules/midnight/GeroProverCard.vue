<template>
  <div class="gp-card" data-testid="gero-prover-card" :data-view="view">
    <!-- Gero Prover: the desktop helper that makes Midnight proofs on this
         computer. One card for its whole life: the three setup steps, then its
         status and controls. Shown only while the isGeroProverEnabled flag is on
         and the user chose it (ProofServerPage.vue). -->
    <div class="gp-head">
      <div class="gp-head-text">
        <h2 class="t-heading">{{ view === 'setup' ? t('midnight.prover.setupTitle') : t('midnight.prover.name') }}</h2>
        <p class="t-body-sm gp-sub">{{ view === 'setup' ? t('midnight.prover.setupBody') : t('midnight.prover.cardBody') }}</p>
      </div>
      <div v-if="view !== 'setup'" class="gp-pill t-caption" :class="`gp-pill--${pillTone}`" role="status" data-testid="gero-prover-pill">
        <v-progress-circular v-if="view === 'checking'" indeterminate size="12" width="2" color="var(--g-text-3)" />
        <span v-else class="gp-dot" aria-hidden="true"></span>
        <span>{{ pillLabel }}</span>
      </div>
    </div>

    <!-- ── First-time setup ── -->
    <template v-if="view === 'setup'">
      <div class="gp-step">
        <div class="gp-step-badge" aria-hidden="true">1</div>
        <div class="gp-step-body">
          <div class="t-body-lg">{{ t('midnight.prover.step1Title') }}</div>
          <p class="t-body-sm gp-step-hint">{{ t('midnight.prover.step1Body') }}</p>
          <a v-if="downloadUrl" class="gp-link" :href="downloadUrl" target="_blank" rel="noopener noreferrer" data-testid="gero-prover-download">
            {{ t('midnight.prover.step1Link') }}
            <v-icon size="13" aria-hidden="true">mdi-open-in-new</v-icon>
          </a>
        </div>
      </div>

      <div class="gp-step">
        <div class="gp-step-badge" :class="{ 'gp-step-badge--active': waitingForHelper }" aria-hidden="true">2</div>
        <div class="gp-step-body">
          <div class="t-body-lg">{{ t('midnight.prover.step2Title') }}</div>
          <p class="t-body-sm gp-step-hint">{{ t('midnight.prover.step2Body') }}</p>
          <!-- The browser can only look for the helper once it is allowed to (step 3). -->
          <div v-if="waitingForHelper" class="gp-waiting t-body-sm" role="status" data-testid="gero-prover-waiting">
            <v-progress-circular indeterminate size="14" width="2" color="var(--g-accent)" />
            {{ t('midnight.prover.waiting') }}
          </div>
        </div>
      </div>

      <div class="gp-step gp-step--last">
        <div class="gp-step-badge" :class="{ 'gp-step-badge--done': allowed }">
          <v-icon v-if="allowed" size="14" :aria-label="t('midnight.prover.stepDone')">mdi-check</v-icon>
          <span v-else aria-hidden="true">3</span>
        </div>
        <div class="gp-step-body">
          <div class="t-body-lg">{{ t('midnight.prover.step3Title') }}</div>
          <p class="t-body-sm gp-step-hint">{{ t('midnight.prover.step3Body') }}</p>
          <GButton
            v-if="!allowed"
            tier="primary"
            compact
            class="gp-step-action"
            :loading="busy === 'allow'"
            data-testid="gero-prover-allow"
            @click="allow()"
          >
            {{ t('midnight.prover.allow') }}
          </GButton>
        </div>
      </div>

      <div class="gp-foot">
        <span class="t-caption">{{ t('midnight.prover.setupFooter') }}</span>
        <button type="button" class="gp-link" data-testid="gero-prover-use-docker" @click="emit('use-docker')">
          {{ t('midnight.prover.useDocker') }}
        </button>
      </div>
    </template>

    <!-- ── Set up before, and not usable now ── -->
    <template v-else-if="view === 'error' || view === 'forbidden' || view === 'wrongVersion'">
      <GNote :tone="view === 'error' ? 'error' : 'warning'" icon="mdi-alert-circle-outline" role="status" data-testid="gero-prover-problem">
        <div class="t-body-lg gp-note-title">{{ problemTitle }}</div>
        <div>{{ problemBody }}</div>
      </GNote>
      <div class="gp-actions">
        <GButton tier="secondary" compact :loading="busy === 'refresh'" data-testid="gero-prover-retry" @click="checkAgain()">
          {{ t('common.tryAgain') }}
        </GButton>
        <a v-if="downloadUrl && view !== 'forbidden'" class="gp-link" :href="downloadUrl" target="_blank" rel="noopener noreferrer">
          {{ t('midnight.prover.step1Link') }}
          <v-icon size="13" aria-hidden="true">mdi-open-in-new</v-icon>
        </a>
        <button type="button" class="gp-link" @click="emit('use-docker')">{{ t('midnight.prover.useDocker') }}</button>
      </div>
    </template>

    <!-- ── Connected ── -->
    <template v-else-if="view === 'connected' && status">
      <!-- A proof failed on the graphics processor and was made again on the main
           processor: the helper stays there until the user turns it back on. -->
      <GNote v-if="accelerator === 'tripped'" tone="warning" icon="mdi-pause-circle-outline" role="status" data-testid="gero-prover-tripped">
        <div class="t-body-lg gp-note-title">{{ t('midnight.prover.trippedTitle') }}</div>
        <div>{{ t('midnight.prover.trippedBody') }}</div>
        <GButton tier="secondary" compact class="gp-step-action" :loading="busy === 'toggle'" data-testid="gero-prover-turn-on" @click="setAccelerator(true)">
          {{ t('midnight.prover.turnBackOn') }}
        </GButton>
      </GNote>

      <div class="gp-tiles">
        <div class="gp-tile" data-testid="gero-prover-processor">
          <div class="t-label">{{ t('midnight.prover.provingOn') }}</div>
          <div class="t-body-lg gp-tile-value">{{ processorLabel }}</div>
          <div class="t-caption">{{ processorHint }}</div>
        </div>
        <div class="gp-tile">
          <div class="t-label">{{ t('midnight.proofServerPage.widgetLastProof') }}</div>
          <div class="t-body-lg gp-tile-value g-num">
            {{ lastProof ? t('midnight.send.provingElapsed', { n: (lastProof.durationMs / 1000).toFixed(1) }) : '—' }}
          </div>
          <div class="t-caption">{{ lastProof ? formatRelativeTime(lastProof.timestamp) : t('midnight.prover.noProofYet') }}</div>
        </div>
        <div class="gp-tile">
          <div class="t-label">{{ t('midnight.prover.provingFiles') }}</div>
          <div class="t-body-lg gp-tile-value g-num">{{ t('midnight.prover.megabytes', { n: filesMegabytes }) }}</div>
          <div class="t-caption">{{ status.keys.files > 0 ? t('midnight.prover.filesReady') : t('midnight.prover.filesNone') }}</div>
        </div>
      </div>

      <div class="gp-row">
        <div>
          <div id="gero-prover-gpu-label" class="t-body-lg">{{ t('midnight.prover.gpuSwitch') }}</div>
          <p class="t-body-sm gp-step-hint">{{ t('midnight.prover.gpuSwitchBody') }}</p>
        </div>
        <v-switch
          :model-value="status.accelerator.enabled && gpuAvailable"
          :disabled="!gpuAvailable || busy === 'toggle'"
          inset
          density="compact"
          hide-details
          color="var(--g-accent)"
          aria-labelledby="gero-prover-gpu-label"
          data-testid="gero-prover-gpu-switch"
          @update:model-value="setAccelerator($event === true)"
        />
      </div>

      <div class="gp-foot">
        <span class="t-caption">{{ t('midnight.prover.footer', { version: snapshot?.version ?? '' }) }}</span>
        <div class="gp-actions gp-actions--end">
          <GButton tier="secondary" compact :loading="busy === 'test'" data-testid="gero-prover-test" @click="runTest()">
            {{ t('midnight.prover.runTest') }}
          </GButton>
          <GButton tier="tertiary" compact :loading="busy === 'remove'" :disabled="status.keys.files === 0" data-testid="gero-prover-remove" @click="removeFiles()">
            {{ t('midnight.prover.removeFiles') }}
          </GButton>
        </div>
      </div>
      <p v-if="testResult" class="t-caption gp-test" :class="{ 'gp-test--failed': !testResult.ok }" role="status" data-testid="gero-prover-test-result">
        {{ testResultText }}
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import GButton from '@/shared/components/GButton/GButton.vue';
import GNote from '@/shared/components/GNote.vue';
import { midnightStore } from '@/stores/midnightStore';
import { formatRelativeTime } from '@/shared/utils/relativeTime';
import { useGeroProver } from '@/chains/midnight/useGeroProver';

const emit = defineEmits<{ (event: 'use-docker'): void }>();

const { t } = useTranslation();

const {
  snapshot, view, status, accelerator, allowed, waitingForHelper, busy, testResult,
  allow, checkAgain, setAccelerator, runTest, removeFiles, downloadUrl,
} = useGeroProver(() => true);

const pillTone = computed(() => (view.value === 'connected' ? 'ok' : view.value === 'checking' ? 'idle' : 'off'));
const pillLabel = computed(() => {
  if (view.value === 'connected') return t('midnight.proofServerPage.statusDetectedShort');
  return view.value === 'checking' ? t('midnight.proofServer.statusChecking') : t('midnight.prover.statusNotConnected');
});

/** The helper has a graphics processor it can use (whether or not it is switched on, or paused). */
const gpuAvailable = computed(() => accelerator.value === 'active' || accelerator.value === 'off' || accelerator.value === 'tripped');

const processorLabel = computed(() => t(accelerator.value === 'active' ? 'midnight.prover.gpu' : 'midnight.prover.cpu'));
const processorHint = computed(() => {
  const device = status.value?.accelerator.device;
  switch (accelerator.value) {
    case 'active': return device ? t('midnight.prover.gpuHintNamed', { device }) : t('midnight.prover.gpuHint');
    case 'off': return t('midnight.prover.gpuOffHint');
    case 'tripped': return t('midnight.prover.gpuPausedHint');
    // `no-device` (no NVIDIA card it can use) and `unsupported` (no graphics-processor
    // backend for this computer, such as a Mac today) share one text that covers both.
    default: return t('midnight.prover.cpuOnlyHint');
  }
});

/** The newest transaction Gero Prover proved (its rows carry the processor). */
const lastProof = computed(() => midnightStore.provingHistory.find((entry) => entry.success && entry.processor));

const filesMegabytes = computed(() => Math.round((status.value?.keys.bytes ?? 0) / 1_000_000));

const problemTitle = computed(() => {
  if (view.value === 'wrongVersion') return t('midnight.prover.wrongVersionTitle');
  return view.value === 'forbidden' ? t('midnight.prover.forbiddenTitle') : t('midnight.prover.notConnectedTitle');
});
const problemBody = computed(() => {
  if (view.value === 'wrongVersion') {
    const version = snapshot.value?.version;
    return version ? t('midnight.prover.wrongVersionBody', { version }) : t('midnight.prover.wrongVersionBodyUnknown');
  }
  return view.value === 'forbidden' ? t('midnight.prover.forbiddenBody') : t('midnight.prover.notConnectedBody');
});

const testResultText = computed(() => {
  const result = testResult.value;
  if (!result) return '';
  if (result.ok === false) return t('midnight.prover.testFailed', { reason: t(result.copyKey) });
  return t(result.accelerated ? 'midnight.prover.testOkGpu' : 'midnight.prover.testOkCpu', { seconds: result.seconds });
});
</script>

<style scoped lang="scss">
.gp-card {
  @include g-glass-panel(false);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-sheet);
  padding: var(--g-s-5);
  margin-bottom: var(--g-s-4);
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
}

.gp-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--g-s-3);
}

.gp-head-text {
  flex: 1;
  min-width: 0;
}

.gp-sub {
  margin-top: var(--g-s-1);
  margin-bottom: 0;
}

/* Status pill: a justified solid control (the card carries the material). */
.gp-pill {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-2);
  padding: var(--g-s-1) var(--g-s-3);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-pill);
  color: var(--g-text-2);
}

.gp-pill--ok {
  color: var(--g-success);
  background: var(--g-success-fill);
  border-color: var(--g-success-line);
}

.gp-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}

/* ── Setup steps ── */

.gp-step {
  display: flex;
  gap: var(--g-s-3);
  padding-bottom: var(--g-s-4);
  border-bottom: 1px solid var(--g-hairline-1);
}

.gp-step--last {
  border-bottom: none;
  padding-bottom: 0;
}

.gp-step-badge {
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: var(--g-r-pill);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  color: var(--g-text-2);
}

.gp-step-badge--active {
  border-color: var(--g-accent);
  color: var(--g-accent);
}

.gp-step-badge--done {
  background: var(--g-success-fill);
  border-color: var(--g-success-line);
  color: var(--g-success);
}

.gp-step-body {
  flex: 1;
  min-width: 0;
}

.gp-step-hint {
  margin-top: var(--g-s-1);
  margin-bottom: 0;
}

.gp-step-action {
  margin-top: var(--g-s-3);
}

.gp-waiting {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-2);
  margin-top: var(--g-s-3);
  padding: var(--g-s-1) var(--g-s-3);
  border-radius: var(--g-r-control);
  background: var(--g-raised);
}

.gp-link {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-1);
  margin-top: var(--g-s-2);
  padding: 0;
  border: none;
  background: none;
  color: var(--g-accent);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
}

.gp-link:hover {
  text-decoration: underline;
}

/* ── Connected ── */

.gp-tiles {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--g-s-3);
}

@media (max-width: 620px) {
  .gp-tiles { grid-template-columns: 1fr; }
}

.gp-tile {
  @include g-glass-tier(false);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
  padding: var(--g-s-4);
  min-width: 0;
}

.gp-tile-value {
  margin-top: var(--g-s-1);
}

.gp-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--g-s-4);
  padding-top: var(--g-s-4);
  border-top: 1px solid var(--g-hairline-1);
}

.gp-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
  padding-top: var(--g-s-4);
  border-top: 1px solid var(--g-hairline-1);
}

.gp-foot .gp-link {
  margin-top: 0;
}

.gp-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--g-s-3);
}

.gp-actions .gp-link {
  margin-top: 0;
}

.gp-actions--end {
  justify-content: flex-end;
}

.gp-note-title {
  color: inherit;
}

.gp-test {
  margin: 0;
  color: var(--g-success);
}

.gp-test--failed {
  color: var(--g-error);
}
</style>
