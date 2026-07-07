<template>
  <div class="dust-gauge" :class="{ 'is-charging': isCharging, 'is-full': isFull }">
    <!-- Header: label + live balance -->
    <div class="dust-gauge__head">
      <div class="dust-gauge__title">
        <v-icon x-small class="mr-1" :color="isCharging || isFull ? '#ecc985' : undefined">
          {{ isCharging ? 'mdi-battery-charging-medium' : 'mdi-battery-50' }}
        </v-icon>
        {{ $t('midnight.dustBattery') }}
      </div>
      <div class="dust-gauge__balance">
        <span class="dust-gauge__balance-num">{{ dustCurrentFmt }}</span>
        <span class="dust-gauge__balance-unit">{{ dustCurrency }}</span>
      </div>
    </div>

    <!-- Battery track: gradient fill + flowing dust particles -->
    <div class="battery" role="progressbar" :aria-valuenow="pct" aria-valuemin="0" aria-valuemax="100">
      <div class="battery__cells">
        <div
          class="battery__fill"
          :style="{ width: pct + '%' }"
        >
          <div v-if="isCharging" class="battery__shimmer" />
        </div>
        <div v-for="n in 11" :key="n" class="battery__divider" :style="{ left: (n * 100 / 12) + '%' }" />
        <!-- Dust particle field — drawn above fill + dividers, purely decorative -->
        <canvas ref="particleCanvas" class="battery__dust" aria-hidden="true" />
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
import { computed, onBeforeUnmount, onMounted, ref, toRefs, watch } from 'vue';
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

// ── Dust particle field ──────────────────────────────────────────────────────
// Literal dust drifting left → right across the battery track while charging.
// Tiny sand-colored specks with varied size/speed, gentle vertical wobble and
// opacity twinkle. Canvas is DPR-aware and resizes with the track; the rAF
// loop only runs while charging (and browsers pause rAF in hidden tabs).

interface DustMote {
  x: number;        // device px
  yBase: number;    // device px
  r: number;        // radius, device px
  speed: number;    // device px / s
  wobAmp: number;   // wobble amplitude, device px
  wobHz: number;    // wobble speed
  twinkleHz: number;
  phase: number;
  alpha: number;
  warm: number;     // 0..1 — lerp between pale sand and bright gold
}

const particleCanvas = ref<HTMLCanvasElement | null>(null);
let motes: DustMote[] = [];
let rafId = 0;
let lastTs = 0;
let resizeObserver: ResizeObserver | null = null;

const prefersReducedMotion = typeof window !== 'undefined'
  && !!window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function seedMotes(w: number, h: number): void {
  const dpr = window.devicePixelRatio || 1;
  const count = Math.max(24, Math.min(64, Math.round(w / (26 * dpr))));
  motes = Array.from({ length: count }, () => ({
    x: Math.random() * w,
    yBase: h * (0.15 + Math.random() * 0.7),
    r: (0.5 + Math.random() * 1.15) * dpr,
    speed: (14 + Math.random() * 42) * dpr,
    wobAmp: (0.6 + Math.random() * 2.2) * dpr,
    wobHz: 0.4 + Math.random() * 1.4,
    twinkleHz: 0.6 + Math.random() * 2.2,
    phase: Math.random() * Math.PI * 2,
    alpha: 0.3 + Math.random() * 0.6,
    warm: Math.random(),
  }));
}

function syncCanvasSize(): void {
  const canvas = particleCanvas.value;
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    seedMotes(w, h);
  }
}

function drawFrame(ts: number): void {
  const canvas = particleCanvas.value;
  if (!canvas) { rafId = 0; return; }
  const ctx = canvas.getContext('2d');
  if (!ctx) { rafId = 0; return; }

  const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0.016;
  lastTs = ts;
  const { width: w, height: h } = canvas;
  ctx.clearRect(0, 0, w, h);

  const tSec = ts / 1000;
  for (const m of motes) {
    m.x += m.speed * dt;
    if (m.x > w + 4) {
      m.x = -4;
      m.yBase = h * (0.15 + Math.random() * 0.7);
    }
    const y = m.yBase + Math.sin(tSec * m.wobHz * Math.PI * 2 + m.phase) * m.wobAmp;
    const twinkle = 0.55 + 0.45 * Math.sin(tSec * m.twinkleHz * Math.PI * 2 + m.phase);
    // Pale sand rgb(232,199,137) → bright gold rgb(255,236,190)
    const rC = Math.round(232 + m.warm * 23);
    const gC = Math.round(199 + m.warm * 37);
    const bC = Math.round(137 + m.warm * 53);
    ctx.globalAlpha = Math.max(0.06, m.alpha * twinkle);
    ctx.fillStyle = `rgb(${rC},${gC},${bC})`;
    ctx.beginPath();
    ctx.arc(m.x, y, m.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  rafId = requestAnimationFrame(drawFrame);
}

function startDust(): void {
  if (prefersReducedMotion || rafId) return;
  syncCanvasSize();
  lastTs = 0;
  rafId = requestAnimationFrame(drawFrame);
}

function stopDust(): void {
  if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  const canvas = particleCanvas.value;
  const ctx = canvas?.getContext('2d');
  if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
}

watch(isCharging, (charging) => {
  if (charging) startDust();
  else stopDust();
});

onMounted(() => {
  if (particleCanvas.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => syncCanvasSize());
    resizeObserver.observe(particleCanvas.value);
  }
  if (isCharging.value) startDust();
});

onBeforeUnmount(() => {
  stopDust();
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<style scoped>
/* Panel: midnight blue deepening left → warm bright sand on the right,
   like dust settling toward the battery's charged edge. */
.dust-gauge {
  position: relative;
  padding: 14px 16px;
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  border: 1px solid rgba(236, 201, 133, 0.14);
  background:
    radial-gradient(90% 160% at 100% 50%, rgba(236, 201, 133, 0.16) 0%, rgba(236, 201, 133, 0.05) 38%, transparent 62%),
    linear-gradient(100deg, #0a1226 0%, #0c1a3c 42%, #14264e 68%, #2c3352 84%, #4a4340 94%, #63543a 100%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 4px 24px rgba(0, 0, 0, 0.35);
  overflow: hidden;
}

/* Charging: the sand end breathes. */
.dust-gauge.is-charging::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(70% 130% at 100% 50%, rgba(255, 224, 158, 0.14) 0%, transparent 55%);
  animation: dust-breathe 3.6s ease-in-out infinite;
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

.is-charging .dust-gauge__balance-num,
.is-full .dust-gauge__balance-num {
  color: #f3ddae;
  text-shadow: 0 0 14px rgba(236, 201, 133, 0.35);
}

.dust-gauge__balance-unit {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
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

/* Fill: deep blue → cyan → sand. The leading edge glows while charging. */
.battery__fill {
  position: absolute;
  inset: 0 auto 0 0;
  height: 100%;
  border-radius: 5px 0 0 5px;
  background: linear-gradient(90deg, #16337a 0%, #2e7cc8 45%, #9db9c9 72%, #ecc985 100%);
  box-shadow: 0 0 12px rgba(236, 201, 133, 0.35);
  transition: width 0.9s cubic-bezier(0.22, 1, 0.36, 1);
}

.is-charging .battery__fill::after {
  content: '';
  position: absolute;
  right: -7px;
  top: 50%;
  width: 16px;
  height: 16px;
  transform: translateY(-50%);
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 233, 178, 0.95) 0%, rgba(255, 224, 158, 0.35) 45%, transparent 70%);
  filter: blur(0.5px);
}

.is-full .battery__fill {
  border-radius: 5px;
  background: linear-gradient(90deg, #b98f45 0%, #ecc985 55%, #ffe9b2 100%);
  box-shadow: 0 0 16px rgba(255, 224, 158, 0.55);
}

/* Charging shimmer sweep across the filled portion */
.battery__shimmer {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    100deg,
    transparent 20%,
    rgba(255, 245, 220, 0.5) 50%,
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

.dust-gauge__stat .v--charging { color: #ecc985; }
.dust-gauge__stat .v--full { color: #ffe9b2; }

.dust-gauge__cta {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  padding: 5px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  color: #0b1220;
  background: linear-gradient(90deg, #22d3ee 0%, #ecc985 100%);
  cursor: pointer;
  transition: filter 0.15s ease, transform 0.1s ease;
}

.dust-gauge__cta:hover { filter: brightness(1.08); }
.dust-gauge__cta:active { transform: translateY(1px); }

@keyframes dust-sweep {
  0% { transform: translateX(-100%); }
  60%, 100% { transform: translateX(220%); }
}

@keyframes dust-breathe {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .battery__shimmer { animation: none; opacity: 0.35; }
  .battery__fill { transition: none; }
  .dust-gauge.is-charging::before { animation: none; }
}
</style>
