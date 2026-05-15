<template>
  <div v-if="!isApex" class="featured-carousel">
    <div
      class="carousel-track"
      ref="trackRef"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <!-- Gero Card Promo -->
      <div class="promo-card gero-card-promo" data-promo="gero-card">
        <div
          class="promo-bg"
          :style="{ backgroundImage: `url(${debitCardBgImage})` }"
        />
        <!-- Apple Intelligence glow -->
        <div class="ai-glow" />
        <div class="ai-glow-pulse" />

        <div class="promo-content">
          <div class="promo-text">
            <div class="promo-title text-subtitle-2 white--text font-weight-bold">
              {{ $t('miniGero.geroCardPromo') }}
            </div>
            <div class="promo-subtitle text-caption" style="color: rgba(255,255,255,0.6);">
              {{ $t('miniGero.geroCardPromoSubtitle') }}
            </div>
          </div>
        </div>
        <div class="promo-card-image">
          <img :src="debitCardImage" alt="Gero Card" />
        </div>
      </div>

      <!-- Cashback Promo -->
      <div class="promo-card cashback-promo" data-promo="cashback">
        <div
          class="promo-bg cashback-bg"
          :style="{ backgroundImage: `url(${cashbackBgImage})` }"
        />
        <!-- Apple Intelligence glow — cashback colors -->
        <div class="ai-glow ai-glow--cashback" />
        <div class="ai-glow-pulse ai-glow-pulse--cashback" />

        <div class="promo-content">
          <div class="promo-text">
            <div class="promo-title text-subtitle-2 white--text font-weight-bold cashback-title-text">
              {{ $t('miniGero.cashback') }}
            </div>
            <div class="promo-subtitle text-caption" style="color: rgba(255,255,255,0.6);">
              {{ $t('miniGero.cashbackPoweredBy') }}
            </div>
          </div>
        </div>
        <div class="promo-card-image cashback-card-img">
          <img :src="cashbackImage" alt="Cashback" />
        </div>
      </div>
    </div>

    <!-- Progress dots with timer bar -->
    <div class="progress-dots">
      <div
        v-for="(_, i) in cardCount"
        :key="i"
        class="dot-track"
        @click="goToSlide(i)"
      >
        <div
          class="dot-fill"
          :class="{ active: i === activeIndex, filling: i === activeIndex && !isDragging }"
          :style="i === activeIndex && !isDragging ? { animationDuration: autoScrollInterval + 'ms' } : {}"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router/composables';
import assets from '@/utils/assets';
import { useChainContext } from '../composables/useChainContext';

const { isApex } = useChainContext();
const router = useRouter();
const trackRef = ref<HTMLElement | null>(null);
const activeIndex = ref(0);
const isDragging = ref(false);
const cardCount = 2;
const autoScrollInterval = 6000;

const debitCardBgImage = assets.debitCardBgImage;
const debitCardImage = assets.debitCardImage;
const cashbackBgImage = assets.cashbackBg;
const cashbackImage = assets.cashbackImage;

// --- Auto-scroll ---
let scrollTimer: ReturnType<typeof setInterval> | null = null;

function startAutoScroll() {
  stopAutoScroll();
  scrollTimer = setInterval(() => {
    if (isDragging.value) return;
    const next = (activeIndex.value + 1) % cardCount;
    goToSlide(next);
  }, autoScrollInterval);
}

function stopAutoScroll() {
  if (scrollTimer) {
    clearInterval(scrollTimer);
    scrollTimer = null;
  }
}

function goToSlide(index: number) {
  activeIndex.value = index;
  const track = trackRef.value;
  if (!track) return;
  const card = track.children[index] as HTMLElement;
  if (card) {
    track.scrollTo({ left: card.offsetLeft, behavior: 'smooth' });
  }
  // Reset timer so the full interval applies after manual navigation
  startAutoScroll();
}

// --- Drag / swipe ---
let dragStartX = 0;
let dragScrollLeft = 0;
let hasDragged = false;

function onPointerDown(e: PointerEvent) {
  const track = trackRef.value;
  if (!track) return;
  isDragging.value = true;
  hasDragged = false;
  dragStartX = e.clientX;
  dragScrollLeft = track.scrollLeft;
  track.setPointerCapture(e.pointerId);
  stopAutoScroll();
}

function onPointerMove(e: PointerEvent) {
  if (!isDragging.value) return;
  const dx = e.clientX - dragStartX;
  if (Math.abs(dx) > 5) hasDragged = true;
  const track = trackRef.value;
  if (track) {
    track.scrollLeft = dragScrollLeft - dx;
  }
}

function onPointerUp(e: PointerEvent) {
  if (!isDragging.value) return;
  isDragging.value = false;
  const track = trackRef.value;
  if (!track) return;
  track.releasePointerCapture(e.pointerId);

  // If it was a tap (not a drag), trigger the promo click
  if (!hasDragged) {
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const promoCard = (target as HTMLElement)?.closest('[data-promo]') as HTMLElement | null;
    if (promoCard) {
      handlePromoClick(promoCard.dataset.promo!);
    }
  }

  // Snap to nearest card
  const cardWidth = track.children[0]?.clientWidth || track.clientWidth;
  const scrollPos = track.scrollLeft;
  const nearest = Math.round(scrollPos / cardWidth);
  const clamped = Math.max(0, Math.min(nearest, cardCount - 1));
  activeIndex.value = clamped;
  track.scrollTo({ left: clamped * cardWidth, behavior: 'smooth' });
  startAutoScroll();
}

// --- Scroll observer (sync activeIndex on native scroll/snap) ---
function onScroll() {
  if (isDragging.value) return;
  const track = trackRef.value;
  if (!track) return;
  const cardWidth = track.children[0]?.clientWidth || track.clientWidth;
  const idx = Math.round(track.scrollLeft / cardWidth);
  activeIndex.value = Math.max(0, Math.min(idx, cardCount - 1));
}

function handlePromoClick(promoId: string) {
  // Don't navigate if user was dragging
  if (hasDragged) return;
  if (promoId === 'gero-card') {
    router.push('/card');
  } else if (promoId === 'cashback') {
    router.push('/cashback');
  }
}

onMounted(() => {
  trackRef.value?.addEventListener('scroll', onScroll, { passive: true });
  startAutoScroll();
});

onBeforeUnmount(() => {
  trackRef.value?.removeEventListener('scroll', onScroll);
  stopAutoScroll();
});
</script>

<style scoped>
/* ── Carousel container ── */
.featured-carousel {
  padding: 0 16px;
  overflow: hidden;
}

.carousel-track {
  display: flex;
  gap: 0;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
  -ms-overflow-style: none;
  touch-action: pan-x;
  cursor: grab;
}

.carousel-track:active {
  cursor: grabbing;
}

.carousel-track::-webkit-scrollbar {
  display: none;
}

/* ── Promo card base ── */
.promo-card {
  flex-shrink: 0;
  width: 100%;
  min-height: 96px;
  border-radius: 14px;
  padding: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  scroll-snap-align: start;
  transition: transform 0.15s ease;
  position: relative;
  overflow: hidden;
}

.promo-card:active {
  transform: scale(0.98);
}

/* Background image */
.promo-bg {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  opacity: 0.7;
}

.cashback-bg {
  opacity: 0.5;
  filter: blur(8px);
  inset: -8px;
}

/* ── Apple Intelligence Glow ── */

/* Rotating prismatic border — Gero Card (cyan/teal palette) */
.ai-glow {
  position: absolute;
  inset: 0;
  border-radius: 14px;
  pointer-events: none;
  z-index: 1;
  overflow: hidden;
}

.ai-glow::before {
  content: '';
  position: absolute;
  inset: -60%;
  background: conic-gradient(
    from var(--glow-angle, 0deg),
    rgba(0, 199, 243, 0.4),
    rgba(0, 255, 209, 0.3),
    rgba(100, 220, 255, 0.15),
    rgba(0, 180, 230, 0.35),
    rgba(0, 255, 200, 0.25),
    rgba(0, 199, 243, 0.4)
  );
  animation: ai-rotate 5s linear infinite;
  filter: blur(20px);
}

/* Mask the glow to only show at the edges — center is transparent so background shows through */
.ai-glow {
  -webkit-mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  padding: 3px;
}

/* Breathing pulse overlay */
.ai-glow-pulse {
  position: absolute;
  inset: 0;
  border-radius: 14px;
  box-shadow:
    inset 0 0 30px rgba(0, 230, 220, 0.15),
    inset 0 -10px 30px rgba(0, 255, 200, 0.1),
    0 0 20px rgba(0, 199, 243, 0.08);
  pointer-events: none;
  z-index: 1;
  animation: glow-breathe 4s ease-in-out infinite;
}

/* Cashback glow variant — warm green/gold palette */
.ai-glow--cashback::before {
  background: conic-gradient(
    from var(--glow-angle, 0deg),
    rgba(71, 205, 137, 0.4),
    rgba(255, 200, 50, 0.3),
    rgba(100, 220, 140, 0.15),
    rgba(50, 180, 100, 0.35),
    rgba(255, 220, 80, 0.2),
    rgba(71, 205, 137, 0.4)
  );
}

/* cashback uses same mask approach — no override needed */

.ai-glow-pulse--cashback {
  box-shadow:
    inset 0 0 30px rgba(71, 205, 137, 0.15),
    inset 0 -10px 30px rgba(255, 200, 50, 0.08),
    0 0 20px rgba(71, 205, 137, 0.08);
}

@keyframes ai-rotate {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

@keyframes glow-breathe {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}

/* ── Card variants ── */
.gero-card-promo {
  background: rgba(5, 20, 40, 0.85);
  border: 1px solid rgba(0, 220, 220, 0.15);
}

.cashback-promo {
  background: rgba(10, 25, 15, 0.85);
  border: 1px solid rgba(71, 205, 137, 0.15);
}

/* ── Content ── */
.promo-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
  position: relative;
  z-index: 2;
}

.promo-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.promo-title {
  font-size: 14px !important;
  text-shadow: 0 1px 8px rgba(0, 199, 243, 0.3);
}

.cashback-title-text {
  text-shadow: 0 1px 8px rgba(71, 205, 137, 0.3);
}

.promo-subtitle {
  font-size: 11px !important;
  line-height: 1.3;
}

.promo-card-image {
  width: 80px;
  flex-shrink: 0;
  margin-left: 12px;
  position: relative;
  z-index: 2;
  filter: drop-shadow(0 4px 12px rgba(0, 199, 243, 0.25));
  transition: transform 0.3s ease;
}

.promo-card:hover .promo-card-image {
  transform: translateY(-2px) rotate(-2deg);
}

.promo-card-image img {
  width: 100%;
  height: auto;
  border-radius: 6px;
}

.cashback-card-img {
  width: 90px;
  filter: drop-shadow(0 4px 12px rgba(71, 205, 137, 0.3));
}

.cashback-card-img img {
  border-radius: 10px;
}

/* ── Progress dots ── */
.progress-dots {
  display: flex;
  justify-content: center;
  gap: 6px;
  padding: 10px 0 2px;
}

.dot-track {
  width: 24px;
  height: 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.12);
  overflow: hidden;
  cursor: pointer;
  transition: width 0.2s ease;
}

.dot-fill {
  height: 100%;
  width: 0;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.25);
  transition: width 0.15s ease;
}

.dot-fill.active {
  width: 100%;
  background: rgba(0, 199, 243, 0.7);
}

.dot-fill.filling {
  width: 0;
  animation: dot-progress linear forwards;
}

@keyframes dot-progress {
  0% { width: 0; }
  100% { width: 100%; }
}
</style>
