<template>
  <div class="bp-card" data-testid="browser-prover-card">
    <!-- "In this browser": every proof of a send is made by the prover inside
         the extension, on several processor threads when this browser can run
         them (midnightZkirThreads.ts). Shown while the
         isMidnightThreadedProvingEnabled flag is on and the user chose it. -->
    <div class="bp-head">
      <div class="bp-head-text">
        <h2 class="t-heading">{{ t('midnight.prover.engineBrowser') }}</h2>
        <p class="t-body-sm bp-sub">{{ t('midnight.prover.browserCardBody') }}</p>
      </div>
      <div class="bp-pill t-caption" role="status">
        <span class="bp-dot" aria-hidden="true"></span>
        <span>{{ t('midnight.prover.browserReady') }}</span>
      </div>
    </div>

    <div class="bp-tiles">
      <div class="bp-tile" data-testid="browser-prover-threads">
        <div class="t-label">{{ t('midnight.prover.provingOn') }}</div>
        <div class="t-body-lg bp-tile-value">
          {{ threads > 1 ? t('midnight.prover.browserThreads', { n: threads }) : t('midnight.prover.browserOneThread') }}
        </div>
        <div class="t-caption">{{ threadsHint }}</div>
      </div>
      <div class="bp-tile">
        <div class="t-label">{{ t('midnight.prover.browserPrivate') }}</div>
        <div class="t-body-lg bp-tile-value">{{ t('midnight.prover.browserPrivateValue') }}</div>
        <div class="t-caption">{{ t('midnight.prover.browserPrivateHint') }}</div>
      </div>
      <div class="bp-tile">
        <div class="t-label">{{ t('midnight.prover.provingFiles') }}</div>
        <div class="t-body-lg bp-tile-value g-num">{{ t('midnight.prover.megabytes', { n: bundledMegabytes }) }}</div>
        <div class="t-caption">{{ t('midnight.prover.browserFilesHint', { n: hostedMegabytes }) }}</div>
      </div>
    </div>

    <div class="bp-foot">
      <span class="t-caption">{{ t('midnight.prover.browserFooter') }}</span>
      <GButton tier="secondary" compact :loading="testing" data-testid="browser-prover-test" @click="runTest()">
        {{ t('midnight.prover.runTest') }}
      </GButton>
    </div>
    <p v-if="testText" class="t-caption bp-test" :class="{ 'bp-test--failed': testFailed }" role="status" data-testid="browser-prover-test-result">
      {{ testText }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import GButton from '@/shared/components/GButton/GButton.vue';
import { askBrowserSelfTest, type BrowserSelfTest } from '@/chains/midnight/geroProverState';
import { threadedProvingPlan } from '@/chains/midnight/midnightZkirThreads';
import { allowedMidnightZkCircuits, midnightZkFilesFor } from '@/chains/midnight/midnightZkKeys';

const { t } = useTranslation();

/** What can be known without proving: the threads this browser would use, or why one. */
const plan = threadedProvingPlan(globalThis.navigator?.hardwareConcurrency);
const lastTest = ref<BrowserSelfTest | null>(null);
const testing = ref(false);
const testFailed = ref(false);

/** The last test proof says what really ran; before one, the plan. */
const threads = computed(() => lastTest.value?.threads ?? plan.threads);

const UNAVAILABLE_COPY: Record<string, string> = {
  'not-shipped': 'midnight.prover.browserUnavailableNotShipped',
  'no-shared-memory': 'midnight.prover.browserUnavailableBrowser',
  'single-core': 'midnight.prover.browserUnavailableBrowser',
  'package-invalid': 'midnight.prover.browserUnavailableFailed',
  'failed-to-start': 'midnight.prover.browserUnavailableFailed',
};

const threadsHint = computed(() => {
  if (threads.value > 1) return t('midnight.prover.browserThreadsHint');
  const reason = lastTest.value?.threadsUnavailable ?? ('reason' in plan ? plan.reason : undefined);
  return t((reason && UNAVAILABLE_COPY[reason]) || 'midnight.prover.browserUnavailableFailed');
});

const megabytes = (source: 'bundled' | 'hosted') => Math.round(
  midnightZkFilesFor(allowedMidnightZkCircuits(true)).filter((f) => f.source === source).reduce((sum, f) => sum + f.bytes, 0) / 1_000_000,
);
const bundledMegabytes = megabytes('bundled');
const hostedMegabytes = megabytes('hosted');

const testText = computed(() => {
  if (testFailed.value) return t('midnight.prover.browserTestFailed');
  const test = lastTest.value;
  if (!test) return '';
  const seconds = (test.proveMs / 1000).toFixed(1);
  return test.threads > 1
    ? t('midnight.prover.browserTestOk', { seconds, n: test.threads })
    : t('midnight.prover.browserTestOkOne', { seconds });
});

async function runTest() {
  testing.value = true;
  testFailed.value = false;
  try {
    lastTest.value = await askBrowserSelfTest(true);
  } catch {
    testFailed.value = true;
  } finally {
    testing.value = false;
  }
}
</script>

<style scoped lang="scss">
.bp-card {
  @include g-glass-panel(false);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-sheet);
  padding: var(--g-s-5);
  margin-bottom: var(--g-s-4);
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
}

.bp-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--g-s-3);
}

.bp-head-text {
  flex: 1;
  min-width: 0;
}

.bp-sub {
  margin-top: var(--g-s-1);
  margin-bottom: 0;
}

/* Status pill: a justified solid control (the card carries the material). */
.bp-pill {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-2);
  padding: var(--g-s-1) var(--g-s-3);
  border: 1px solid var(--g-success-line);
  border-radius: var(--g-r-pill);
  color: var(--g-success);
  background: var(--g-success-fill);
}

.bp-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}

.bp-tiles {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--g-s-3);
}

@media (max-width: 620px) {
  .bp-tiles { grid-template-columns: 1fr; }
}

.bp-tile {
  @include g-glass-tier(false);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
  padding: var(--g-s-4);
  min-width: 0;
}

.bp-tile-value {
  margin-top: var(--g-s-1);
}

.bp-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
  padding-top: var(--g-s-4);
  border-top: 1px solid var(--g-hairline-1);
}

.bp-test {
  margin: 0;
  color: var(--g-success);
}

.bp-test--failed {
  color: var(--g-error);
}
</style>
