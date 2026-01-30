import '@mdi/font/css/materialdesignicons.css';
import 'vuetify/dist/vuetify.min.css';
import '../shared/styles/liquid-glass.css';

import Vue from 'vue';
import VueRouter from 'vue-router';
import i18n from '../plugins/i18n';
import vuetify from '../plugins/vuetify';
import router from '../modules/navigation/router';

import App from './Sidepanel.vue';

Vue.config.productionTip = false;
Vue.use(VueRouter);

chrome.storage.local.get(['walletStore', 'geroStore'], ({ walletStore: saved, geroStore }) => {
  // Priority: geroStore.config.locale (global) -> walletStore.config.locale (wallet-specific) -> 'us'
  const locale = geroStore?.config?.locale || saved?.config?.locale || 'us';

  if (locale !== 'us') {
    console.log('🌐 Sidepanel: Setting initial locale:', locale);
    i18n.locale = locale;
  } else {
    console.log('🌐 Sidepanel: Using default locale: us');
  }

  new Vue({
    vuetify,
    i18n,
    router,
    render: h => h(App)
  }).$mount('#app');
});
