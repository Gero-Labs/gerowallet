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
      <transition :name="transitionName" mode="out-in">
        <router-view :key="$route.path" />
      </transition>
    </main>
    <BottomNav />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute } from 'vue-router/composables';
import MiniHeader from '../components/MiniHeader.vue';
import BottomNav from '../components/BottomNav.vue';
import assets from '@/utils/assets';

const cardanoBg = assets.cardanoBg;

// Tab order for directional slide
const tabOrder: Record<string, number> = {
  '/': 0,
  '/staking': 1,
  '/card': 2,
  '/market': 3,
  '/activity': 4,
};

const transitionName = ref('page-fade');
const route = useRoute();
let prevIndex = tabOrder[route.path] ?? -1;

watch(() => route.path, (to) => {
  const toIndex = tabOrder[to];
  const fromIndex = prevIndex;

  if (toIndex !== undefined && fromIndex !== undefined && fromIndex >= 0) {
    // Both are nav tabs — slide directionally
    transitionName.value = toIndex > fromIndex ? 'page-slide-left' : 'page-slide-right';
  } else {
    // Sub-page (e.g. perps) — simple fade
    transitionName.value = 'page-fade';
  }

  prevIndex = toIndex ?? -1;
});
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

/* ── Page transitions ── */

/* Fade (for sub-pages like perps) */
.page-fade-enter-active,
.page-fade-leave-active {
  transition: opacity 0.18s ease;
}
.page-fade-enter,
.page-fade-leave-to {
  opacity: 0;
}

/* Slide left (navigating forward in tabs) */
.page-slide-left-enter-active,
.page-slide-left-leave-active {
  transition: transform 0.22s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.22s ease;
}
.page-slide-left-enter {
  transform: translateX(24px);
  opacity: 0;
}
.page-slide-left-leave-to {
  transform: translateX(-24px);
  opacity: 0;
}

/* Slide right (navigating backward in tabs) */
.page-slide-right-enter-active,
.page-slide-right-leave-active {
  transition: transform 0.22s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.22s ease;
}
.page-slide-right-enter {
  transform: translateX(-24px);
  opacity: 0;
}
.page-slide-right-leave-to {
  transform: translateX(24px);
  opacity: 0;
}
</style>
