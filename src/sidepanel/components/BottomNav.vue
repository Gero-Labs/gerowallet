<template>
  <nav class="bottom-nav">
    <button
      v-for="tab in navTabs"
      :key="tab.route"
      class="nav-tab"
      :class="{ active: activeTab === tab.route, center: tab.center }"
      @click="activeTab !== tab.route && $router.push(tab.route).catch(() => {})"
    >
      <v-icon :size="tab.center ? 28 : 22" :color="activeTab === tab.route ? activeColor : '#888'">
        {{ activeTab === tab.route ? tab.activeIcon : tab.icon }}
      </v-icon>
    </button>
  </nav>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useMiniNavigation } from '../composables/useMiniNavigation';
import { useChainContext } from '../composables/useChainContext';

const { navTabs, activeTab } = useMiniNavigation();
const { themeColors } = useChainContext();
const activeColor = computed(() => themeColors.value.primary);
</script>

<style scoped>
.bottom-nav {
  display: flex;
  justify-content: space-around;
  align-items: center;
  height: 56px;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(20px) saturate(1.6);
  -webkit-backdrop-filter: blur(20px) saturate(1.6);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding: 0 8px;
  flex-shrink: 0;
  position: relative;
  z-index: 2;
}

.nav-tab {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border: none;
  background: none;
  cursor: pointer;
  border-radius: 12px;
  transition: background 0.2s;
}

.nav-tab:hover {
  background: rgba(255, 255, 255, 0.06);
}

.nav-tab.active {
  background: color-mix(in srgb, var(--chain-primary) 12%, transparent);
}

.nav-tab.center {
  width: 48px;
  height: 48px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 14px;
}

.nav-tab.center.active {
  background: color-mix(in srgb, var(--chain-primary) 18%, transparent);
}
</style>
