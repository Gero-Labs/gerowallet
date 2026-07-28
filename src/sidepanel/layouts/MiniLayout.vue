<template>
  <div class="mini-layout">
    <!-- Wavy background image (same as dashboard) -->
    <div
      class="mini-bg"
      :class="{ 'mini-bg--midnight': isMidnight }"
      :style="{ backgroundImage: `url(${bgImage})` }"
    ></div>

    <main class="mini-content">
      <MiniHeader
        @wallet-switch="$emit('wallet-switch')"
        @settings="$emit('settings')"
      />
      <transition :name="transitionName" mode="out-in">
        <router-view :key="$route.path" />
      </transition>
    </main>
    <BottomNav />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router/composables';
import MiniHeader from '../components/MiniHeader.vue';
import BottomNav from '../components/BottomNav.vue';
import assets from '@/utils/assets';
import { useChainContext } from '../composables/useChainContext';

const { isMidnight } = useChainContext();
// Midnight gets its own night-sky backdrop; everything else keeps the
// Cardano waves (Apex reuses them too, matching current behavior).
const bgImage = computed(() => (isMidnight.value ? assets.midnightBg : assets.cardanoBg));

// Tab order for directional slide
const tabOrder: Record<string, number> = {
  '/': 0,
  '/staking': 1,
  '/card': 2,
  '/market': 3,
  '/activity': 4,
  '/feed': 5,
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
  background: var(--g-canvas);
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

/* Midnight starfield: render naturally — the flip/squash transform above is
   art-direction for the Cardano waves and distorts the night sky. Same
   fade-to-black mask as the dashboard's midnight-background-dashboard, tuned
   to start darkening at the DUST battery (~1/3 down) so the token list and
   nav sit on near-black instead of fighting the stars. */
.mini-bg--midnight {
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  transform: none;
  background-position: center;
  filter: brightness(0.6);
  mask-image: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 1) 0%,
    rgba(0, 0, 0, 1) 8%,
    rgba(0, 0, 0, 0.5) 18%,
    rgba(0, 0, 0, 0.15) 30%,
    rgba(0, 0, 0, 0) 42%
  );
  -webkit-mask-image: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 1) 0%,
    rgba(0, 0, 0, 1) 8%,
    rgba(0, 0, 0, 0.5) 18%,
    rgba(0, 0, 0, 0.15) 30%,
    rgba(0, 0, 0, 0) 42%
  );
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
