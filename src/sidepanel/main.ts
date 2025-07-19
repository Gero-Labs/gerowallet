import '@mdi/font/css/materialdesignicons.css';
import 'vuetify/dist/vuetify.min.css';

import Vue from 'vue';
import VueRouter from 'vue-router';
import { createPinia, Pinia, PiniaVuePlugin } from 'pinia';
import i18n from '../plugins/i18n';
import vuetify from '../plugins/vuetify';
import router from '../modules/navigation/router';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';

import App from './Sidepanel.vue';
import { useStore } from '@/stores';

Vue.config.productionTip = false;
Vue.use(VueRouter);

new Vue({
  vuetify,
  i18n,
  pinia,
  router,
  render: h => h(App)
}).$mount('#app');
