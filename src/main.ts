import '@mdi/font/css/materialdesignicons.css';
import 'vuetify/dist/vuetify.min.css';

import Vue from 'vue';
import VueRouter from 'vue-router';
import FlagIcon from 'vue-flag-icon';
import { createPinia, Pinia, PiniaVuePlugin } from 'pinia';
import VueShowdown from 'vue-showdown'
import i18n from '@/plugins/i18n';
import vuetify from '@/plugins/vuetify';
import VueQrcodeReader from 'vue-qrcode-reader'
import router from '@/modules/navigation/router';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';

import App from './App.vue';

Vue.config.productionTip = false;
Vue.use(FlagIcon);
Vue.use(VueQrcodeReader);
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

new Vue({
  vuetify,
  i18n,
  pinia,
  router,
  render: h => h(App),
}).$mount('#app');
