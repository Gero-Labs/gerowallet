import '@mdi/font/css/materialdesignicons.css';
import 'vuetify/dist/vuetify.min.css';
import '../shared/styles/liquid-glass.css';

import Vue from 'vue';
import VueRouter from 'vue-router';
import i18n, { loadLanguage } from '../plugins/i18n';
import vuetify from '../plugins/vuetify';
import router from '../modules/navigation/router';

import App from './Sidepanel.vue';

Vue.config.productionTip = false;
Vue.use(VueRouter);

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

  new Vue({
    vuetify,
    i18n,
    router,
    render: h => h(App)
  }).$mount('#app');
});
