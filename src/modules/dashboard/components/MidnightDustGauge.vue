<template>
  <div class="dust-gauge liquid-glass" :class="{ 'is-charging': isCharging }">
    <!-- Header: label + live balance -->
    <div class="dust-gauge__head">
      <div class="dust-gauge__title">
        <v-icon x-small class="mr-1" :color="isCharging ? 'cyan' : undefined">
          {{ isCharging ? 'mdi-battery-charging-medium' : 'mdi-battery-50' }}
        </v-icon>
        {{ $t('midnight.dustBattery') }}
      </div>
      <div class="dust-gauge__balance">
        <span class="dust-gauge__balance-num">{{ dustCurrentFmt }}</span>
        <span class="dust-gauge__balance-unit">{{ dustCurrency }}</span>
      </div>
    </div>

    <!-- Segmented battery -->
    <div class="battery" role="progressbar" :aria-valuenow="pct" aria-valuemin="0" aria-valuemax="100">
      <div class="battery__cells">
        <div
          class="battery__fill"
          :class="{ 'battery__fill--full': pct >= 100 }"
          :style="{ width: pct + '%' }"
        >
          <div v-if="isCharging" class="battery__shimmer" />
        </div>
        <!-- cell dividers over the track -->
        <div v-for="n in 11" :key="n" class="battery__divider" :style="{ left: (n * 100 / 12) + '%' }" />
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

    <!-- Unregistered CTA -->
    <button v-if="!isRegistered" type="button" class="dust-gauge__cta" @click="$emit('register')">
      <v-icon x-small left>mdi-shield-star</v-icon>
      {{ $t('midnight.registerForDust') }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, toRefs } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { walletStore } from '@/stores/walletStore';
import { Network } from '@/models/types';
import { MIDNIGHT_DECIMALS } from '@/chains/midnight/midnightTypes';
import { useMidnightDustLive } from '@/shared/composables/useMidnightDustLive';

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

const isRegistered = computed(() => registrationStatus.value === 'Registered');
const isCharging = computed(() => isRegistered.value && dustGenerating.value > 0n && !isFull.value);

// Percent full (0-100), integer for the bar width + a11y.
const pct = computed(() => {
  if (dustCap.value <= 0n) return 0;
  const p = Number((dustBalance.value * 10000n) / dustCap.value) / 100;
  return Math.max(0, Math.min(100, p));
});
const isFull = computed(() => isRegistered.value && dustCap.value > 0n && pct.value >= 99.95);

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
.dust-gauge {
  padding: 14px 16px;
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
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
  color: rgba(255, 255, 255, 0.55);
  display: flex;
  align-items: center;
}

.dust-gauge__balance {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.dust-gauge__balance-num {
  font-family: 'Roboto Mono', monospace;
  font-size: 18px;
  font-weight: 600;
  color: #ffffff;
  font-variant-numeric: tabular-nums;
}

.dust-gauge__balance-unit {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
}

/* Segmented battery track */
.battery {
  display: flex;
  align-items: stretch;
  gap: 3px;
  height: 20px;
}

.battery__cells {
  position: relative;
  flex: 1;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.28);
  border: 1px solid rgba(255, 255, 255, 0.09);
  overflow: hidden;
}

.battery__fill {
  position: absolute;
  inset: 0 auto 0 0;
  height: 100%;
  border-radius: 5px 0 0 5px;
  background: linear-gradient(90deg, #22d3ee 0%, #38bdf8 100%);
  box-shadow: 0 0 12px rgba(34, 211, 238, 0.45);
  transition: width 0.9s cubic-bezier(0.22, 1, 0.36, 1);
}

.battery__fill--full {
  border-radius: 5px;
  background: linear-gradient(90deg, #34d399 0%, #22d3ee 100%);
  box-shadow: 0 0 14px rgba(52, 211, 153, 0.5);
}

/* Charging shimmer sweep */
.battery__shimmer {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    100deg,
    transparent 20%,
    rgba(255, 255, 255, 0.45) 50%,
    transparent 80%
  );
  transform: translateX(-100%);
  animation: dust-sweep 1.8s ease-in-out infinite;
}

.battery__divider {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: rgba(0, 0, 0, 0.35);
}

.battery__nub {
  width: 3px;
  align-self: center;
  height: 9px;
  border-radius: 0 2px 2px 0;
  background: rgba(255, 255, 255, 0.22);
}

.dust-gauge__stats {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.dust-gauge__stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.dust-gauge__stat .k {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
  white-space: nowrap;
}

.dust-gauge__stat .v {
  font-family: 'Roboto Mono', monospace;
  font-size: 12px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.85);
  white-space: nowrap;
}

.dust-gauge__stat .v--charging { color: #38bdf8; }
.dust-gauge__stat .v--full { color: #34d399; }

.dust-gauge__cta {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  padding: 5px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  color: #0b1220;
  background: linear-gradient(90deg, #22d3ee 0%, #38bdf8 100%);
  cursor: pointer;
  transition: filter 0.15s ease, transform 0.1s ease;
}

.dust-gauge__cta:hover { filter: brightness(1.08); }
.dust-gauge__cta:active { transform: translateY(1px); }

@keyframes dust-sweep {
  0% { transform: translateX(-100%); }
  60%, 100% { transform: translateX(220%); }
}

@media (prefers-reduced-motion: reduce) {
  .battery__shimmer { animation: none; opacity: 0.35; }
  .battery__fill { transition: none; }
}
</style>
