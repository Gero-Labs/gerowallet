import '../shared/styles/tokens.css';
import '@mdi/font/css/materialdesignicons.css';
import 'vuetify/dist/vuetify.min.css';
import '../shared/styles/liquid-glass.css';

import Vue from 'vue';
import VueRouter from 'vue-router';
import Notifications from '@voerro/vue-notifications';
import i18n, { loadLanguage } from '../plugins/i18n';
import vuetify from '../plugins/vuetify';
import router from './router';
import App from './App.vue';
import { walletStore } from '@/stores/walletStore';
import { activityTracker } from '@/services/activityTracker.service';
import featureFlagsStore from '@/stores/featureFlagsStore';

Vue.config.productionTip = false;
Vue.config.ignoredElements = [...(Vue.config.ignoredElements || []), 'gero-swap'];
Vue.use(VueRouter);
Vue.component('notifications', Notifications);

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

  // Initialize feature flags (non-blocking, same as options/main.ts).
  //@ts-ignore
  const flagsBaseUrl = import.meta.env.VITE_FLAGS_BASE_URL;
  if (flagsBaseUrl) {
    featureFlagsStore.initialize(flagsBaseUrl).catch(err =>
      console.error('Failed to initialize feature flags:', err)
    );
  }

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
