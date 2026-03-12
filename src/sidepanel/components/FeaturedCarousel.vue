<template>
  <div class="featured-carousel">
    <div class="carousel-track" ref="trackRef">
      <!-- Gero Card Promo -->
      <div class="promo-card gero-card-promo" @click="handlePromoClick('gero-card')">
        <div class="promo-content">
          <div class="promo-text">
            <div class="promo-title text-subtitle-2 white--text font-weight-bold">
              {{ $t('miniGero.geroCardPromo') }}
            </div>
            <div class="promo-subtitle text-caption grey--text">
              {{ $t('miniGero.geroCardPromoSubtitle') }}
            </div>
          </div>
          <div class="promo-action">
            <v-btn
              x-small
              rounded
              outlined
              color="#00c7f3"
              class="learn-more-btn"
              @click.stop="handlePromoClick('gero-card')"
            >
              {{ $t('miniGero.learnMore') }}
            </v-btn>
          </div>
        </div>
        <div class="promo-icon-area">
          <v-icon size="36" color="#00c7f3">mdi-credit-card-outline</v-icon>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const trackRef = ref<HTMLElement | null>(null);

function handlePromoClick(promoId: string) {
  console.log('[MiniGero] Promo clicked:', promoId);
  // Future: navigate to Gero Card page or open info sheet
}
</script>

<style scoped>
.featured-carousel {
  padding: 0 16px;
  overflow: hidden;
}

.carousel-track {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.carousel-track::-webkit-scrollbar {
  display: none;
}

.promo-card {
  flex-shrink: 0;
  width: 100%;
  min-height: 88px;
  border-radius: 14px;
  padding: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  scroll-snap-align: start;
  transition: transform 0.15s ease;
}

.promo-card:active {
  transform: scale(0.98);
}

.gero-card-promo {
  background:
    linear-gradient(135deg, rgba(13, 40, 71, 0.7) 0%, rgba(10, 30, 58, 0.6) 50%, rgba(17, 45, 78, 0.7) 100%);
  backdrop-filter: blur(16px) saturate(1.5);
  -webkit-backdrop-filter: blur(16px) saturate(1.5);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

.promo-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.promo-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.promo-title {
  font-size: 14px !important;
}

.promo-subtitle {
  font-size: 11px !important;
  line-height: 1.3;
}

.promo-icon-area {
  width: 52px;
  height: 52px;
  border-radius: 12px;
  background: rgba(0, 199, 243, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-left: 12px;
}

.learn-more-btn {
  text-transform: none;
  font-size: 11px !important;
  letter-spacing: 0;
  font-weight: 600;
  padding: 0 12px !important;
  height: 24px !important;
}
</style>
