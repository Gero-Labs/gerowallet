<template>
  <div class="comingsoon-page">
    <section class="hero">
      <h1 class="title">Gero Card</h1>
      <p class="subtitle">Top up and pay with ADA</p>
      <div class="badge">Coming Soon</div>
    </section>

    <section class="card-spotlight liquid-glass-card">
      <div class="card-visual">
        <div class="debit-card-container">
          <div class="debit-card-glow"></div>
          <div
            class="debit-card-3d-wrapper"
            @mousemove="handleCardMouseMove"
            @mouseleave="handleCardMouseLeave"
            :style="debitCardStyle"
          >
            <img :src="cardImage" alt="Gero Card" class="debit-card-floating" />
          </div>
        </div>
      </div>

      <div class="selling-points">
        <div class="point">
          <v-icon class="point-icon">mdi-check-circle</v-icon>
          <span class="point-text">Enjoy 6 months of ZERO FEES</span>
        </div>
        <div class="point">
          <v-icon class="point-icon">mdi-check-circle</v-icon>
          <span class="point-text">0% monthly & issuance fees</span>
        </div>
        <div class="point">
          <v-icon class="point-icon">mdi-check-circle</v-icon>
          <span class="point-text">0% fees on ADA-to-euro conversions and spending</span>
        </div>
        <div class="point">
          <v-icon class="point-icon">mdi-check-circle</v-icon>
          <span class="point-text">Manage your card in seconds</span>
        </div>
      </div>

      <div class="cta">
        <div class="teaser">Be the first to get updates when Gero Card launches.</div>
        <button class="button button-disabled" disabled>Join Waitlist (Soon)</button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import cardImageUrl from '@/assets/front_card_no_mcx2.png';
import { use3DCard } from '@/composables/use3DCard';

const cardImage = cardImageUrl;

// 3D Card tilt effect for debit card
const {
  cardStyle: debitCardStyle,
  handleCardMouseMove,
  handleCardMouseLeave
} = use3DCard(10);
</script>

<style lang="scss" scoped>
@import '../styles/variables';
@import '../styles/mixins';

.comingsoon-page {
  display: flex;
  flex-direction: column;
  gap: $spacing-3xl;
}

.hero {
  @include flex-column;
  @include flex-center;
  gap: $spacing-sm;
  text-align: center;
}

.title {
  @include heading-style($font-size-3xl);
}

.subtitle {
  @include body-text($font-size-lg);
  color: $text-secondary;
}

.badge {
  display: inline-block;
  margin-top: $spacing-sm;
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(0, 199, 243, 0.15);
  color: $primary-cyan;
  font-weight: $font-weight-semibold;
  font-size: $font-size-sm;
}

.card-spotlight {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: $spacing-2xl;
  padding: $spacing-3xl;
  border-radius: $border-radius-xl;
}

.liquid-glass-card {
  -webkit-backdrop-filter: blur(12px) brightness(0.2) !important;
  backdrop-filter: blur(12px) !important;
  background: #000000ab !important;
  border: solid 2px #ffffff44 !important;
}

.debit-card-container {
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  overflow: visible;
}

.debit-card-3d-wrapper {
  position: relative;
  z-index: 2;
}

.debit-card-floating {
  width: 300px;
  height: auto;
  border-radius: 12px;
  animation: float 5s ease-in-out infinite;
}

.debit-card-glow {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 360px;
  height: 240px;
  background: radial-gradient(circle, rgba(0, 199, 243, 0.18) 0%, rgba(0, 199, 243, 0.08) 35%, transparent 65%);
  border-radius: 20px;
  z-index: 1;
  pointer-events: none;
}

@keyframes float {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-10px); }
}

.selling-points {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: $spacing-lg $spacing-2xl;
  width: 100%;
}

.point {
  display: flex;
  align-items: center;
  gap: $spacing-sm;
}

.point-icon {
  font-size: 18px;
  color: rgba(0, 199, 243, 0.8);
}

.point-text {
  @include body-text($font-size-base);
  color: $text-secondary;
}

.cta {
  @include flex-column;
  @include flex-center;
  gap: $spacing-md;
}

.teaser {
  @include body-text($font-size-sm);
  color: $text-muted;
  text-align: center;
}

.button {
  padding: 10px 18px;
  border-radius: $border-radius-md;
  background: rgba(255,255,255,0.1);
  color: $text-secondary;
  border: 1px solid $border-secondary;
}

.button-disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

@include mobile {
  .selling-points { grid-template-columns: 1fr; }
  .debit-card-floating { width: 240px; }
  .debit-card-glow { width: 300px; height: 200px; }
}
</style>
