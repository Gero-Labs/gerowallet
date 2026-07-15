<template>
  <canvas ref="particleCanvas" class="dust-particle-canvas" aria-hidden="true" />
</template>

<script setup lang="ts">
/**
 * Reusable "living dust" particle field — sand-gold motes drifting left→right
 * with varied size/speed, vertical wobble and twinkle. Extracted from the
 * DUST battery so both the dashboard gauge and mini-Gero's compact battery
 * share one implementation. DPR-aware, ResizeObserver-backed; the rAF loop
 * only runs while `active` (and browsers pause rAF in hidden tabs). Honors
 * prefers-reduced-motion.
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps<{ active: boolean }>();

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
