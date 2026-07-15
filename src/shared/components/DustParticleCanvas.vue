<template>
  <canvas ref="particleCanvas" class="dust-particle-canvas" aria-hidden="true" />
</template>

<script setup lang="ts">
/**
 * Reusable "charging battery" particle field for the DUST gauges, split into
 * two zones around the fill boundary (`fillPct`):
 *
 * - EMPTY zone (right of the boundary): sand-gold dust motes drift
 *   right -> left toward the fill edge and "land" on it — a brief landing
 *   flash at the boundary, then the mote respawns at the right edge. Reads
 *   as dust being accumulated INTO the charge.
 * - FILLED zone (left of the boundary): no dust — thin "power" streaks flow
 *   left -> right through the charged section instead, clipped to the fill.
 *
 * Extracted from the DUST battery so both the dashboard gauge and mini-Gero's
 * compact battery share one implementation. DPR-aware, ResizeObserver-backed;
 * the rAF loop only runs while `active` (and browsers pause rAF in hidden
 * tabs). Honors prefers-reduced-motion.
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    active: boolean;
    /** Battery fill percent (0-100). Dust lives right of it, power left of it. */
    fillPct?: number;
  }>(),
  { fillPct: 0 },
);

interface DustMote {
  x: number;        // device px
  yBase: number;    // device px
  r: number;        // radius, device px
  speed: number;    // device px / s (moves right -> left)
  wobAmp: number;   // wobble amplitude, device px
  wobHz: number;    // wobble speed
  twinkleHz: number;
  phase: number;
  alpha: number;
  warm: number;     // 0..1 — lerp between pale sand and bright gold
}

/** Brief glow where a mote lands on the fill edge ("accumulation"). */
interface LandingFlash {
  y: number;        // device px
  age: number;      // seconds since landing
}

/** A thin energy streak flowing through the charged section. */
interface PowerStreak {
  x: number;        // leading-edge x, device px
  y: number;        // device px
  len: number;      // device px
  speed: number;    // device px / s (moves left -> right)
  alpha: number;
  twinkleHz: number;
  phase: number;
}

const FLASH_DURATION_S = 0.35;
const MAX_FLASHES = 12;

const particleCanvas = ref<HTMLCanvasElement | null>(null);
let motes: DustMote[] = [];
let streaks: PowerStreak[] = [];
let flashes: LandingFlash[] = [];
let rafId = 0;
let lastTs = 0;
let resizeObserver: ResizeObserver | null = null;

const prefersReducedMotion = typeof window !== 'undefined'
  && !!window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function boundaryX(w: number): number {
  const pct = Math.max(0, Math.min(100, props.fillPct));
  return (w * pct) / 100;
}

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
  // Streak count scales with total width; each frame they draw clipped to
  // the CURRENT fill, so a moving boundary needs no reseed.
  const streakCount = Math.max(3, Math.min(10, Math.round(w / (70 * dpr))));
  streaks = Array.from({ length: streakCount }, () => ({
    x: Math.random() * w,
    y: h * (0.2 + Math.random() * 0.6),
    len: (10 + Math.random() * 22) * dpr,
    speed: (40 + Math.random() * 70) * dpr,
    alpha: 0.14 + Math.random() * 0.22,
    twinkleHz: 0.5 + Math.random() * 1.3,
    phase: Math.random() * Math.PI * 2,
  }));
  flashes = [];
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
  const dpr = window.devicePixelRatio || 1;
  ctx.clearRect(0, 0, w, h);

  const tSec = ts / 1000;
  const bx = boundaryX(w);

  // ── Empty zone: dust drifts right -> left and lands on the fill edge ──
  for (const m of motes) {
    m.x -= m.speed * dt;
    if (m.x <= bx + m.r) {
      // Landed on the charge: flash at the boundary, respawn on the right.
      if (flashes.length < MAX_FLASHES && bx > 2 * dpr) {
        flashes.push({ y: m.yBase, age: 0 });
      }
      m.x = w + 4;
      m.yBase = h * (0.15 + Math.random() * 0.7);
      continue;
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

  // Landing flashes: a small glow blooming out then fading at the fill edge.
  for (const f of flashes) {
    f.age += dt;
    const p = Math.min(1, f.age / FLASH_DURATION_S);
    const radius = (1.5 + p * 3.5) * dpr;
    ctx.globalAlpha = 0.7 * (1 - p);
    const glow = ctx.createRadialGradient(bx, f.y, 0, bx, f.y, radius);
    glow.addColorStop(0, 'rgb(255,236,190)');
    glow.addColorStop(1, 'rgba(255,236,190,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(bx, f.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  flashes = flashes.filter((f) => f.age < FLASH_DURATION_S);

  // ── Filled zone: power streaks flow left -> right, clipped to the fill ──
  if (bx > 8 * dpr) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, bx, h);
    ctx.clip();
    for (const s of streaks) {
      s.x += s.speed * dt;
      if (s.x - s.len > bx) {
        s.x = 0;
        s.y = h * (0.2 + Math.random() * 0.6);
      }
      const twinkle = 0.6 + 0.4 * Math.sin(tSec * s.twinkleHz * Math.PI * 2 + s.phase);
      const grad = ctx.createLinearGradient(s.x - s.len, s.y, s.x, s.y);
      grad.addColorStop(0, 'rgba(255,240,205,0)');
      grad.addColorStop(0.7, 'rgba(255,240,205,0.85)');
      grad.addColorStop(1, 'rgba(255,252,235,1)');
      ctx.globalAlpha = s.alpha * twinkle;
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1 * dpr;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(s.x - s.len, s.y);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
    }
    ctx.restore();
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

watch(() => props.active, (active) => {
  if (active) startDust();
  else stopDust();
});

onMounted(() => {
  if (particleCanvas.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => syncCanvasSize());
    resizeObserver.observe(particleCanvas.value);
  }
  if (props.active) startDust();
});

onBeforeUnmount(() => {
  stopDust();
  resizeObserver?.disconnect();
  resizeObserver = null;
});
</script>

<style scoped>
.dust-particle-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
</style>
