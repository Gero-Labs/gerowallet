import '../shared/styles/tokens.css';
import '@fontsource-variable/inter';            // family: 'Inter Variable', wght axis 100-900
import '@fontsource/jetbrains-mono/400.css';    // family: 'JetBrains Mono'
import '@fontsource/jetbrains-mono/500.css';
import '@mdi/font/css/materialdesignicons.css';
import 'vuetify/styles';
import '../shared/styles/liquid-glass.css';
import '../shared/styles/baseline.css';
import '../shared/styles/vuetify-compat.css';
import '../shared/styles/iso.css';

import { createApp, watch } from 'vue';
import { isPublicRoute } from '@/modules/navigation/helpAccess';

import FlagIcon from '@/shared/components/FlagIcon.vue';
import i18n, { i18nPlugin, loadLanguage } from '../plugins/i18n';
import vuetify from '../plugins/vuetify';
import router from '../modules/navigation/router';
import { ClickOutside } from 'vuetify/directives';
import App from './App.vue';
import { geroStore, type GeroStore } from '@/stores/geroStore';
import Notifications from '@/shared/components/ToastNotifications.vue';
import featureFlagsStore from '@/stores/featureFlagsStore';
import { walletStore as walletStoreState, hydrateWalletStore } from '@/stores/walletStore';
import { activityTracker } from '@/services/activityTracker.service';
import { waitForOptionsStartup } from './startup';

type SavedStartupState = { geroStore?: Partial<GeroStore>; walletStore?: { config?: { locale?: string } } };

function loadPersistedGero(): Promise<void> {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get<SavedStartupState>('geroStore', ({ geroStore: saved } = {}) => {
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

async function loadSavedLocale(): Promise<void> {
  const initialLocale = i18n.locale;
  const locale = await new Promise<string>((resolve, reject) => {
    chrome.storage.local.get<SavedStartupState>(['walletStore', 'geroStore'], (saved = {}) => {
      if (chrome.runtime.lastError) {
        reject(new Error('Locale storage read failed'));
        return;
      }
      resolve(saved.geroStore?.config?.locale || saved.walletStore?.config?.locale || 'us');
    });
  });
  if (locale !== 'us') await loadLanguage(locale);
  // A late startup read must not reverse a language change made after mount.
  if (i18n.locale === initialLocale) i18n.locale = locale;
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

// Normally hydrate before navigation, but never leave the page blank for a
// storage read that does not settle. Existing route guards still enforce login,
// lock, and sync state; the watcher below reconciles a late hydration.
void waitForOptionsStartup({
  geroStore: loadPersistedGero,
  walletStore: hydrateWalletStore,
  locale: loadSavedLocale,
}).then(() => {
  // Initialize feature flags in background (non-blocking)
  // This prevents delaying app startup if the flag service is slow/down
  initializeFeatureFlags().catch((error) => {
    console.error('Feature flags initialization failed:', error);
  });

  const app = createApp(App);
  app.use(vuetify);
  app.use(i18nPlugin);
  app.use(router);
  app.directive('click-outside', ClickOutside);
  app.component('flag', FlagIcon);
  app.component('notifications', Notifications);
  app.mount('#app');
  // Initialize activity tracker based on wallet state
  const checkAndStartActivityTracker = () => {
    if (walletStoreState.loggedWallet && !walletStoreState.isLocked) {
      activityTracker.start();
    } else {
      activityTracker.stop();
    }
  };

  // Start/stop activity tracker based on wallet locked state
  const stopActivity = watch(
    () => [walletStoreState.loggedWallet, walletStoreState.isLocked],
    () => {
      checkAndStartActivityTracker();
    },
    { immediate: true }
  );

  // Redirect to welcome page when wallet is locked — except the two signing
  // popups. passkey-auth runs the unlock ceremony itself and must stay on its
  // route while locked. ledger-ble-sign must stay too: navigating it away
  // leaves no beforeunload, so the side panel that opened it would wait out
  // its full timeout instead of seeing a cancellation.
  const stopLock = watch(
    () => walletStoreState.isLocked,
    (isLocked) => {
      if (isLocked
        && !isPublicRoute(router.currentRoute.value)
        && router.currentRoute.value.path !== '/welcome'
        && router.currentRoute.value.name !== 'passkey-auth'
        && router.currentRoute.value.name !== 'ledger-ble-sign') {
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
  const reconcileReadyRoute = () => {
    const ready = walletStoreState.loggedWallet
      && !walletStoreState.isLocked
      && !walletStoreState.isSyncing;
    if (ready && router.currentRoute.value.path === '/welcome' && router.currentRoute.value.query['addWallet'] !== '1') {
      const redirect = router.currentRoute.value.query['redirect'];
      const target = typeof redirect === 'string' && redirect.startsWith('/') && !redirect.startsWith('//')
        ? redirect : '/';
      // Go through the existing route guards again, including chain and
      // feature gates, rather than displaying a protected view directly.
      router.replace(target).catch(() => { /* swallow navigation failures */ });
    }
  };
  const stopReady = watch(
    () => [walletStoreState.loggedWallet, walletStoreState.isLocked, walletStoreState.isSyncing] as const,
    reconcileReadyRoute,
    { immediate: true }
  );
  void router.isReady().then(reconcileReadyRoute);
  app.onUnmount(() => { stopActivity(); stopLock(); stopReady(); });
});
