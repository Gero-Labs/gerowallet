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
  Vue.use(VueShowdown, {
    // set default flavor of showdown
    flavor: 'github',
    // set default options of showdown (will override the flavor options)
    options: {
      emoji: false,
    },
  })

  Vue.use(VueRouter);
  Vue.directive('click-outside', ClickOutside);

  new Vue({
    vuetify,
    i18n,
    router,
    render: h => h(App)
  }).$mount('#app');
});
