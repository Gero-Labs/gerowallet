<template>
  <div class="mini-layout">
    <!-- Wavy background image (same as dashboard) -->
    <div
      class="mini-bg"
      :style="{ backgroundImage: `url(${cardanoBg})` }"
    ></div>

    <MiniHeader
      @wallet-switch="$emit('wallet-switch')"
      @settings="$emit('settings')"
    />
    <main class="mini-content">
      <router-view />
    </main>
    <BottomNav />
  </div>
</template>

<script setup lang="ts">
import MiniHeader from '../components/MiniHeader.vue';
import BottomNav from '../components/BottomNav.vue';
import assets from '@/utils/assets';

const cardanoBg = assets.cardanoBg;
</script>

<style scoped>
.mini-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #000;
  overflow: hidden;
  position: relative;
}

.mini-bg {
  position: absolute;
  top: -20%;
  left: 50%;
  width: 140%;
  height: 70%;
  z-index: 0;
  background-size: cover;
  background-position: center bottom;
  background-repeat: no-repeat;
  transform: translateX(-50%) scaleY(-0.5) scaleX(-1);
  pointer-events: none;
  filter: brightness(0.45);
  opacity: 0;
  transition: opacity 0.3s ease-in-out;
}

.mini-bg[style*='url('] {
  opacity: 1;
}

.mini-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  position: relative;
  z-index: 1;
}
</style>
