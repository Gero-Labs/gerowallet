import '@mdi/font/css/materialdesignicons.css';
import 'vuetify/dist/vuetify.min.css';
import '../shared/styles/liquid-glass.css';

import Vue from 'vue';
import VueRouter from 'vue-router';
import FlagIcon from 'vue-flag-icon';
import VueShowdown from 'vue-showdown'
import i18n from '../plugins/i18n';
import vuetify from '../plugins/vuetify';
import router from '../modules/navigation/router';
import { ClickOutside } from 'vuetify/lib/directives';
import App from './App.vue';
import walletStore from '@/stores/geroStore';
import Notifications from '@voerro/vue-notifications';
import featureFlagsStore from '@/stores/featureFlagsStore';
import { walletStore as walletStoreState } from '@/stores/walletStore';
import { activityTracker } from '@/services/activityTracker.service';

function loadPersistedWallet(): Promise<void> {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get('walletStore', ({ walletStore: saved }) => {
        if (chrome.runtime.lastError) {
          console.warn('Chrome storage error:', chrome.runtime.lastError.message);
          resolve();
          return;
        }
        if (saved) Object.assign(walletStore, saved);
        resolve();
      });
    } catch (error) {
      console.warn('Error loading persisted wallet:', error);
      resolve();
    }
  });
}

async function initializeFeatureFlags(): Promise<void> {
  //@ts-ignore
  const ldClientId = import.meta.env.VITE_LD_CLIENT_SIDE_ID;
  if (ldClientId) {
    try {
      await featureFlagsStore.initialize(ldClientId);
    } catch (error) {
      console.error('Failed to initialize feature flags:', error);
    }
  } else {
    console.warn('LaunchDarkly client ID not found in environment');
  }
}

loadPersistedWallet().then(() => {
  // Initialize feature flags in background (non-blocking)
  // This prevents delaying app startup if LaunchDarkly is slow/down
  initializeFeatureFlags().catch((error) => {
    console.error('Feature flags initialization failed:', error);
  });

  Vue.config.productionTip = false;
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
    chrome.storage.local.get('walletStore', ({ walletStore: saved }) => {
      if (saved?.loggedWallet?.id && saved?.config?.locale) {
        console.log('🌐 Setting initial locale from storage:', saved.config.locale);
        i18n.locale = saved.config.locale;
      } else {
        console.log('🌐 Using default locale: us');
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
          console.log('🔒 Wallet locked, redirecting to welcome page');
          router.push('/welcome');
        }
      }
    );
  });
});
