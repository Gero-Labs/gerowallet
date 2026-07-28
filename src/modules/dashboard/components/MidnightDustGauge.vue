<template>
  <div class="dust-gauge glass-panel" :class="{ 'is-charging': isCharging, 'is-full': isFull }">
    <!-- Header: label + live balance -->
    <div class="dust-gauge__head">
      <div class="dust-gauge__title">
        <v-icon x-small class="mr-1" :color="isCharging || isFull ? '#ecc985' : undefined">
          {{ isCharging ? 'mdi-battery-charging-medium' : 'mdi-battery-50' }}
        </v-icon>
        {{ $t('midnight.dustBattery') }}
        <button v-if="!isRegistered && !isPending" type="button" class="dust-gauge__cta ml-3" @click="$emit('register')">
          <v-icon x-small left>mdi-shield-star</v-icon>
          {{ $t('midnight.registerForDust') }}
        </button>
        <span v-else-if="isPending" class="dust-gauge__pending ml-3">
          <span class="dust-gauge__pending-dot"></span>
          {{ $t('midnight.dustBatteryPending') }}
        </span>
      </div>
      <div class="dust-gauge__balance">
        <v-skeleton-loader v-if="midnightLoading" type="text" width="110" />
        <template v-else>
          <span class="dust-gauge__balance-num">{{ dustCurrentFmt }}</span>
          <span class="dust-gauge__balance-unit">{{ dustCurrency }}</span>
        </template>
      </div>
    </div>

    <!-- Battery track: gradient fill + flowing dust particles -->
    <div class="battery" role="progressbar" :aria-valuenow="pct" aria-valuemin="0" aria-valuemax="100">
      <div class="battery__cells">
        <div
          class="battery__fill"
          :style="{ width: pct + '%' }"
        />
        <!-- Dividers: sand (same family as the dust motes) over the empty
             track, darker once the fill has passed them. -->
        <div
          v-for="n in 11"
          :key="n"
          class="battery__divider"
          :class="{ 'battery__divider--covered': (n * 100 / 12) <= pct }"
          :style="{ left: (n * 100 / 12) + '%' }"
        />
        <!-- Two-zone charge animation: dust drifts right-to-left over the
             empty track and lands on the fill edge; power streaks flow
             through the charged section. See DustParticleCanvas. -->
        <DustParticleCanvas :active="isCharging" :fill-pct="pct" class="battery__dust" />
      </div>
      <div class="battery__nub" />
    </div>

    <!-- Footer stats -->
    <div class="dust-gauge__stats">
      <div class="dust-gauge__stat">
        <span class="k">{{ statusLabel }}</span>
        <span class="v" :class="statusClass">{{ pctLabel }}</span>
      </div>
      <div class="dust-gauge__stat">
        <span class="k">{{ $t('midnight.generationRate') }}</span>
        <span class="v">{{ isRegistered ? `+${dustRateFmt} ${dustCurrency}/s` : '—' }}</span>
      </div>
      <div class="dust-gauge__stat">
        <span class="k">{{ isFull ? $t('midnight.dustCapReached') : $t('midnight.dustTimeToFull') }}</span>
        <span class="v">{{ timeToFullLabel }}</span>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, toRefs, watch } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { midnightStore } from '@/stores/midnightStore';
import { getDustPendingForDestination } from '@/shared/composables/useDustPending';
import { walletStore } from '@/stores/walletStore';
import { Network } from '@/models/types';
import { MIDNIGHT_DECIMALS } from '@/chains/midnight/midnightTypes';
import { useMidnightDustLive } from '@/shared/composables/useMidnightDustLive';
import DustParticleCanvas from '@/shared/components/DustParticleCanvas.vue';
import { useMidnightLoading } from '@/shared/composables/useMidnightLoading';

defineEmits<{ (e: 'register'): void }>();

const { t } = useTranslation();
const { loggedWallet } = toRefs(walletStore);

const isMainnet = computed(() => loggedWallet.value?.network === Network.MAINNET);
const dustCurrency = computed(() => (isMainnet.value ? 'DUST' : 'tDUST'));

const DUST_DIVISOR = 10n ** BigInt(MIDNIGHT_DECIMALS.DUST);

const {
  dustBalance,
  dustGenerating,
  dustCap,
  registrationStatus,
} = useMidnightDustLive();

const midnightLoading = useMidnightLoading();
const isRegistered = computed(() => registrationStatus.value === 'Registered');

// Pending: a cNIGHT registration was submitted that targets this wallet's DUST
// address but hasn't relayed to Midnight yet (~2.5h), so dustState still reads
// unregistered. Surface it so the battery shows "pending" instead of a
// re-registration prompt. localStorage isn't reactive, so refresh on mount and
// whenever the live status changes.
const incomingPending = ref(0);
function refreshPending() {
  const dust = midnightStore.addresses?.dust ?? '';
  incomingPending.value = dust ? getDustPendingForDestination(dust).length : 0;
}
onMounted(refreshPending);
watch(registrationStatus, refreshPending);
const isPending = computed(() => !isRegistered.value
  && (incomingPending.value > 0 || registrationStatus.value === 'Pending'));

// Percent full (0-100) for the bar width + a11y.
const pct = computed(() => {
  if (dustCap.value <= 0n) return 0;
  const p = Number((dustBalance.value * 10000n) / dustCap.value) / 100;
  return Math.max(0, Math.min(100, p));
});
const isFull = computed(() => isRegistered.value && dustCap.value > 0n && pct.value >= 99.95);
const isCharging = computed(() => isRegistered.value && dustGenerating.value > 0n && !isFull.value);

function fmt(value: bigint, digits: number): string {
  const whole = value / DUST_DIVISOR;
  const frac = value % DUST_DIVISOR;
  const fracStr = frac.toString().padStart(MIDNIGHT_DECIMALS.DUST, '0').slice(0, digits);
  return digits > 0 ? `${whole.toString()}.${fracStr}` : whole.toString();
}

const dustCurrentFmt = computed(() => fmt(dustBalance.value, 4));
const dustRateFmt = computed(() => fmt(dustGenerating.value, 4));

const pctLabel = computed(() => `${pct.value.toFixed(1)}%`);
const statusLabel = computed(() => (isFull.value ? t('midnight.dustFull') : t('midnight.dustCharge')));
const statusClass = computed(() => (isFull.value ? 'v--full' : isCharging.value ? 'v--charging' : ''));

// Seconds to reach cap at the current rate → coarse human label.
const timeToFullLabel = computed(() => {
  if (isFull.value) return t('midnight.dustFullyCharged');
  if (!isRegistered.value || dustGenerating.value <= 0n) return '—';
  const remaining = dustCap.value - dustBalance.value;
  if (remaining <= 0n) return t('midnight.dustFullyCharged');
  const secs = Number(remaining / dustGenerating.value);
  if (!Number.isFinite(secs) || secs <= 0) return '—';
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `~${d}d ${h}h`;
  if (h > 0) return `~${h}h ${m}m`;
  if (m > 0) return `~${m}m`;
  return `~${Math.floor(secs)}s`;
});

</script>

<style scoped>
/* Standard wallet panel — the gradient lives on the progress bar, not here. */
.dust-gauge {
  padding: 14px 16px;
  border-radius: var(--g-r-card);
  display: flex;
  flex-direction: column;
  gap: 12px;
  /* Fill the equal-height row column so it matches the proof-server widget
     beside it (which already sets height: 100%). */
  height: 100%;
}

.dust-gauge__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.dust-gauge__title {
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--g-text-3);
  display: flex;
  align-items: center;
}

.dust-gauge__balance {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.dust-gauge__balance-num {
  font-family: var(--g-font-mono);
  font-size: 16px;
  font-weight: 600;
  color: var(--g-text-1);
  font-variant-numeric: tabular-nums;
}

.is-charging .dust-gauge__balance-num,
.is-full .dust-gauge__balance-num {
  color: #f3ddae;
  text-shadow: 0 0 14px rgba(236, 201, 133, 0.35);
}

.dust-gauge__balance-unit {
  font-size: 11px;
  color: var(--g-text-3);
}

/* Battery track */
.battery {
  display: flex;
  align-items: stretch;
  gap: 3px;
  height: 22px;
}

.battery__cells {
  position: relative;
  flex: 1;
  border-radius: 6px;
  background: rgba(2, 6, 18, 0.55);
  border: 1px solid rgba(236, 201, 133, 0.12);
  overflow: hidden;
}

/* Fill: the dark-blue → sand gradient lives HERE. No tip effects. */
.battery__fill {
  position: absolute;
  inset: 0 auto 0 0;
  height: 100%;
  border-radius: 5px 0 0 5px;
  background: linear-gradient(90deg, #2E1065 0%, #7C3AED 45%, #C4A7FC 72%, #ecc985 100%);
  transition: width 0.9s cubic-bezier(0.22, 1, 0.36, 1);
}

.is-full .battery__fill {
  border-radius: 5px;
  background: linear-gradient(90deg, #2E1065 0%, #9D7BEA 55%, #ffe9b2 100%);
}

/* Dividers: sand (matches the dust motes) over the empty track; once the
   fill passes a divider it flips to a dark notch so the gradient reads. */
.battery__divider {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: rgba(236, 201, 133, 0.45);
  transition: background 0.4s ease;
}

.battery__divider--covered {
  background: rgba(0, 0, 0, 0.38);
}

/* The dust itself — canvas sits above fill + dividers */
.battery__dust {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.battery__nub {
  width: 3px;
  align-self: center;
  height: 10px;
  border-radius: 0 2px 2px 0;
  background: rgba(236, 201, 133, 0.35);
}

.dust-gauge__stats {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  /* Pin to the card bottom so this row aligns with the proof-server widget's
     stats row when the card is stretched to equal height. */
  margin-top: auto;
}

.dust-gauge__stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.dust-gauge__stat .k {
  font-size: 11px;
  color: var(--g-text-3);
  white-space: nowrap;
}

.dust-gauge__stat .v {
  font-family: var(--g-font-mono);
  font-size: 12px;
  font-weight: 500;
  color: var(--g-text-1);
  white-space: nowrap;
}

.dust-gauge__stat .v--charging { color: #ecc985; }
.dust-gauge__stat .v--full { color: #ffe9b2; }

.dust-gauge__cta {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--g-on-grad);
  background: linear-gradient(90deg, var(--g-grad-1), var(--g-grad-2));
  cursor: pointer;
  transition: filter 0.15s ease, transform 0.1s ease;
}

.dust-gauge__cta:hover { filter: brightness(1.08); }
.dust-gauge__cta:active { transform: translateY(1px); }

.dust-gauge__pending {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--g-text-1);
  background: var(--g-warning-fill);
  border: 1px solid var(--g-warning-line);
}

.dust-gauge__pending-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--g-warning);
  flex-shrink: 0;
}

@media (prefers-reduced-motion: reduce) {
  .battery__fill { transition: none; }
  .battery__divider { transition: none; }
}
</style>
