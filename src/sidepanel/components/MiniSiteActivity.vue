<template>
  <!-- What a connected site's transaction is doing inside the wallet. Same
       glass-card anatomy as mini-dust / mini-ps. Appears with the site's first
       proof request and leaves 60 s after Submit or a failure (the visibility
       rule lives in midnightSiteActivity.ts). -->
  <v-card v-if="visible && activity" flat class="glass-liquid mini-act" role="status">
    <div class="mini-act__row">
      <span class="mini-act__label t-label">
        <v-icon x-small class="mr-1" color="var(--g-text-3)">mdi-web</v-icon>
        {{ domain }}
      </span>
      <span class="mini-act__state" :class="stateClass">
        <v-icon v-if="stateIcon" size="11" class="mr-1">{{ stateIcon }}</v-icon>
        <span :class="{ 'g-mono g-num': activity.step === 'proving' }">{{ stateText }}</span>
      </span>
    </div>

    <div class="mini-act__steps">
      <template v-for="(step, i) in steps">
        <span :key="step.key" class="mini-act__step" :class="stepClass(i)">
          <v-icon v-if="i < doneCount" size="12" class="mini-act__check">mdi-check</v-icon>
          <span v-else class="mini-act__dot" />
          {{ step.label }}
        </span>
        <span v-if="i < steps.length - 1" :key="`${step.key}-line`" class="mini-act__line" />
      </template>
    </div>

    <div v-if="activity.step === 'proving' && !proofsDone" class="mini-act__bar" aria-hidden="true">
      <div class="mini-act__sweep" />
    </div>

    <div class="mini-act__sub">
      <span :class="{ 'mini-act__sub--error': activity.step === 'failed' }">{{ statusText }}</span>
      <button v-if="showSettings" type="button" class="mini-act__link" @click="openProofServer">
        {{ t('midnight.proofServer.openSettings') }}
        <v-icon size="11">mdi-chevron-right</v-icon>
      </button>
      <a v-else-if="explorerUrl" class="mini-act__link" :href="explorerUrl" target="_blank" rel="noopener">
        {{ t('midnight.siteActivity.view') }}
        <v-icon size="11">mdi-chevron-right</v-icon>
      </a>
    </div>
  </v-card>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { midnightStore } from '@/stores/midnightStore';
import { walletStore } from '@/stores/walletStore';
import { isSiteActivityVisible } from '@/chains/midnight/midnightSiteActivity';
import { getMidnightEndpoints } from '@/chains/midnight/midnightConfig';
import { useTranslation } from '@/shared/composables/useTranslation';

const { t } = useTranslation();

// A 1 s clock: drives the elapsed time while proving and the card's
// visibility windows (in-flight goes stale, finished lingers briefly).
const now = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | undefined;
onMounted(() => { ticker = setInterval(() => { now.value = Date.now(); }, 1000); });
onBeforeUnmount(() => { if (ticker) clearInterval(ticker); });

const activity = computed(() => midnightStore.siteActivity);
const visible = computed(() => isSiteActivityVisible(activity.value, now.value));

const domain = computed(() => {
  const origin = activity.value?.origin ?? '';
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
});

const network = computed(() => walletStore.loggedWallet?.network ?? '');

// Every proof the site asked for has come back, and the site has not made its
// next call yet: the wallet is waiting on the site, and the card says so
// rather than pretending a proof is still running.
const proofsDone = computed(() => {
  const a = activity.value;
  return !!a && a.step === 'proving' && a.circuitsStarted > 0 && a.circuitsDone >= a.circuitsStarted;
});
const elapsedSeconds = computed(() => Math.max(0, Math.floor((now.value - (activity.value?.startedAt ?? now.value)) / 1000)));

const steps = computed(() => [
  { key: 'prove', label: t('midnight.siteActivity.stepProve') },
  { key: 'fund', label: t('midnight.siteActivity.stepFund') },
  { key: 'submit', label: t('midnight.siteActivity.stepSubmit') },
]);

// Stepper state: how many steps are complete, which one is in progress (-1:
// none — every proof is back and the wallet is waiting for the site, or the
// transaction is finished), and where a failure happened.
const stepper = computed(() => {
  const a = activity.value;
  if (!a) return { done: 0, active: 0, failed: -1 };
  switch (a.step) {
    case 'proving': return proofsDone.value ? { done: 1, active: -1, failed: -1 } : { done: 0, active: 0, failed: -1 };
    case 'funding': return { done: 1, active: 1, failed: -1 };
    case 'submitting': return { done: 2, active: 2, failed: -1 };
    case 'submitted': return { done: 3, active: -1, failed: -1 };
    case 'failed': {
      const at = { proving: 0, funding: 1, submitting: 2 }[a.failedAt ?? 'proving'];
      return { done: at, active: -1, failed: at };
    }
    default: return { done: 0, active: 0, failed: -1 };
  }
});
const doneCount = computed(() => stepper.value.done);

function stepClass(i: number) {
  return {
    'mini-act__step--done': i < stepper.value.done,
    'mini-act__step--active': i === stepper.value.active,
    'mini-act__step--failed': i === stepper.value.failed,
  };
}

const stateText = computed(() => {
  switch (activity.value?.step) {
    case 'proving': return `${elapsedSeconds.value} s`;
    case 'funding': return t('midnight.siteActivity.waitingForYou');
    case 'submitting': return t('midnight.siteActivity.submittingShort');
    case 'submitted': return t('midnight.siteActivity.done');
    case 'failed': return t('midnight.siteActivity.failed');
    default: return '';
  }
});
const stateIcon = computed(() => {
  switch (activity.value?.step) {
    case 'submitted': return 'mdi-check';
    case 'failed': return 'mdi-alert-circle-outline';
    default: return '';
  }
});
const stateClass = computed(() => ({
  'mini-act__state--waiting': activity.value?.step === 'funding',
  'mini-act__state--done': activity.value?.step === 'submitted',
  'mini-act__state--failed': activity.value?.step === 'failed',
}));

const statusText = computed(() => {
  const a = activity.value;
  if (!a) return '';
  switch (a.step) {
    case 'proving':
      if (proofsDone.value) return t('midnight.siteActivity.proofsDone', { n: a.circuitsDone });
      return t(midnightStore.proofServer.mode === 'zkpaas' ? 'midnight.siteActivity.provingZkpaas' : 'midnight.siteActivity.provingLocal',
        { n: Math.max(1, a.circuitsStarted) });
    case 'funding':
      return t('midnight.siteActivity.funding');
    case 'submitting':
      return t('midnight.siteActivity.submitting', { network: network.value });
    case 'submitted':
      return a.txId
        ? t('midnight.siteActivity.submittedWithId', { network: network.value, txId: `${a.txId.slice(0, 6)}…${a.txId.slice(-4)}` })
        : t('midnight.siteActivity.submitted', { network: network.value });
    case 'failed':
      if (a.reason === 'proof-server') return t('midnight.siteActivity.failedProofServer');
      if (a.reason === 'declined') return t('midnight.siteActivity.failedDeclined');
      return t('midnight.siteActivity.failedOther');
    default:
      return '';
  }
});

const showSettings = computed(() => activity.value?.step === 'failed' && activity.value.reason === 'proof-server');
const explorerUrl = computed(() => (
  activity.value?.step === 'submitted' && activity.value.txId
    ? getMidnightEndpoints(network.value)?.blockExplorerUrl ?? ''
    : ''
));

function openProofServer() {
  window.open(chrome.runtime.getURL('index.html#/proof-server'), '_blank');
}
</script>

<style scoped>
.mini-act {
  margin: 0 16px 12px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.mini-act__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.mini-act__label {
  display: flex;
  align-items: center;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mini-act__state {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 600;
  color: var(--g-text-3);
}

.mini-act__state--waiting { color: var(--g-warning); }
.mini-act__state--done { color: var(--g-success); }
.mini-act__state--failed { color: var(--g-error); }

.mini-act__steps {
  display: flex;
  align-items: center;
}

.mini-act__step {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  color: var(--g-text-3);
}

.mini-act__step--done { color: var(--g-text-2); }
.mini-act__step--active { color: var(--g-accent); }
.mini-act__step--failed { color: var(--g-error); }

.mini-act__dot {
  width: 6px;
  height: 6px;
  border-radius: var(--g-r-pill);
  background: var(--g-hairline-3);
}

.mini-act__step--active .mini-act__dot { background: var(--g-accent); }
.mini-act__step--failed .mini-act__dot { background: var(--g-error); }

.mini-act__check { color: var(--g-text-2); }

.mini-act__line {
  flex: 1;
  height: 1px;
  margin: 0 8px;
  background: var(--g-hairline-2);
}

/* Proof servers do not stream progress: an indeterminate sweep plus the
   elapsed time in the header is the honest signal. */
.mini-act__bar {
  position: relative;
  height: 3px;
  border-radius: var(--g-r-pill);
  background: var(--g-hairline-2);
  overflow: hidden;
}

.mini-act__sweep {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 34%;
  border-radius: var(--g-r-pill);
  background: var(--g-accent);
  animation: mini-act-sweep 1.4s linear infinite;
}

@keyframes mini-act-sweep {
  from { transform: translateX(-120%); }
  to { transform: translateX(320%); }
}

@media (prefers-reduced-motion: reduce) {
  .mini-act__sweep {
    animation: none;
    width: 100%;
  }
}

.mini-act__sub {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 10px;
  line-height: 14px;
  color: var(--g-text-3);
}

.mini-act__sub--error { color: var(--g-error); }

.mini-act__link {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 600;
  color: var(--g-accent);
  background: transparent;
  text-decoration: none;
}

.mini-act__link:hover { color: var(--g-text-1); }
</style>
