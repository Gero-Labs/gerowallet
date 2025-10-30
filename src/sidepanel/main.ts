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

chrome.storage.local.get('walletStore', ({ walletStore: saved }) => {
  if (saved?.loggedWallet?.id && saved?.config?.locale) {
    console.log('🌐 Sidepanel: Setting initial locale from storage:', saved.config.locale);
    i18n.locale = saved.config.locale;
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
