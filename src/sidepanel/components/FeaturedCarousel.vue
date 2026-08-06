<template>
  <!-- Single featured promo. This was a two-slide carousel (Gero Card + Cashback)
       until the Gero Card was removed from the panel; with one slide left the
       drag/snap/auto-scroll machinery and the progress dots had nothing to do,
       so this is now a plain tappable card. -->
  <div v-if="!isApex" class="featured-promo">
    <button type="button" class="promo-card cashback-promo" @click="openCashback">
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
          <div class="promo-subtitle text-caption" style="color: var(--g-text-2);">
            {{ $t('miniGero.cashbackPoweredBy') }}
          </div>
        </div>
      </div>
      <div class="promo-card-image cashback-card-img">
        <img :src="cashbackImage" alt="Cashback" />
      </div>
    </button>
  </div>
</template>

<script setup lang="ts">
import assets from '@/utils/assets';
import { openFullDashboard } from '@/shared/utils/openFullDashboard';
import { useChainContext } from '../composables/useChainContext';

const { isApex } = useChainContext();

const cashbackBgImage = assets.cashbackBg;
const cashbackImage = assets.cashbackImage;

// Cashback is a full-wallet surface: the Bring portal wants the room, and the
// panel is 400px wide. Open it in the dashboard rather than in here.
function openCashback() {
  void openFullDashboard('#/cashback', true);
}
</script>

<style scoped>
.featured-promo {
  padding: 0 16px;
  overflow: hidden;
}

/* ── Promo card ── */
.promo-card {
  width: 100%;
  min-height: 96px;
  border-radius: var(--g-r-card);
  padding: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  text-align: left;
  font: inherit;
  cursor: pointer;
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

/* Edge glow container */
.ai-glow {
  position: absolute;
  inset: 0;
  border-radius: var(--g-r-card);
  pointer-events: none;
  z-index: 1;
  overflow: hidden;
}

.ai-glow::before {
  content: '';
  position: absolute;
  inset: -60%;
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

/* Pulse overlay */
.ai-glow-pulse {
  position: absolute;
  inset: 0;
  border-radius: var(--g-r-card);
  pointer-events: none;
  z-index: 1;
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
  transition: transform 0.3s ease;
}

.promo-card:hover .promo-card-image {
  transform: translateY(-2px) rotate(-2deg);
}

.promo-card-image img {
  width: 100%;
  height: auto;
  border-radius: var(--g-r-control);
}

.cashback-card-img {
  width: 90px;
  filter: drop-shadow(0 4px 12px rgba(71, 205, 137, 0.3));
}

.cashback-card-img img {
  border-radius: var(--g-r-control);
}
</style>
