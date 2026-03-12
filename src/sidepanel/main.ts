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
