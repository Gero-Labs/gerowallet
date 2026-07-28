<template>
  <v-card flat outlined class="fill-height glass-panel cashback-card cashback-card-with-bg">
    <v-card-title>{{ $t('cashback.title') }}</v-card-title>
    <v-card-text class="pa-0" style="height: calc(100% - 64px); display: flex; flex-direction: column;">
      <div>
        <!-- Promo Section -->
        <div class="cashback-combined-row cashback-rewards-section">
          <div class="cashback-section">
            <v-list-item-avatar size="32" tile class="mr-2">
              <v-img :src="assets.giftSvg" contain></v-img>
            </v-list-item-avatar>
            <div class="cashback-content">
              <div class="cashback-title">{{ $t('cashback.payAndReceive') }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Go Cashback Button -->
      <div class="cashback-button-container">
        <v-btn elevation="0" height="36" color="var(--g-surface)" @click="navigateToCashback" block>
          <div class="btn-text">{{ $t('cashback.goCashback') }}</div>
        </v-btn>
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { getCurrentInstance } from 'vue'
import assets from '@/utils/assets'

const vmProxy = getCurrentInstance()!.proxy as { $router: { push: (path: string) => Promise<void> } }

const navigateToCashback = () => {
  vmProxy.$router.push('/cashback').then(() => {
    // Scroll to top of the page after navigation
    window.scrollTo({ top: 0, behavior: 'smooth' })
  })
}
</script>

<style scoped>
.cashback-card {
  width: 100%;
}

.cashback-card-with-bg {
  position: relative;
  overflow: hidden;
}

.cashback-card-with-bg::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-image: url('@/assets/cardanoBg.png') !important;
  background-size: auto !important;
  background-position: bottom left !important;
  background-repeat: no-repeat !important;
  opacity: 0.4;
  transform: scale(1.0) translateY(-50%);
  z-index: 1;
  pointer-events: none;
}

.cashback-card-with-bg::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background:
    radial-gradient(circle at 30% 20%, rgba(255, 255, 255, 0.05) 0%, transparent 30%),
    radial-gradient(circle at 70% 80%, rgba(0, 199, 243, 0.03) 0%, transparent 40%),
    radial-gradient(circle at 20% 70%, rgba(0, 250, 213, 0.03) 0%, transparent 35%),
    linear-gradient(45deg, rgba(255, 255, 255, 0.02) 0%, transparent 50%),
    rgba(0, 0, 0, 0.2);
  z-index: 2;
  pointer-events: none;
}

.cashback-card-with-bg .v-card__title,
.cashback-card-with-bg .v-card__text {
  position: relative;
  z-index: 3;
}


.card-text-vertical {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.cashback-combined-row {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  gap: 24px;
  width: 100%;
}

.cashback-rewards-section {
  /* Nested tier over the glass-panel card. Keeps its own blur on purpose: it
     sits over the decorative cardanoBg image and the blur is what keeps the
     promo copy legible against it. */
  background-color: var(--g-hairline-1);
  background-image: none;
  backdrop-filter: blur(20px) saturate(1.8);
  -webkit-backdrop-filter: blur(20px) saturate(1.8);
  position: relative;
  overflow: hidden;
  isolation: isolate;
  padding: 8px 14px;
  margin: 0;
  width: 100%;
}

.cashback-section {
  display: flex;
  align-items: flex-start;
  min-width: 0;
}

.cashback-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cashback-title {
  font-size: 14px;
  color: white;
  font-weight: 500;
}

.btn-text {
  text-transform: capitalize;
  background: linear-gradient(to right, #00c7f3, #00fad5);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  font-size: 14px;
  font-weight: 600;
}

.cashback-button-container {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 0 12px 12px 12px;
}
</style>
