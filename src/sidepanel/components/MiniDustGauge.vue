<template>
  <!-- Compact DUST battery for mini-Gero — same data + visual language as the
       dashboard's MidnightDustGauge (gradient fill, sand dividers, living
       dust), shrunk to a single row + slim bar. -->
  <v-card flat class="liquid-glass mini-dust" :class="{ 'is-charging': isCharging, 'is-full': isFull }">
    <div class="mini-dust__row">
      <span class="mini-dust__label">
        <v-icon x-small class="mr-1" :color="isCharging || isFull ? '#ecc985' : '#888'">
          {{ isCharging ? 'mdi-battery-charging-medium' : 'mdi-battery-50' }}
        </v-icon>
        {{ $t('midnight.dustBattery') }}
      </span>
      <span class="mini-dust__value">
        <template v-if="!hideBalances">{{ dustFmt }} {{ dustTicker }}</template>
        <template v-else>••••</template>
        <span class="mini-dust__pct"> · {{ pct.toFixed(1) }}%</span>
      </span>
    </div>
    <div class="mini-dust__bar" role="progressbar" :aria-valuenow="pct" aria-valuemin="0" aria-valuemax="100">
      <div class="mini-dust__fill" :style="{ width: pct + '%' }" />
      <div
        v-for="n in 7"
        :key="n"
        class="mini-dust__divider"
        :class="{ 'mini-dust__divider--covered': (n * 100 / 8) <= pct }"
        :style="{ left: (n * 100 / 8) + '%' }"
      />
      <DustParticleCanvas :active="isCharging" :fill-pct="pct" />
    </div>
    <div class="mini-dust__sub">
      <span v-if="isRegistered">+{{ rateFmt }} {{ dustTicker }}/s</span>
      <span v-else-if="isPending" class="mini-dust__pending">{{ $t('midnight.dustBatteryPending') }}</span>
      <span v-else>{{ $t('midnight.statusUnregistered') }}</span>
      <span v-if="isCharging"> · {{ timeToFullLabel }}</span>
    </div>
  </v-card>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, toRefs, watch } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { midnightStore } from '@/stores/midnightStore';
import { Network } from '@/models/types';
import { MIDNIGHT_DECIMALS } from '@/chains/midnight/midnightTypes';
import { getMidnightApi } from '@/api/midnight-api';
import { useMidnightDustLive } from '@/shared/composables/useMidnightDustLive';
import { useDustPathB } from '@/shared/composables/useDustPathB';
import { getDustPendingForDestination, reconcileDustPendingForDestination } from '@/shared/composables/useDustPending';
import { useTranslation } from '@/shared/composables/useTranslation';
import DustParticleCanvas from '@/shared/components/DustParticleCanvas.vue';
import { debugLog } from '@/utils/debug';

const { t } = useTranslation();
const { loggedWallet } = toRefs(walletStore);
const hideBalances = computed(() => walletStore.config?.hideBalances || false);

const isMainnet = computed(() => loggedWallet.value?.network === Network.MAINNET);
const dustTicker = computed(() => (isMainnet.value ? 'DUST' : 'tDUST'));

const DUST_DIVISOR = 10n ** BigInt(MIDNIGHT_DECIMALS.DUST);

const { dustBalance, dustGenerating, dustCap, registrationStatus } = useMidnightDustLive();
const { pathBRegistered, pathBStakes } = useDustPathB();

const isRegistered = computed(() => registrationStatus.value === 'Registered');

// Incoming cNIGHT registration pending (~2.5h relay, not yet in dustState).
// Reconcile against chain truth before recounting so a stale/failed
// submission can't sit as "pending" for the full TTL — same logic as the
// dashboard's MidnightDustGauge (this component is its sidepanel clone).
const incomingPending = ref(0);
// Same overlap guard as the dashboard's MidnightDustGauge (this component is
// its sidepanel clone) — onMounted + watch(registrationStatus) can fire
// close together on a Path-B wallet, and the two overlapping async calls
// would otherwise read-map/await/write-map out of order and flicker the pill.
let refreshPendingBusy = false;
async function refreshPending() {
  if (refreshPendingBusy) return;
  refreshPendingBusy = true;
  try {
    const dust = midnightStore.addresses?.dust ?? '';
    if (!dust) { incomingPending.value = 0; return; }
    const network = loggedWallet.value?.network;
    if (network) {
      await reconcileDustPendingForDestination(
        dust,
        (txHash) => getMidnightApi(network).cardanoTxExists(txHash),
        (stakeAddress) => pathBStakes.value.includes(stakeAddress),
      );
    }
    // The wallet may have switched while the reconcile above was in flight —
    // re-read rather than trust the `dust` captured at entry, so a stale
    // response can never overwrite the count for a DIFFERENT wallet.
    if ((midnightStore.addresses?.dust ?? '') !== dust) return;
    incomingPending.value = getDustPendingForDestination(dust).length;
  } finally {
    refreshPendingBusy = false;
  }
}
function safeRefreshPending() {
  // Neither onMounted nor watch() awaits or catches its callback's promise,
  // so an uncaught rejection here (e.g. a localStorage quota error) would
  // become an unhandled rejection.
  refreshPending().catch((e) => debugLog('[MiniDustGauge] refreshPending failed', e));
}
onMounted(safeRefreshPending);
watch(registrationStatus, safeRefreshPending);
// Path B already reporting a live registration to this dust address is
// Registered, not pending.
const isPending = computed(() => !isRegistered.value
  && !pathBRegistered.value
  && (incomingPending.value > 0 || registrationStatus.value === 'Pending'));
const pct = computed(() => {
  if (dustCap.value <= 0n) return 0;
  const p = Number((dustBalance.value * 10000n) / dustCap.value) / 100;
  return Math.max(0, Math.min(100, p));
});
const isFull = computed(() => isRegistered.value && dustCap.value > 0n && pct.value >= 99.95);
const isCharging = computed(() => isRegistered.value && dustGenerating.value > 0n && !isFull.value);

function fmt(value: bigint, digits: number): string {
  const whole = value / DUST_DIVISOR;
  const frac = (value % DUST_DIVISOR).toString().padStart(MIDNIGHT_DECIMALS.DUST, '0');
  return `${whole.toString()}.${frac.slice(0, digits)}`;
}

const dustFmt = computed(() => fmt(dustBalance.value, 4));
const rateFmt = computed(() => fmt(dustGenerating.value, 4));

const timeToFullLabel = computed(() => {
  if (!isCharging.value) return '';
  const remaining = dustCap.value - dustBalance.value;
  if (remaining <= 0n) return t('midnight.dustFullyCharged');
  const secs = Number(remaining / dustGenerating.value);
  if (!Number.isFinite(secs) || secs <= 0) return '';
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `~${d}d ${h}h`;
  if (h > 0) return `~${h}h ${m}m`;
  return `~${m}m`;
});
</script>

<style scoped>
/* Background/border/radius come from the global .liquid-glass card styles
   (sidepanel imports shared/styles/liquid-glass.css). */
.mini-dust {
  margin: 0 16px 12px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.mini-dust__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.mini-dust__label {
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.5);
  display: flex;
  align-items: center;
}

.mini-dust__value {
  font-family: 'Roboto Mono', monospace;
  font-size: 12px;
  font-weight: 600;
  color: #ffffff;
  font-variant-numeric: tabular-nums;
}

.is-charging .mini-dust__value,
.is-full .mini-dust__value {
  color: #f3ddae;
}

.mini-dust__pct {
  color: rgba(255, 255, 255, 0.45);
  font-weight: 500;
}

.mini-dust__bar {
  position: relative;
  height: 12px;
  border-radius: 5px;
  background: rgba(2, 6, 18, 0.55);
  border: 1px solid rgba(236, 201, 133, 0.12);
  overflow: hidden;
}

.mini-dust__fill {
  position: absolute;
  inset: 0 auto 0 0;
  height: 100%;
  border-radius: 4px 0 0 4px;
  background: linear-gradient(90deg, #2E1065 0%, #7C3AED 45%, #C4A7FC 72%, #ecc985 100%);
  transition: width 0.9s cubic-bezier(0.22, 1, 0.36, 1);
}

.is-full .mini-dust__fill {
  border-radius: 4px;
  background: linear-gradient(90deg, #2E1065 0%, #9D7BEA 55%, #ffe9b2 100%);
}

.mini-dust__divider {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: rgba(236, 201, 133, 0.45);
  transition: background 0.4s ease;
}

.mini-dust__divider--covered {
  background: rgba(0, 0, 0, 0.38);
}

.mini-dust__sub {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.45);
  font-family: 'Roboto Mono', monospace;
}

.mini-dust__pending {
  color: var(--g-warning);
}

@media (prefers-reduced-motion: reduce) {
  .mini-dust__fill { transition: none; }
  .mini-dust__divider { transition: none; }
}
</style>
