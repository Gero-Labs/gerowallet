import '../shared/styles/tokens.css';
import '@mdi/font/css/materialdesignicons.css';
import 'vuetify/dist/vuetify.min.css';
import '../shared/styles/liquid-glass.css';

import Vue from 'vue';
import VueRouter from 'vue-router';
import FlagIcon from 'vue-flag-icon';
import VueShowdown from 'vue-showdown'
import i18n, { loadLanguage } from '../plugins/i18n';
import vuetify from '../plugins/vuetify';
import router from '../modules/navigation/router';
import { ClickOutside } from 'vuetify/lib/directives';
import App from './App.vue';
import { geroStore } from '@/stores/geroStore';
import Notifications from '@voerro/vue-notifications';
import featureFlagsStore from '@/stores/featureFlagsStore';
import { walletStore as walletStoreState, hydrateWalletStore } from '@/stores/walletStore';
import { activityTracker } from '@/services/activityTracker.service';

function loadPersistedGero(): Promise<void> {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get('geroStore', ({ geroStore: saved }) => {
        if (chrome.runtime.lastError) {
          console.warn('Chrome storage error:', chrome.runtime.lastError.message);
          resolve();
          return;
        }
        if (saved) Object.assign(geroStore, saved);
        resolve();
      });
    } catch (error) {
      console.warn('Error loading persisted gero store:', error);
      resolve();
    }
  });
}

async function initializeFeatureFlags(): Promise<void> {
  //@ts-ignore
  const flagsBaseUrl = import.meta.env.VITE_FLAGS_BASE_URL;
  if (flagsBaseUrl) {
    try {
      await featureFlagsStore.initialize(flagsBaseUrl);
    } catch (error) {
      console.error('Failed to initialize feature flags:', error);
    }
  } else {
    console.warn('Feature flags base URL not found in environment');
  }
}

// Hydrate BOTH stores from chrome.storage before mounting Vue. Without this,
// the router's beforeEach runs with a null loggedWallet and redirects to
// /welcome; the later async side-effect hydration in walletStore.ts completes
// *after* the watcher is registered, but `$watch` only fires on changes from
// that point forward, so the initial /welcome redirect is never corrected
// when a wallet was actually logged in (e.g., via the side panel).
Promise.all([loadPersistedGero(), hydrateWalletStore()]).then(() => {
  // Initialize feature flags in background (non-blocking)
  // This prevents delaying app startup if the flag service is slow/down
  initializeFeatureFlags().catch((error) => {
    console.error('Feature flags initialization failed:', error);
  });

  Vue.config.productionTip = false;
  Vue.config.ignoredElements = [...(Vue.config.ignoredElements || []), 'gero-swap'];
  Vue.use(FlagIcon);
  Vue.use(VueShowdown, {
    flavor: 'github',
    options: {
      emoji: false,
    },
  })

  Vue.use(VueRouter);
  Vue.directive('click-outside', ClickOutside);
  Vue.component('notifications', Notifications);

  return new Promise<void>((resolve) => {
    chrome.storage.local.get(['walletStore', 'geroStore'], async ({ walletStore: saved, geroStore }) => {
      // Priority: geroStore.config.locale (global) -> walletStore.config.locale (wallet-specific) -> 'us'
      const locale = geroStore?.config?.locale || saved?.config?.locale || 'us';

      if (locale !== 'us') {
        try {
          // CRITICAL: Load language file BEFORE setting locale
          await loadLanguage(locale);
          i18n.locale = locale;
        } catch (error) {
          console.error('Failed to load language file:', locale, error);
          i18n.locale = 'us'; // Fallback to English
        }
      }
      resolve();
    });
  }).then(() => {
    const app = new Vue({
      vuetify,
      i18n,
      router,
      render: h => h(App)
    }).$mount('#app');

    // Initialize activity tracker based on wallet state
    const checkAndStartActivityTracker = () => {
      if (walletStoreState.loggedWallet && !walletStoreState.isLocked) {
        activityTracker.start();
      } else {
        activityTracker.stop();
      }
    };

    // Start/stop activity tracker based on wallet locked state
    app.$watch(
      () => [walletStoreState.loggedWallet, walletStoreState.isLocked],
      () => {
        checkAndStartActivityTracker();
      },
      { immediate: true }
    );

    // Redirect to welcome page when wallet is locked
    app.$watch(
      () => walletStoreState.isLocked,
      (isLocked) => {
        if (isLocked && router.currentRoute.path !== '/welcome') {
          router.push('/welcome');
        }
      }
    );

    // Redirect to dashboard when the wallet becomes fully "ready" (logged in,
    // unlocked, and not syncing) from another context (e.g., side-panel
    // login). Must watch all three flags — not just `loggedWallet` — because:
    //   1. Login sets `isSyncing = true` *before* broadcasting the wallet.
    //   2. When the wallet arrives, the router's beforeEach still sees
    //      `isSyncing === true` and bounces the navigation back to /welcome.
    //   3. A few seconds later sync completes and `isSyncing` flips to false —
    //      if we only watch `loggedWallet`, nothing re-attempts the redirect
    //      and the UI is stranded on /welcome.
    app.$watch(
      () => [walletStoreState.loggedWallet, walletStoreState.isLocked, walletStoreState.isSyncing] as const,
      () => {
        const ready = walletStoreState.loggedWallet
          && !walletStoreState.isLocked
          && !walletStoreState.isSyncing;
        if (ready && router.currentRoute.path === '/welcome') {
          router.push('/').catch(() => { /* swallow redundant-nav errors */ });
        }
      }
    );
  });
});
