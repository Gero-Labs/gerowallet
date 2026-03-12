# Mini-Gero Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a native mobile-style Chrome side panel wallet (mini-gero) as a separate Vue 2.7 app that shares stores/services/APIs with the existing Gero Wallet dashboard.

**Architecture:** A new Vue 2.7 + Vuetify 2.7 app at `src/sidepanel/` with its own entry point, router, layout, and components. It imports existing stores, services, APIs, and utilities from the codebase. The full dashboard at `src/options/` is never modified. All sub-flows use bottom sheet overlays instead of page navigation.

**Tech Stack:** Vue 2.7 (Composition API), Vuetify 2.7, TypeScript, Chrome Extension Manifest V3 Side Panel API, Vite 4.5

**Spec:** `docs/superpowers/specs/2026-03-12-mini-gero-design.md`

---

## Chunk 1: Shell (Foundation)

The Shell teammate delivers the app skeleton that all other teammates depend on. This MUST be completed before any other chunk begins.

### File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/sidepanel/index.html` | Rewrite | Simplified HTML for mini-gero (strip dashboard CSS) |
| `src/sidepanel/main.ts` | Rewrite | Vue 2.7 app bootstrap with i18n, vuetify, mini router |
| `src/sidepanel/App.vue` | Create (replace Sidepanel.vue) | Root component: wallet state guard + MiniLayout + DAppOverlay |
| `src/sidepanel/router.ts` | Create | 5 routes: /, /staking, /card, /cashback, /activity |
| `src/sidepanel/layouts/MiniLayout.vue` | Create | Header + router-view + BottomNav |
| `src/sidepanel/components/MiniHeader.vue` | Create | Wallet name, mode toggle, settings |
| `src/sidepanel/components/BottomNav.vue` | Create | 5-tab mobile navigation bar |
| `src/sidepanel/components/BottomSheet.vue` | Create | Reusable bottom sheet overlay component |
| `src/sidepanel/components/DAppOverlay.vue` | Create | DApp signing overlay (root-level) |
| `src/sidepanel/components/NoWalletScreen.vue` | Create | "Get Started" screen for no-wallet state |
| `src/sidepanel/components/LockScreen.vue` | Create | Inline unlock (PIN/pattern/password/PassKey) |
| `src/sidepanel/components/WalletSelector.vue` | Create | Multi-wallet selection list |
| `src/sidepanel/components/SettingsSheet.vue` | Create | Essential settings bottom sheet |
| `src/sidepanel/composables/useBottomSheet.ts` | Create | Bottom sheet open/close/animate logic |
| `src/sidepanel/composables/useDAppOverlay.ts` | Create | DApp message listener + overlay state |
| `src/sidepanel/composables/useMiniNavigation.ts` | Create | Bottom nav active state |
| `vite.config.mts` | Modify (line 225-227) | Add sidepanel build input |
| `extension/manifest.json` | Modify | Add side_panel config |
| `src/chrome/background.ts` | Modify (lines 102-116, DApp handlers) | Fix openSidebar, add mini-gero port detection, setPanelBehavior |

### Task 1.1: Build Configuration + Manifest

**Files:**
- Modify: `vite.config.mts:225-227`
- Modify: `extension/manifest.json`

- [ ] **Step 1: Add sidepanel to Vite build inputs**

In `vite.config.mts`, find the `rollupOptions.input` block (line 225) and add the sidepanel entry:

```typescript
input: {
  options: r('src/options/index.html'),
  sidepanel: r('src/sidepanel/index.html'),
},
```

- [ ] **Step 2: Add side_panel config to manifest.json**

In `extension/manifest.json`, add at the top level (next to `"action"`):

```json
"side_panel": {
  "default_path": "sidepanel/index.html"
}
```

Also remove `"default_popup"` from the `"action"` object if present.

- [ ] **Step 3: Commit**

```bash
git add vite.config.mts extension/manifest.json
git commit -m "feat(mini-gero): add sidepanel build input and manifest config"
```

### Task 1.2: Rewrite index.html and main.ts

**Files:**
- Rewrite: `src/sidepanel/index.html`
- Rewrite: `src/sidepanel/main.ts`
- Delete: `src/sidepanel/Sidepanel.vue` (replaced by App.vue)

- [ ] **Step 1: Rewrite index.html**

Replace the entire contents of `src/sidepanel/index.html`. Strip all dashboard-specific CSS (responsive breakpoints, settingsOverlay, hardwareOverlay, etc.). Keep only the essentials for a 400px-wide dark-theme side panel:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Gero Mini</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap" rel="stylesheet">
</head>
<body>
<div id="app"></div>
<script type="module" src="./main.ts"></script>
<style>
  html, body {
    margin: 0;
    padding: 0;
    overflow: hidden;
    height: 100%;
    background: #0a0a0a;
  }
  #app {
    height: 100%;
  }
  .v-application {
    font-family: 'Inter', sans-serif;
  }
  ::-webkit-scrollbar {
    width: 4px;
  }
  ::-webkit-scrollbar-track {
    background: transparent;
  }
  ::-webkit-scrollbar-thumb {
    background: #383838;
    border-radius: 30px;
  }
  .geroButton {
    background: linear-gradient(45deg, #00c7f3, #00ffd1) !important;
    color: black !important;
  }
  .geroButton:disabled {
    filter: brightness(0.5);
  }
</style>
</body>
</html>
```

- [ ] **Step 2: Rewrite main.ts**

Replace the entire contents of `src/sidepanel/main.ts`. This is modeled on `src/options/main.ts` but simplified — no FlagIcon, no VueShowdown, no Notifications, no ClickOutside directive. It uses the mini-gero router (to be created in Task 1.3):

```typescript
import '@mdi/font/css/materialdesignicons.css';
import 'vuetify/dist/vuetify.min.css';

import Vue from 'vue';
import VueRouter from 'vue-router';
import i18n, { loadLanguage } from '../plugins/i18n';
import vuetify from '../plugins/vuetify';
import router from './router';
import App from './App.vue';
import { walletStore } from '@/stores/walletStore';
import { activityTracker } from '@/services/activityTracker.service';

Vue.config.productionTip = false;
Vue.use(VueRouter);

chrome.storage.local.get(['walletStore', 'geroStore'], async ({ walletStore: saved, geroStore }) => {
  const locale = geroStore?.config?.locale || saved?.config?.locale || 'us';

  if (locale !== 'us') {
    try {
      await loadLanguage(locale);
      i18n.locale = locale;
    } catch (error) {
      console.error('Failed to load language file:', locale, error);
      i18n.locale = 'us';
    }
  }

  const app = new Vue({
    vuetify,
    i18n,
    router,
    render: h => h(App),
  }).$mount('#app');

  // Activity tracker: start when logged in and unlocked
  const checkActivityTracker = () => {
    if (walletStore.loggedWallet && !walletStore.isLocked) {
      activityTracker.start();
    } else {
      activityTracker.stop();
    }
  };

  app.$watch(
    () => [walletStore.loggedWallet, walletStore.isLocked],
    () => checkActivityTracker(),
    { immediate: true },
  );
});
```

- [ ] **Step 3: Delete old Sidepanel.vue**

```bash
git rm src/sidepanel/Sidepanel.vue
```

- [ ] **Step 4: Commit**

```bash
git add src/sidepanel/index.html src/sidepanel/main.ts
git commit -m "feat(mini-gero): rewrite sidepanel entry point for mini-gero"
```

### Task 1.3: Router

**Files:**
- Create: `src/sidepanel/router.ts`

- [ ] **Step 1: Create mini-gero router**

```typescript
import VueRouter, { RouteConfig } from 'vue-router';

const routes: RouteConfig[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('./pages/HomePage.vue'),
  },
  {
    path: '/staking',
    name: 'staking',
    component: () => import('./pages/StakingPage.vue'),
  },
  {
    path: '/card',
    name: 'card',
    component: () => import('./pages/CardPage.vue'),
  },
  {
    path: '/cashback',
    name: 'cashback',
    component: () => import('./pages/CashbackPage.vue'),
  },
  {
    path: '/activity',
    name: 'activity',
    component: () => import('./pages/ActivityPage.vue'),
  },
  {
    path: '*',
    redirect: '/',
  },
];

const router = new VueRouter({
  routes,
});

export default router;
```

- [ ] **Step 2: Create placeholder pages so the build doesn't fail**

Create 5 minimal placeholder files at `src/sidepanel/pages/`:

For each of `HomePage.vue`, `StakingPage.vue`, `CardPage.vue`, `CashbackPage.vue`, `ActivityPage.vue`:

```vue
<template>
  <div class="mini-page">
    <div class="text-h6 white--text pa-4">{{ pageName }}</div>
  </div>
</template>

<script setup lang="ts">
const pageName = 'Home'; // Change per file
</script>
```

- [ ] **Step 3: Commit**

```bash
git add src/sidepanel/router.ts src/sidepanel/pages/
git commit -m "feat(mini-gero): add router and placeholder pages"
```

### Task 1.4: BottomSheet Component + Composable

**Files:**
- Create: `src/sidepanel/composables/useBottomSheet.ts`
- Create: `src/sidepanel/components/BottomSheet.vue`

- [ ] **Step 1: Create useBottomSheet composable**

```typescript
import { ref, watch } from 'vue';

export function useBottomSheet() {
  const isOpen = ref(false);
  const isAnimating = ref(false);

  function open() {
    isOpen.value = true;
    isAnimating.value = true;
    setTimeout(() => {
      isAnimating.value = false;
    }, 300);
  }

  function close() {
    isAnimating.value = true;
    setTimeout(() => {
      isOpen.value = false;
      isAnimating.value = false;
    }, 300);
  }

  return { isOpen, isAnimating, open, close };
}
```

- [ ] **Step 2: Create BottomSheet.vue**

A reusable bottom sheet overlay component. This is the universal interaction pattern for mini-gero — all sub-flows, details, and signing use it.

```vue
<template>
  <div v-if="modelValue" class="bottom-sheet-overlay" @click.self="onBackdropClick">
    <div
      class="bottom-sheet-container"
      :class="{ 'bottom-sheet-enter': entering, 'bottom-sheet-leave': leaving }"
      :style="{ height: height }"
    >
      <div class="bottom-sheet-handle" v-if="showHandle">
        <div class="handle-bar" />
      </div>
      <div v-if="title" class="bottom-sheet-header">
        <span class="text-subtitle-1 white--text font-weight-bold">{{ title }}</span>
        <v-btn icon small @click="close" class="white--text">
          <v-icon small>mdi-close</v-icon>
        </v-btn>
      </div>
      <div class="bottom-sheet-content">
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

const props = withDefaults(defineProps<{
  modelValue: boolean;
  title?: string;
  height?: string;
  persistent?: boolean;
  showHandle?: boolean;
}>(), {
  height: '85%',
  persistent: false,
  showHandle: true,
});

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'close'): void;
}>();

const entering = ref(false);
const leaving = ref(false);

watch(() => props.modelValue, (val) => {
  if (val) {
    entering.value = true;
    setTimeout(() => { entering.value = false; }, 300);
  }
});

function close() {
  if (props.persistent) return;
  leaving.value = true;
  setTimeout(() => {
    leaving.value = false;
    emit('update:modelValue', false);
    emit('close');
  }, 300);
}

function onBackdropClick() {
  if (!props.persistent) close();
}
</script>

<style scoped>
.bottom-sheet-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  z-index: 100;
  display: flex;
  align-items: flex-end;
}

.bottom-sheet-container {
  width: 100%;
  background: #1a1a1a;
  border-radius: 16px 16px 0 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transform: translateY(0);
  transition: transform 0.3s ease-out;
}

.bottom-sheet-enter {
  animation: slideUp 0.3s ease-out;
}

.bottom-sheet-leave {
  animation: slideDown 0.3s ease-out;
}

@keyframes slideUp {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

@keyframes slideDown {
  from { transform: translateY(0); }
  to { transform: translateY(100%); }
}

.bottom-sheet-handle {
  display: flex;
  justify-content: center;
  padding: 8px 0 4px;
}

.handle-bar {
  width: 36px;
  height: 4px;
  background: #444;
  border-radius: 2px;
}

.bottom-sheet-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  border-bottom: 1px solid #2a2a2a;
}

.bottom-sheet-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}
</style>
```

- [ ] **Step 3: Commit**

```bash
git add src/sidepanel/composables/useBottomSheet.ts src/sidepanel/components/BottomSheet.vue
git commit -m "feat(mini-gero): add BottomSheet component and composable"
```

### Task 1.5: BottomNav + MiniHeader + MiniLayout

**Files:**
- Create: `src/sidepanel/components/BottomNav.vue`
- Create: `src/sidepanel/components/MiniHeader.vue`
- Create: `src/sidepanel/composables/useMiniNavigation.ts`
- Create: `src/sidepanel/layouts/MiniLayout.vue`

- [ ] **Step 1: Create useMiniNavigation composable**

```typescript
import { computed } from 'vue';
import { useRoute } from '@/shared/composables/useRouter';

export interface NavTab {
  name: string;
  icon: string;
  activeIcon: string;
  route: string;
  center?: boolean;
}

export const navTabs: NavTab[] = [
  { name: 'home', icon: 'mdi-home-outline', activeIcon: 'mdi-home', route: '/' },
  { name: 'staking', icon: 'mdi-finance', activeIcon: 'mdi-finance', route: '/staking' },
  { name: 'card', icon: 'mdi-credit-card-outline', activeIcon: 'mdi-credit-card', route: '/card', center: true },
  { name: 'cashback', icon: 'mdi-cash-multiple', activeIcon: 'mdi-cash-multiple', route: '/cashback' },
  { name: 'activity', icon: 'mdi-history', activeIcon: 'mdi-history', route: '/activity' },
];

export function useMiniNavigation() {
  const route = useRoute();
  const activeTab = computed(() => route.value.path);
  return { navTabs, activeTab };
}
```

Note: If `useRoute()` is not available as a composable in the existing codebase, use `getCurrentInstance()!.proxy.$route` instead (this is the Vue 2.7 pattern used elsewhere).

- [ ] **Step 2: Create BottomNav.vue**

```vue
<template>
  <nav class="bottom-nav">
    <button
      v-for="tab in navTabs"
      :key="tab.route"
      class="nav-tab"
      :class="{ active: activeTab === tab.route, center: tab.center }"
      @click="$router.push(tab.route)"
    >
      <v-icon :size="tab.center ? 28 : 22" :color="activeTab === tab.route ? '#00c7f3' : '#888'">
        {{ activeTab === tab.route ? tab.activeIcon : tab.icon }}
      </v-icon>
    </button>
  </nav>
</template>

<script setup lang="ts">
import { useMiniNavigation } from '../composables/useMiniNavigation';

const { navTabs, activeTab } = useMiniNavigation();
</script>

<style scoped>
.bottom-nav {
  display: flex;
  justify-content: space-around;
  align-items: center;
  height: 56px;
  background: #0f0f0f;
  border-top: 1px solid #1e1e1e;
  padding: 0 8px;
  flex-shrink: 0;
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
  background: #1a1a1a;
}

.nav-tab.active {
  background: rgba(0, 199, 243, 0.1);
}

.nav-tab.center {
  width: 52px;
  height: 52px;
  background: #1a1a1a;
  border-radius: 16px;
  margin-top: -8px;
}

.nav-tab.center.active {
  background: rgba(0, 199, 243, 0.15);
}
</style>
```

- [ ] **Step 3: Create MiniHeader.vue**

```vue
<template>
  <header class="mini-header">
    <div class="header-left" @click="$emit('wallet-switch')">
      <v-avatar size="28" class="mr-2">
        <v-icon size="20" color="white">mdi-wallet</v-icon>
      </v-avatar>
      <span class="wallet-name text-body-2 white--text text-truncate">
        {{ walletName }}
      </span>
      <v-icon size="14" color="#888" class="ml-1">mdi-chevron-down</v-icon>
    </div>
    <div class="header-right">
      <v-btn icon x-small @click="openFullDashboard" class="toolbar-btn">
        <v-icon size="18" color="#888">mdi-arrow-expand</v-icon>
      </v-btn>
      <v-btn icon x-small @click="$emit('settings')" class="toolbar-btn">
        <v-icon size="18" color="#888">mdi-cog-outline</v-icon>
      </v-btn>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { walletStore } from '@/stores/walletStore';

const walletName = computed(() => walletStore.loggedWallet?.name || 'Wallet');

function openFullDashboard() {
  chrome.tabs.create({ url: chrome.runtime.getURL('options/index.html') });
}
</script>

<style scoped>
.mini-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  height: 48px;
  background: #0f0f0f;
  border-bottom: 1px solid #1e1e1e;
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  cursor: pointer;
  max-width: 60%;
}

.wallet-name {
  max-width: 120px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.toolbar-btn {
  width: 32px;
  height: 32px;
}
</style>
```

- [ ] **Step 4: Create MiniLayout.vue**

```vue
<template>
  <div class="mini-layout">
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
</script>

<style scoped>
.mini-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #0a0a0a;
  overflow: hidden;
}

.mini-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}
</style>
```

- [ ] **Step 5: Commit**

```bash
git add src/sidepanel/components/BottomNav.vue src/sidepanel/components/MiniHeader.vue src/sidepanel/composables/useMiniNavigation.ts src/sidepanel/layouts/MiniLayout.vue
git commit -m "feat(mini-gero): add BottomNav, MiniHeader, and MiniLayout"
```

### Task 1.6: App.vue with Wallet State Guard

**Files:**
- Create: `src/sidepanel/App.vue`
- Create: `src/sidepanel/components/NoWalletScreen.vue`
- Create: `src/sidepanel/components/LockScreen.vue`
- Create: `src/sidepanel/components/WalletSelector.vue`

- [ ] **Step 1: Create NoWalletScreen.vue**

```vue
<template>
  <div class="no-wallet-screen">
    <div class="content">
      <v-icon size="64" color="#00c7f3" class="mb-4">mdi-wallet-plus-outline</v-icon>
      <h2 class="white--text text-h5 mb-2">{{ $t('welcome.welcome') }}</h2>
      <p class="grey--text text-body-2 text-center mb-6">
        {{ $t('welcome.createOrImport') }}
      </p>
      <v-btn class="geroButton" rounded depressed @click="openDashboard">
        {{ $t('welcome.getStarted') }}
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
function openDashboard() {
  chrome.tabs.create({ url: chrome.runtime.getURL('options/index.html#/welcome') });
}
</script>

<style scoped>
.no-wallet-screen {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  background: #0a0a0a;
}

.content {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px;
}
</style>
```

- [ ] **Step 2: Create WalletSelector.vue**

A simple wallet list for multi-wallet selection. Tapping a wallet triggers login.

```vue
<template>
  <div class="wallet-selector">
    <div class="selector-header">
      <v-icon size="48" color="#00c7f3" class="mb-3">mdi-wallet</v-icon>
      <h2 class="white--text text-h6">{{ $t('welcome.selectWallet') }}</h2>
    </div>
    <div class="wallet-list">
      <div
        v-for="wallet in wallets"
        :key="wallet.id"
        class="wallet-item"
        @click="$emit('select', wallet)"
      >
        <v-avatar size="36" :color="wallet.theme || '#1a1a1a'">
          <v-icon size="20" color="white">mdi-wallet</v-icon>
        </v-avatar>
        <div class="wallet-info">
          <span class="white--text text-body-2">{{ wallet.name }}</span>
        </div>
        <v-icon size="18" color="#888">mdi-chevron-right</v-icon>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { geroStore } from '@/stores/geroStore';

const wallets = computed(() => geroStore.wallets || []);

defineEmits<{
  (e: 'select', wallet: any): void;
}>();
</script>

<style scoped>
.wallet-selector {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #0a0a0a;
  padding: 32px 16px;
}

.selector-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 24px;
}

.wallet-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.wallet-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: #1a1a1a;
  border-radius: 12px;
  cursor: pointer;
  transition: background 0.2s;
}

.wallet-item:hover {
  background: #222;
}

.wallet-info {
  flex: 1;
  display: flex;
  flex-direction: column;
}
</style>
```

- [ ] **Step 3: Create LockScreen.vue**

A simplified lock screen. The full unlock logic (PIN/pattern/password/PassKey) is complex — for v1, support spending password unlock with a "Forgot?" link to the full dashboard. PIN/pattern/PassKey support can be added iteratively.

```vue
<template>
  <div class="lock-screen">
    <div class="content">
      <v-icon size="48" color="#00c7f3" class="mb-4">mdi-lock-outline</v-icon>
      <h2 class="white--text text-h6 mb-1">{{ $t('welcome.walletLocked') }}</h2>
      <p class="grey--text text-body-2 mb-4">{{ walletName }}</p>

      <v-text-field
        v-model="password"
        :type="showPassword ? 'text' : 'password'"
        :placeholder="$t('welcome.enterPassword')"
        outlined
        dense
        dark
        hide-details
        class="mb-3"
        :append-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
        @click:append="showPassword = !showPassword"
        @keydown.enter="unlock"
        :error="!!error"
      />

      <p v-if="error" class="red--text text-caption mb-2">{{ error }}</p>

      <v-btn
        class="geroButton"
        block
        rounded
        depressed
        :loading="loading"
        :disabled="!password"
        @click="unlock"
      >
        {{ $t('welcome.unlock') }}
      </v-btn>

      <v-btn text small class="mt-3 grey--text" @click="openDashboard">
        {{ $t('welcome.forgotPassword') }}
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';

const password = ref('');
const showPassword = ref(false);
const loading = ref(false);
const error = ref('');

const walletName = computed(() => walletStore.loggedWallet?.name || 'Wallet');

async function unlock() {
  if (!password.value) return;
  loading.value = true;
  error.value = '';

  try {
    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.VERIFY_SPENDING_PASSWORD,
      data: { password: password.value },
    });

    if (response.data.success) {
      // Wallet unlocked — App.vue reactivity will show main UI
    } else {
      error.value = response.data.error || 'Invalid password';
    }
  } catch (e: any) {
    error.value = e.message || 'Unlock failed';
  } finally {
    loading.value = false;
  }
}

function openDashboard() {
  chrome.tabs.create({ url: chrome.runtime.getURL('options/index.html#/welcome') });
}
</script>

<style scoped>
.lock-screen {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  background: #0a0a0a;
}

.content {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px;
  width: 100%;
  max-width: 320px;
}
</style>
```

- [ ] **Step 4: Create App.vue**

The root component that handles wallet state gating above the router. Page components never render unless the wallet is logged in and unlocked.

```vue
<template>
  <v-app dark>
    <!-- No wallet exists -->
    <NoWalletScreen v-if="!hasWallets" />

    <!-- Wallet selection needed -->
    <WalletSelector
      v-else-if="!hasActiveWallet"
      @select="onWalletSelect"
    />

    <!-- Wallet locked -->
    <LockScreen v-else-if="isLocked" />

    <!-- Logged in — show main UI -->
    <template v-else>
      <MiniLayout
        @wallet-switch="showWalletSwitcher = true"
        @settings="showSettings = true"
      />
      <DAppOverlay />
    </template>

    <!-- Wallet switcher bottom sheet (available from header) -->
    <BottomSheet v-model="showWalletSwitcher" :title="$t('welcome.selectWallet')" height="60%">
      <WalletSelector @select="onWalletSwitch" />
    </BottomSheet>

    <!-- Settings bottom sheet -->
    <BottomSheet v-model="showSettings" :title="$t('settings.settings')" height="70%">
      <SettingsSheet @close="showSettings = false" />
    </BottomSheet>
  </v-app>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { geroStore } from '@/stores/geroStore';
import { walletStore } from '@/stores/walletStore';
import MiniLayout from './layouts/MiniLayout.vue';
import NoWalletScreen from './components/NoWalletScreen.vue';
import WalletSelector from './components/WalletSelector.vue';
import LockScreen from './components/LockScreen.vue';
import DAppOverlay from './components/DAppOverlay.vue';
import BottomSheet from './components/BottomSheet.vue';
import SettingsSheet from './components/SettingsSheet.vue';

const showWalletSwitcher = ref(false);
const showSettings = ref(false);

const hasWallets = computed(() => (geroStore.wallets?.length || 0) > 0);
const hasActiveWallet = computed(() => !!walletStore.loggedWallet);
const isLocked = computed(() => walletStore.isLocked);

// Watch locale changes from geroStore
watch(() => geroStore.config?.locale, async (newLocale, oldLocale) => {
  if (!newLocale) return;
  const vm = getCurrentInstance()?.proxy;
  if (!vm?.$i18n || vm.$i18n.locale === newLocale) return;
  if (!oldLocale && newLocale === 'us' && vm.$i18n.locale !== 'us') return;

  const { loadLanguage } = await import('@/plugins/i18n');
  try {
    await loadLanguage(newLocale);
    vm.$i18n.locale = newLocale;
  } catch (error) {
    console.error(`Failed to load language ${newLocale}:`, error);
  }
}, { immediate: true, deep: true });

function onWalletSelect(wallet: any) {
  // Trigger wallet login via background messaging
  // Implementation depends on existing wallet login flow
}

function onWalletSwitch(wallet: any) {
  showWalletSwitcher.value = false;
  onWalletSelect(wallet);
}
</script>
```

Note: `onWalletSelect` needs to call the existing wallet login flow via `Messaging.sendToBackgroundFromOptions()`. The exact message type depends on how `WalletsListLogin.vue` handles it in the full dashboard — look at `src/options/modules/welcome/components/WalletsListLogin.vue` for the pattern.

- [ ] **Step 5: Commit**

```bash
git add src/sidepanel/App.vue src/sidepanel/components/NoWalletScreen.vue src/sidepanel/components/LockScreen.vue src/sidepanel/components/WalletSelector.vue
git commit -m "feat(mini-gero): add App.vue with wallet state guard and lock/selector screens"
```

### Task 1.7: DApp Overlay System

**Files:**
- Create: `src/sidepanel/composables/useDAppOverlay.ts`
- Create: `src/sidepanel/components/DAppOverlay.vue`
- Modify: `src/chrome/background.ts`

- [ ] **Step 1: Create useDAppOverlay composable**

```typescript
import { ref, onMounted, onUnmounted } from 'vue';

export interface DAppRequest {
  type: 'dapp-request';
  method: 'enable' | 'signTx' | 'signData';
  requestId: string;
  payload: any;
}

export function useDAppOverlay() {
  const isVisible = ref(false);
  const currentRequest = ref<DAppRequest | null>(null);
  const requestQueue = ref<DAppRequest[]>([]);
  let port: chrome.runtime.Port | null = null;

  function connect() {
    port = chrome.runtime.connect({ name: 'mini-gero-dapp-channel' });

    port.onMessage.addListener((message: DAppRequest) => {
      if (message.type === 'dapp-request') {
        if (currentRequest.value) {
          // Queue if already showing a request
          requestQueue.value.push(message);
        } else {
          currentRequest.value = message;
          isVisible.value = true;
        }
      }
    });

    port.onDisconnect.addListener(() => {
      // Reconnect if background disconnects (service worker restart)
      setTimeout(() => connect(), 1000);
    });
  }

  function respond(requestId: string, data: any, error: string | null = null) {
    if (port) {
      port.postMessage({
        type: 'dapp-response',
        requestId,
        data,
        error,
      });
    }

    currentRequest.value = null;
    isVisible.value = false;

    // Process next queued request
    if (requestQueue.value.length > 0) {
      const next = requestQueue.value.shift()!;
      currentRequest.value = next;
      isVisible.value = true;
    }
  }

  function approve(data: any) {
    if (currentRequest.value) {
      respond(currentRequest.value.requestId, data);
    }
  }

  function reject(reason = 'user_rejected') {
    if (currentRequest.value) {
      respond(currentRequest.value.requestId, null, reason);
    }
  }

  onMounted(() => connect());
  onUnmounted(() => port?.disconnect());

  return { isVisible, currentRequest, approve, reject };
}
```

- [ ] **Step 2: Create DAppOverlay.vue**

```vue
<template>
  <BottomSheet
    :model-value="isVisible"
    :persistent="true"
    :show-handle="false"
    height="85%"
  >
    <div v-if="currentRequest" class="dapp-overlay">
      <!-- DApp Connect -->
      <div v-if="currentRequest.method === 'enable'" class="dapp-connect">
        <v-icon size="48" color="#00c7f3" class="mb-3">mdi-link-variant</v-icon>
        <h3 class="white--text text-h6 mb-1">{{ $t('dapp.connectRequest') }}</h3>
        <p class="grey--text text-body-2 mb-4">{{ currentRequest.payload?.website }}</p>
        <div class="action-buttons">
          <v-btn outlined rounded dark @click="reject()">{{ $t('common.reject') }}</v-btn>
          <v-btn class="geroButton" rounded depressed @click="approve({ approved: true })">
            {{ $t('common.approve') }}
          </v-btn>
        </div>
      </div>

      <!-- Sign Data -->
      <div v-else-if="currentRequest.method === 'signData'" class="dapp-sign">
        <v-icon size="48" color="#FDA29B" class="mb-3">mdi-file-sign</v-icon>
        <h3 class="white--text text-h6 mb-1">{{ $t('dapp.signDataRequest') }}</h3>
        <p class="grey--text text-body-2 mb-4">{{ currentRequest.payload?.website }}</p>
        <div class="message-preview pa-3 mb-4">
          <p class="white--text text-caption" style="word-break: break-all;">
            {{ currentRequest.payload?.message || currentRequest.payload?.payload }}
          </p>
        </div>
        <div class="action-buttons">
          <v-btn outlined rounded dark @click="reject()">{{ $t('common.reject') }}</v-btn>
          <v-btn class="geroButton" rounded depressed @click="handleSign">
            {{ $t('common.sign') }}
          </v-btn>
        </div>
      </div>

      <!-- Sign Transaction -->
      <div v-else-if="currentRequest.method === 'signTx'" class="dapp-sign-tx">
        <v-icon size="48" color="#FFF59E" class="mb-3">mdi-file-document-edit-outline</v-icon>
        <h3 class="white--text text-h6 mb-1">{{ $t('dapp.signTxRequest') }}</h3>
        <p class="grey--text text-body-2 mb-4">{{ currentRequest.payload?.website }}</p>
        <!-- Transaction details will be expanded by the Flows teammate -->
        <div class="action-buttons">
          <v-btn outlined rounded dark @click="reject()">{{ $t('common.reject') }}</v-btn>
          <v-btn class="geroButton" rounded depressed @click="handleSignTx">
            {{ $t('common.sign') }}
          </v-btn>
        </div>
      </div>
    </div>
  </BottomSheet>
</template>

<script setup lang="ts">
import { useDAppOverlay } from '../composables/useDAppOverlay';
import BottomSheet from './BottomSheet.vue';

const { isVisible, currentRequest, approve, reject } = useDAppOverlay();

async function handleSign() {
  // Signing logic will be implemented by the Flows teammate
  // For now, approve with placeholder
  approve({ signed: true });
}

async function handleSignTx() {
  // Transaction signing logic will be implemented by the Flows teammate
  // For now, approve with placeholder
  approve({ signed: true });
}
</script>

<style scoped>
.dapp-overlay {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px;
}

.message-preview {
  background: #111;
  border-radius: 8px;
  max-height: 120px;
  overflow-y: auto;
  width: 100%;
}

.action-buttons {
  display: flex;
  gap: 12px;
  width: 100%;
  justify-content: center;
  margin-top: 16px;
}

.action-buttons .v-btn {
  flex: 1;
  max-width: 160px;
}
</style>
```

- [ ] **Step 3: Modify background.ts — fix openSidebar and add mini-gero port detection**

In `src/chrome/background.ts`, make these changes:

**a) Fix `openSidebar()` (line ~102-116):** Remove the `setPanelBehavior` call:

```typescript
export async function openSidebar(tabId: number, path: string) {
  if (typeof tabId !== 'number') {
    return null;
  }
  chrome.sidePanel.setOptions({
    tabId,
    path,
    enabled: true,
  });
  // REMOVED: chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false })
  chrome.sidePanel.open({ tabId });
  return tabId;
}
```

**b) Add mini-gero port tracking** (add near the top of the file, after imports):

```typescript
// Mini-gero DApp channel
let miniGeroPort: chrome.runtime.Port | null = null;
const pendingDAppRequests = new Map<string, (response: any) => void>();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'mini-gero-dapp-channel') {
    miniGeroPort = port;

    port.onMessage.addListener((message) => {
      if (message.type === 'dapp-response' && message.requestId) {
        const resolver = pendingDAppRequests.get(message.requestId);
        if (resolver) {
          resolver(message);
          pendingDAppRequests.delete(message.requestId);
        }
      }
    });

    port.onDisconnect.addListener(() => {
      miniGeroPort = null;
      // Reject all pending requests
      for (const [id, resolver] of pendingDAppRequests) {
        resolver({ error: 'mini-gero disconnected' });
        pendingDAppRequests.delete(id);
      }
    });
  }
});

function sendToMiniGero(method: string, payload: any): Promise<any> {
  return new Promise((resolve) => {
    const requestId = crypto.randomUUID();
    pendingDAppRequests.set(requestId, resolve);
    miniGeroPort!.postMessage({
      type: 'dapp-request',
      method,
      requestId,
      payload,
    });
  });
}
```

**c) Set `openPanelOnActionClick: true` at startup** (add in the initialization section of background.ts):

```typescript
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
```

**d) Update DApp method handlers** (`METHOD.enable`, `METHOD.signTx`, `METHOD.signData`): In each handler, add mini-gero port check before the existing popup/sidepanel logic:

```typescript
// Add at the START of each handler:
if (miniGeroPort) {
  try {
    const response = await sendToMiniGero('enable', request.data);
    if (response.error) {
      sendResponse({ id: request.id, data: { error: response.error } });
    } else {
      sendResponse({ id: request.id, data: response.data });
    }
  } catch (e) {
    sendResponse({ id: request.id, data: { error: e.message } });
  }
  return true;
}
// ... existing popup/sidepanel fallback code follows
```

This is the most sensitive change — test thoroughly to ensure existing popup fallback still works when mini-gero is not active.

- [ ] **Step 4: Commit**

```bash
git add src/sidepanel/composables/useDAppOverlay.ts src/sidepanel/components/DAppOverlay.vue src/chrome/background.ts
git commit -m "feat(mini-gero): add DApp overlay system with push-based messaging"
```

### Task 1.8: SettingsSheet + Build Verification

**Files:**
- Create: `src/sidepanel/components/SettingsSheet.vue`

- [ ] **Step 1: Create SettingsSheet.vue**

Essential settings only — network, theme, lock. "All Settings" opens full dashboard.

```vue
<template>
  <div class="settings-sheet">
    <v-list dark dense class="transparent">
      <v-list-item @click="openFullSettings">
        <v-list-item-icon><v-icon color="#888">mdi-cog</v-icon></v-list-item-icon>
        <v-list-item-content>
          <v-list-item-title class="white--text">{{ $t('settings.allSettings') }}</v-list-item-title>
          <v-list-item-subtitle class="grey--text">{{ $t('settings.openFullDashboard') }}</v-list-item-subtitle>
        </v-list-item-content>
        <v-list-item-action><v-icon color="#888" size="18">mdi-open-in-new</v-icon></v-list-item-action>
      </v-list-item>

      <v-divider dark class="my-2" />

      <v-list-item>
        <v-list-item-icon><v-icon color="#888">mdi-lock-outline</v-icon></v-list-item-icon>
        <v-list-item-content>
          <v-list-item-title class="white--text">{{ $t('settings.lockWallet') }}</v-list-item-title>
        </v-list-item-content>
        <v-list-item-action>
          <v-btn icon small @click="lockWallet"><v-icon color="#888">mdi-lock</v-icon></v-btn>
        </v-list-item-action>
      </v-list-item>
    </v-list>
  </div>
</template>

<script setup lang="ts">
const emit = defineEmits<{ (e: 'close'): void }>();

function openFullSettings() {
  chrome.tabs.create({ url: chrome.runtime.getURL('options/index.html') });
  emit('close');
}

function lockWallet() {
  // Trigger wallet lock via existing mechanism
  // walletStore.isLocked = true triggers App.vue state guard
  emit('close');
}
</script>

<style scoped>
.settings-sheet {
  padding: 0;
}
</style>
```

- [ ] **Step 2: Run build to verify everything compiles**

```bash
npm run build
```

Expected: Build succeeds. Verify `extension/sidepanel/index.html` exists in the output.

- [ ] **Step 3: Commit**

```bash
git add src/sidepanel/components/SettingsSheet.vue
git commit -m "feat(mini-gero): add SettingsSheet and verify build"
```

---

## Chunk 2: Home Page

The Home teammate builds the main landing page. Depends on Shell (Chunk 1) being complete.

### File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/sidepanel/pages/HomePage.vue` | Rewrite (replace placeholder) | Main home page layout |
| `src/sidepanel/components/BalanceSection.vue` | Create | Portfolio value + Buy/Sell button |
| `src/sidepanel/components/QuickActions.vue` | Create | Send, Receive, Swap, Perps circular buttons |
| `src/sidepanel/components/FeaturedCarousel.vue` | Create | Swipeable promo cards |
| `src/sidepanel/components/TokenList.vue` | Create | User's token holdings list |
| `src/sidepanel/components/TokenDetailSheet.vue` | Create | Token detail bottom sheet |

### Task 2.1: BalanceSection Component

**Files:**
- Create: `src/sidepanel/components/BalanceSection.vue`

- [ ] **Step 1: Create BalanceSection.vue**

Shows total portfolio value, change indicator, and Buy/Sell ADA button. Reads from `walletStore` for balance data and `priceStore` for ADA price.

```vue
<template>
  <div class="balance-section">
    <div class="balance-value text-h4 white--text font-weight-bold">
      {{ formattedBalance }}
    </div>
    <div class="balance-change" :class="changePositive ? 'green--text' : 'red--text'">
      <span>{{ changeFormatted }}</span>
      <span class="ml-1">{{ changePercentFormatted }}</span>
    </div>
    <v-btn
      class="geroButton mt-3"
      rounded
      small
      depressed
      @click="openBuySell"
    >
      {{ $t('dashboard.buySellAda') }}
    </v-btn>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { priceStore } from '@/stores/priceStore';

const totalBalance = computed(() => {
  // Calculate total portfolio value from walletStore
  // This should use the existing portfolio calculation logic
  return walletStore.portfolioValue || 0;
});

const formattedBalance = computed(() => {
  return `$${totalBalance.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
});

const changePositive = computed(() => (walletStore.portfolioChange || 0) >= 0);

const changeFormatted = computed(() => {
  const change = walletStore.portfolioChange || 0;
  const prefix = change >= 0 ? '+' : '';
  return `${prefix}$${Math.abs(change).toFixed(2)}`;
});

const changePercentFormatted = computed(() => {
  const pct = walletStore.portfolioChangePercent || 0;
  const prefix = pct >= 0 ? '+' : '';
  return `${prefix}${pct.toFixed(2)}%`;
});

function openBuySell() {
  // Opens Moonpay/Guardarian in external tab (existing flow)
  chrome.tabs.create({ url: 'https://www.moonpay.com/buy/ada' });
}
</script>

<style scoped>
.balance-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px 16px 12px;
}

.balance-change {
  font-size: 13px;
  margin-top: 2px;
}
</style>
```

Note: The exact properties (`portfolioValue`, `portfolioChange`, `portfolioChangePercent`) need to be verified against the actual `walletStore` state. Look at `src/stores/walletStore.ts` and the dashboard's portfolio section for the correct computed values.

- [ ] **Step 2: Commit**

```bash
git add src/sidepanel/components/BalanceSection.vue
git commit -m "feat(mini-gero): add BalanceSection component"
```

### Task 2.2: QuickActions Component

**Files:**
- Create: `src/sidepanel/components/QuickActions.vue`

- [ ] **Step 1: Create QuickActions.vue**

4 circular icon buttons: Send, Receive, Swap, Perps. Each emits an event that HomePage handles by opening the appropriate bottom sheet.

```vue
<template>
  <div class="quick-actions">
    <button v-for="action in actions" :key="action.id" class="action-btn" @click="$emit('action', action.id)">
      <div class="action-icon" :style="{ background: action.bgColor }">
        <v-icon size="20" color="white">{{ action.icon }}</v-icon>
      </div>
      <span class="action-label">{{ action.label }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';

const { t } = useTranslation();

const actions = computed(() => [
  { id: 'send', icon: 'mdi-arrow-top-right', label: t('dashboard.send'), bgColor: 'rgba(0, 223, 243, 0.15)' },
  { id: 'receive', icon: 'mdi-arrow-bottom-left', label: t('dashboard.receive'), bgColor: 'rgba(117, 224, 167, 0.15)' },
  { id: 'swap', icon: 'mdi-swap-horizontal', label: t('swap.swap'), bgColor: 'rgba(253, 162, 155, 0.15)' },
  { id: 'perps', icon: 'mdi-chart-line', label: t('dashboard.perps'), bgColor: 'rgba(183, 148, 244, 0.15)' },
]);

defineEmits<{ (e: 'action', id: string): void }>();
</script>

<style scoped>
.quick-actions {
  display: flex;
  justify-content: center;
  gap: 20px;
  padding: 12px 16px;
}

.action-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  background: none;
  border: none;
  cursor: pointer;
}

.action-icon {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.2s;
}

.action-btn:hover .action-icon {
  transform: scale(1.05);
}

.action-label {
  font-size: 11px;
  color: #aaa;
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/sidepanel/components/QuickActions.vue
git commit -m "feat(mini-gero): add QuickActions component"
```

### Task 2.3: TokenList + FeaturedCarousel + HomePage Assembly

**Files:**
- Create: `src/sidepanel/components/TokenList.vue`
- Create: `src/sidepanel/components/FeaturedCarousel.vue`
- Rewrite: `src/sidepanel/pages/HomePage.vue`

- [ ] **Step 1: Create TokenList.vue**

Scrollable list of user's token holdings. Each item shows: token icon, name, amount, fiat value. Tapping opens a detail sheet.

```vue
<template>
  <div class="token-list">
    <div
      v-for="token in tokens"
      :key="token.fingerprint || token.policyId"
      class="token-item"
      @click="$emit('select', token)"
    >
      <v-avatar size="36" class="mr-3">
        <v-img v-if="token.icon" :src="token.icon" />
        <v-icon v-else color="#888">mdi-currency-usd</v-icon>
      </v-avatar>
      <div class="token-info">
        <span class="white--text text-body-2 font-weight-medium">{{ token.name || token.ticker }}</span>
        <span class="grey--text text-caption">{{ formatAmount(token.amount) }} {{ token.ticker }}</span>
      </div>
      <div class="token-value">
        <span class="white--text text-body-2">${{ formatFiat(token.fiatValue) }}</span>
        <span
          class="text-caption"
          :class="(token.change24h || 0) >= 0 ? 'green--text' : 'red--text'"
        >
          {{ formatChange(token.change24h) }}
        </span>
      </div>
    </div>
    <div v-if="tokens.length === 0" class="empty-state pa-6 text-center">
      <v-icon size="40" color="#444" class="mb-2">mdi-wallet-outline</v-icon>
      <p class="grey--text text-body-2">{{ $t('dashboard.noTokens') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { walletStore } from '@/stores/walletStore';

const tokens = computed(() => {
  // Get token holdings from walletStore
  // The exact structure depends on how walletStore exposes token data
  // Look at the dashboard's asset list for the pattern
  return walletStore.assets || [];
});

function formatAmount(amount: number | string) {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(2)}K`;
  return num.toFixed(num < 1 ? 6 : 2);
}

function formatFiat(value: number) {
  if (!value) return '0.00';
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatChange(change: number | undefined) {
  if (!change) return '';
  const prefix = change >= 0 ? '+' : '';
  return `${prefix}${change.toFixed(2)}%`;
}

defineEmits<{ (e: 'select', token: any): void }>();
</script>

<style scoped>
.token-list {
  padding: 0 12px;
}

.token-item {
  display: flex;
  align-items: center;
  padding: 10px 4px;
  border-bottom: 1px solid #1a1a1a;
  cursor: pointer;
  transition: background 0.2s;
}

.token-item:hover {
  background: #111;
  border-radius: 8px;
}

.token-info {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.token-value {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}
</style>
```

- [ ] **Step 2: Create FeaturedCarousel.vue**

A simple horizontal scrollable card carousel for promos.

```vue
<template>
  <div v-if="cards.length" class="carousel-container">
    <div class="carousel-scroll">
      <div
        v-for="(card, i) in cards"
        :key="i"
        class="carousel-card"
        :style="{ background: card.gradient }"
        @click="card.action?.()"
      >
        <div class="card-content">
          <v-icon size="24" color="white" class="mb-1">{{ card.icon }}</v-icon>
          <span class="white--text text-body-2 font-weight-medium">{{ card.title }}</span>
          <span class="white--text text-caption" style="opacity: 0.7">{{ card.subtitle }}</span>
        </div>
        <v-btn
          v-if="card.dismissible"
          icon
          x-small
          class="dismiss-btn"
          @click.stop="dismiss(i)"
        >
          <v-icon size="14" color="white">mdi-close</v-icon>
        </v-btn>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

interface CarouselCard {
  icon: string;
  title: string;
  subtitle: string;
  gradient: string;
  dismissible?: boolean;
  action?: () => void;
}

const cards = ref<CarouselCard[]>([
  {
    icon: 'mdi-credit-card',
    title: 'Gero Card',
    subtitle: 'Order your crypto debit card',
    gradient: 'linear-gradient(135deg, #1a3a5c, #0f2744)',
    action: () => {
      // Navigate to card tab — handled by parent
    },
  },
]);

function dismiss(index: number) {
  cards.value.splice(index, 1);
}
</script>

<style scoped>
.carousel-container {
  padding: 8px 12px;
}

.carousel-scroll {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  -webkit-overflow-scrolling: touch;
}

.carousel-scroll::-webkit-scrollbar {
  display: none;
}

.carousel-card {
  min-width: calc(100% - 24px);
  border-radius: 12px;
  padding: 14px;
  position: relative;
  cursor: pointer;
  scroll-snap-align: start;
}

.card-content {
  display: flex;
  flex-direction: column;
}

.dismiss-btn {
  position: absolute;
  top: 8px;
  right: 8px;
}
</style>
```

- [ ] **Step 3: Rewrite HomePage.vue**

```vue
<template>
  <div class="home-page">
    <BalanceSection />
    <QuickActions @action="handleAction" />
    <FeaturedCarousel />
    <div class="section-header px-4 mt-2 mb-1">
      <span class="white--text text-subtitle-2 font-weight-bold">{{ $t('dashboard.tokens') }}</span>
    </div>
    <TokenList @select="selectedToken = $event; showTokenDetail = true" />

    <BottomSheet v-model="showTokenDetail" :title="selectedToken?.name" height="75%">
      <!-- Token detail content — can be expanded later -->
      <div v-if="selectedToken" class="pa-4">
        <p class="white--text">{{ selectedToken.name }}</p>
        <p class="grey--text">{{ selectedToken.amount }} {{ selectedToken.ticker }}</p>
      </div>
    </BottomSheet>

    <!-- Quick action bottom sheets will be implemented by Flows teammate -->
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import BalanceSection from '../components/BalanceSection.vue';
import QuickActions from '../components/QuickActions.vue';
import FeaturedCarousel from '../components/FeaturedCarousel.vue';
import TokenList from '../components/TokenList.vue';
import BottomSheet from '../components/BottomSheet.vue';

const selectedToken = ref<any>(null);
const showTokenDetail = ref(false);

function handleAction(id: string) {
  // Quick action bottom sheets will be implemented by the Flows teammate
  // For now, log the action
  console.log('Quick action:', id);
}
</script>

<style scoped>
.home-page {
  padding-bottom: 8px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
```

- [ ] **Step 4: Commit**

```bash
git add src/sidepanel/components/TokenList.vue src/sidepanel/components/FeaturedCarousel.vue src/sidepanel/pages/HomePage.vue
git commit -m "feat(mini-gero): add HomePage with TokenList, FeaturedCarousel, and QuickActions"
```

---

## Chunk 3: Card Page

The Card teammate builds the full Gero Card experience adapted for 400px. Depends on Shell (Chunk 1).

### File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/sidepanel/pages/CardPage.vue` | Rewrite | State machine: auth → new → pending → approved |
| `src/sidepanel/components/card/CardAuthView.vue` | Create | Login/Register buttons |
| `src/sidepanel/components/card/CardNewView.vue` | Create | Order CTA + feature highlights |
| `src/sidepanel/components/card/CardPendingView.vue` | Create | KYC review progress |
| `src/sidepanel/components/card/CardApprovedView.vue` | Create | Card visual + balance + actions + tx history |
| `src/sidepanel/components/card/MiniCardVisual.vue` | Create | Simplified flat card display |
| `src/sidepanel/components/card/TopUpSheet.vue` | Create | Top-up wizard bottom sheet |
| `src/sidepanel/components/card/ManageSheet.vue` | Create | View PIN, block/unblock |

This is the most complex page. Each state maps to a view component. All sub-flows use BottomSheet.

**Implementation approach**: Reuse all business logic from `src/stores/modules/card.ts` (card store) and the KaiserEx API. Only build new Vue components for the 400px-wide UI.

**Key reference files** the Card agent should read before implementing:
- `src/stores/modules/card.ts` — Card store (state, actions, API calls)
- `src/modules/wallet/GeroCard.vue` — State machine pattern
- `src/modules/wallet/components/KaiserexAuthPage.vue` — Auth flow
- `src/modules/wallet/pages/HomeSection.vue` — Approved state dashboard
- `src/modules/wallet/components/dashboard/TopUpModal.vue` — Top-up wizard
- `src/modules/wallet/components/dashboard/ManageCardModal.vue` — Manage card
- `src/services/kaiserEx.service.ts` — KaiserEx OAuth service

Each task in this chunk follows the same pattern: read the existing component, extract the business logic calls, build a new compact UI that calls the same store/API methods.

**Due to the complexity, this chunk provides the CardPage state machine and the approved view as detailed tasks. The auth/new/pending views and sub-flow sheets follow the same pattern and are defined as follow-up tasks with less code detail, since the Card agent should be proficient enough to follow the pattern after the first two tasks.**

### Task 3.1: CardPage State Machine

- [ ] **Step 1: Read the existing GeroCard.vue to understand the state machine**

Read: `src/modules/wallet/GeroCard.vue` and `src/composables/useWalletStatus.ts`

- [ ] **Step 2: Rewrite CardPage.vue with state machine**

```vue
<template>
  <div class="card-page">
    <CardAuthView v-if="state === 'auth'" @authenticated="initialize" />
    <CardNewView v-else-if="state === 'new'" />
    <CardPendingView v-else-if="state === 'pending'" />
    <CardApprovedView v-else-if="state === 'approved'" />
    <div v-else class="loading-state">
      <v-progress-circular indeterminate color="#00c7f3" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import cardStore from '@/stores/modules/card';
import CardAuthView from '../components/card/CardAuthView.vue';
import CardNewView from '../components/card/CardNewView.vue';
import CardPendingView from '../components/card/CardPendingView.vue';
import CardApprovedView from '../components/card/CardApprovedView.vue';

const state = computed(() => cardStore.walletStatus?.currentState || 'loading');

async function initialize() {
  await cardStore.initialize();
}

onMounted(() => {
  if (cardStore.accessToken) {
    initialize();
  }
});
</script>
```

- [ ] **Step 3: Create placeholder view components**

Create `src/sidepanel/components/card/` directory with placeholder files for `CardAuthView.vue`, `CardNewView.vue`, `CardPendingView.vue`, `CardApprovedView.vue`.

- [ ] **Step 4: Commit**

```bash
git add src/sidepanel/pages/CardPage.vue src/sidepanel/components/card/
git commit -m "feat(mini-gero): add CardPage state machine with placeholder views"
```

### Task 3.2-3.5: Card View Components

The Card agent implements each view by following the existing dashboard component as a reference and building a compact 400px version. Key tasks:

- **Task 3.2: CardAuthView** — Login/Register buttons using `kaiserEx.service.ts` OAuth flow. Reference: `KaiserexAuthPage.vue`
- **Task 3.3: CardNewView** — Order CTA with feature highlights. Reference: `OrderCardSection.vue`
- **Task 3.4: CardPendingView** — KYC progress display. Reference: `PendingSection.vue`
- **Task 3.5: CardApprovedView** — Card visual + balance + actions + recent transactions. Reference: `HomeSection.vue`, `HeroSection.vue`, `CardCarousel.vue`

### Task 3.6-3.8: Card Sub-Flow Sheets

- **Task 3.6: TopUpSheet** — Amount → Summary → Sign → Success. Reference: `TopUpModal.vue` and `src/modules/wallet/components/dashboard/top-up/` steps
- **Task 3.7: ManageSheet** — View PIN, block/unblock. Reference: `ManageCardModal.vue`
- **Task 3.8: OrderSheet** — Card type → Address → Shipping → Payment. Reference: `OrderCardFlowModal.vue` and `src/modules/wallet/components/dashboard/card-order-steps/`

---

## Chunk 4: Staking Page

The Staking teammate builds the combined stakepool + governance page. Depends on Shell (Chunk 1).

### File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/sidepanel/pages/StakingPage.vue` | Rewrite | Segmented toggle + status card + pool/DRep views |
| `src/sidepanel/components/staking/StakingStatusCard.vue` | Create | Current pool, DRep, rewards |
| `src/sidepanel/components/staking/PoolListView.vue` | Create | Searchable pool list |
| `src/sidepanel/components/staking/GovernanceView.vue` | Create | DRep list + delegation |
| `src/sidepanel/components/staking/DelegateSheet.vue` | Create | Delegation confirmation sheet |
| `src/sidepanel/components/staking/ClaimRewardsSheet.vue` | Create | Rewards claim flow |

**Key reference files:**
- `src/stores/stakingStore.ts` — Staking pools, delegation state
- `src/stores/governanceStore.ts` — DRep state, voting power
- `src/modules/staking/` — Existing staking UI components
- `src/modules/governance/` — Existing governance UI components
- `src/shared/utils/builder.ts` — Transaction building for delegation

### Task 4.1: StakingPage with Segmented Toggle + Status Card

- [ ] **Step 1: Read existing staking/governance stores and components**

Read: `src/stores/stakingStore.ts`, `src/stores/governanceStore.ts`, `src/modules/staking/Staking.vue`

- [ ] **Step 2: Create StakingStatusCard.vue**

Shows current stakepool, current DRep, and claimable rewards — always visible at the top.

- [ ] **Step 3: Rewrite StakingPage.vue**

Segmented toggle ("Stakepool" | "Governance") at top, status card below, then the active view.

- [ ] **Step 4: Commit**

### Task 4.2-4.4: Pool List, Governance View, Delegation Sheets

- **Task 4.2: PoolListView** — Search + sortable pool list (ticker, ROA, saturation). Reference: existing staking pool list components.
- **Task 4.3: GovernanceView** — DRep list + delegation. Reference: existing governance components.
- **Task 4.4: DelegateSheet + ClaimRewardsSheet** — Confirmation bottom sheets for delegation and reward claiming.

---

## Chunk 5: Flows (Activity, Cashback, Quick Actions, DApp Signing)

The Flows teammate builds the remaining pages and all quick action bottom sheet flows. Depends on Shell (Chunk 1).

### File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/sidepanel/pages/ActivityPage.vue` | Rewrite | Transaction history list |
| `src/sidepanel/pages/CashbackPage.vue` | Rewrite | Bring cashback offers list |
| `src/sidepanel/components/flows/SendSheet.vue` | Create | Send flow (token → address → amount → review → sign) |
| `src/sidepanel/components/flows/ReceiveSheet.vue` | Create | QR code + address copy |
| `src/sidepanel/components/flows/SwapSheet.vue` | Create | Swap widget (from/to → amount → quote → confirm) |
| `src/sidepanel/components/flows/PerpsStubSheet.vue` | Create | Read-only positions stub |
| `src/sidepanel/components/flows/TxDetailSheet.vue` | Create | Transaction detail bottom sheet |
| `src/sidepanel/components/flows/CashbackDetailSheet.vue` | Create | Cashback offer detail |

**Key reference files:**
- `src/stores/walletStore.ts` — Transaction data, UTXOs
- `src/stores/dexHunterStore.ts` — Swap aggregation
- `src/stores/bringStore.ts` — Cashback data
- `src/modules/transactions/` — Existing transaction components
- `src/modules/swap/` — Existing swap components
- `src/modules/cashback/` — Existing cashback components
- `src/shared/utils/builder.ts` — Transaction building
- `src/popup/modules/views/DappConnect.vue` — DApp connect logic
- `src/popup/modules/views/DappSignData.vue` — Sign data logic
- `src/popup/modules/views/SignTx.vue` — Sign tx logic

### Task 5.1: ActivityPage

- [ ] **Step 1: Rewrite ActivityPage.vue**

Chronological transaction list grouped by date. Each entry: token icon, type badge, amount, truncated address. Tap opens TxDetailSheet.

- [ ] **Step 2: Create TxDetailSheet.vue**

Full transaction details in a bottom sheet: type, amount, from/to addresses, fee, timestamp, explorer link.

- [ ] **Step 3: Commit**

### Task 5.2: CashbackPage

- [ ] **Step 1: Rewrite CashbackPage.vue**

List of Bring cashback offers with merchant logo, cashback %, description. Tap opens detail sheet.

- [ ] **Step 2: Create CashbackDetailSheet.vue**

- [ ] **Step 3: Commit**

### Task 5.3: SendSheet

- [ ] **Step 1: Create SendSheet.vue**

Multi-step send flow inside a bottom sheet: token selection → address input (manual/contacts/paste) → amount (MAX, fiat toggle) → review (fee, total) → sign & submit. Reuses transaction building logic from `src/shared/utils/builder.ts`.

- [ ] **Step 2: Commit**

### Task 5.4: ReceiveSheet

- [ ] **Step 1: Create ReceiveSheet.vue**

QR code display of wallet receive address + address text with copy button. Uses `qrcode` library already in the project.

- [ ] **Step 2: Commit**

### Task 5.5: SwapSheet

- [ ] **Step 1: Create SwapSheet.vue**

Swap widget: "From" token selector → "To" token selector → amount input (MAX, 50%) → quote preview (rate, slippage, fees) → review → confirm. Reuses `dexHunterStore` and DEX Hunter API.

- [ ] **Step 2: Commit**

### Task 5.6: PerpsStubSheet

- [ ] **Step 1: Create PerpsStubSheet.vue**

Read-only stub for v1: summary of open positions (if any) + "Open Full Dashboard" button.

- [ ] **Step 2: Commit**

### Task 5.7: Enhance DApp Signing Components

The DAppOverlay from Shell provides the basic structure. This task enhances it with proper signing logic:

- [ ] **Step 1: Read existing signing components**

Read: `src/popup/modules/views/DappConnect.vue`, `DappSignData.vue`, `SignTx.vue`

- [ ] **Step 2: Enhance DAppOverlay with proper signing logic**

Extract the signing flow from existing popup components: password prompt, hardware wallet detection, witness merging, transaction parsing for display.

- [ ] **Step 3: Commit**

### Task 5.8: Wire Quick Action Sheets into HomePage

- [ ] **Step 1: Update HomePage.vue**

Import all flow sheets and wire them to the `handleAction` function:

```typescript
function handleAction(id: string) {
  switch (id) {
    case 'send': showSend.value = true; break;
    case 'receive': showReceive.value = true; break;
    case 'swap': showSwap.value = true; break;
    case 'perps': showPerps.value = true; break;
  }
}
```

Add the BottomSheet wrappers for each flow to the template.

- [ ] **Step 2: Commit**

```bash
git add src/sidepanel/pages/HomePage.vue
git commit -m "feat(mini-gero): wire quick action sheets into HomePage"
```

---

## Integration & Verification

After all chunks are complete:

- [ ] **Run full build**: `npm run build` — verify no errors
- [ ] **Verify output**: Confirm `extension/sidepanel/index.html` exists
- [ ] **Manual test in Chrome**: Load extension, click icon → side panel opens with mini-gero
- [ ] **Test wallet states**: No wallet → shows "Get Started"; locked → shows lock screen; logged in → shows home
- [ ] **Test navigation**: All 5 bottom tabs navigate correctly
- [ ] **Test mode toggle**: Mini header "Full Mode" opens dashboard in new tab
- [ ] **Test DApp signing**: Connect to a dApp → overlay slides up → approve/reject works
- [ ] **Test quick actions**: Send/Receive/Swap open bottom sheets
- [ ] **Test Card page**: Auth → approved flow works end-to-end
