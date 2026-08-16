<template>
  <nav class="bottom-nav">
    <button
      v-for="tab in navTabs"
      :key="tab.name"
      type="button"
      class="nav-tab"
      :class="{ active: isActive(tab), center: tab.center }"
      @click="onTab(tab)"
    >
      <v-icon :size="tab.center ? 28 : 22" :color="isActive(tab) ? activeColor : 'var(--g-text-3)'">
        {{ isActive(tab) ? tab.activeIcon : tab.icon }}
      </v-icon>
    </button>
  </nav>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router/composables';
import { useMiniNavigation, NavTab } from '../composables/useMiniNavigation';

const router = useRouter();
const { navTabs, activeTab } = useMiniNavigation();
// Active icon uses the single per-chain accent (teal for Apex Prime, orange for
// Vector, …) — the same --g-accent the active tab background already uses.
// themeColors.primary collapsed both Apex families to one shared orange.
const activeColor = 'var(--g-accent)';

const emit = defineEmits<{
  (e: 'action', id: string): void;
}>();

// Action tabs (swap) have no route, so they never read as "active".
function isActive(tab: NavTab): boolean {
  return !!tab.route && activeTab.value === tab.route;
}

function onTab(tab: NavTab) {
  if (tab.action) {
    emit('action', tab.action);
    return;
  }
  if (tab.route && activeTab.value !== tab.route) {
    router.push(tab.route).catch(() => {});
  }
}
</script>

<style scoped>
.bottom-nav {
  display: flex;
  justify-content: space-around;
  align-items: center;
  height: 56px;
  background: var(--g-surface);
  border-top: 1px solid var(--g-hairline-1);
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
  border-radius: var(--g-r-card);
  transition: background 0.2s;
}

.nav-tab:hover {
  background: var(--g-hairline-1);
}

.nav-tab.active {
  background: color-mix(in srgb, var(--g-accent) 12%, transparent);
}

.nav-tab.center {
  width: 48px;
  height: 48px;
  background: var(--g-hairline-1);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-card);
}

.nav-tab.center.active {
  background: color-mix(in srgb, var(--g-accent) 18%, transparent);
}
</style>
