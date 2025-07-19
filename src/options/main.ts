import '@mdi/font/css/materialdesignicons.css';
import 'vuetify/dist/vuetify.min.css';

import Vue from 'vue';
import VueRouter from 'vue-router';
import FlagIcon from 'vue-flag-icon';
import { createPinia, Pinia, PiniaVuePlugin } from 'pinia';
import VueShowdown from 'vue-showdown'
import i18n from '../plugins/i18n';
import vuetify from '../plugins/vuetify';
// VueQrcodeReader imported conditionally below
import router from '../modules/navigation/router';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';
import { ClickOutside } from 'vuetify/lib/directives';
import App from './App.vue';
import walletStore from '@/plugins/geroStore';

function loadPersistedWallet(): Promise<void> {
  return new Promise(resolve => {
    chrome.storage.local.get('walletStore', ({ walletStore: saved }) => {
      if (saved) Object.assign(walletStore, saved);
      resolve();
    });
  });
}

loadPersistedWallet().then(() => {
  Vue.config.productionTip = false;
  Vue.use(FlagIcon);
  // Only register VueQrcodeReader in browser context (not service worker)
  if (typeof document !== 'undefined') {
    import('vue-qrcode-reader').then((VueQrcodeReader) => {
      Vue.use(VueQrcodeReader.default || VueQrcodeReader);
    });
  }
  Vue.use(PiniaVuePlugin);
  Vue.use(VueShowdown, {
    // set default flavor of showdown
    flavor: 'github',
    // set default options of showdown (will override the flavor options)
    options: {
      emoji: false,
    },
  })
  const pinia: Pinia = createPinia();
  pinia.use(piniaPluginPersistedstate);

  Vue.use(VueRouter);
  Vue.directive('click-outside', ClickOutside);

  new Vue({
    vuetify,
    i18n,
    pinia,
    router,
    render: h => h(App)
  }).$mount('#app');
});
