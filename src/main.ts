/// <reference types="vuetify" />

import '@mdi/font/css/materialdesignicons.css';
import 'vuetify/dist/vuetify.min.css';

import Vue from 'vue';
import VueRouter from 'vue-router';
import FlagIcon from 'vue-flag-icon';
import { createPinia, Pinia, PiniaVuePlugin } from 'pinia';

import i18n from '@/plugins/i18n';
import vuetify from '@/plugins/vuetify';
import router from '@/modules/navigation/router';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';

import App from './App.vue';

Vue.config.productionTip = false;

Vue.use(FlagIcon);
Vue.use(PiniaVuePlugin);

const pinia: Pinia = createPinia();
pinia.use(piniaPluginPersistedstate);

Vue.use(VueRouter);

new Vue({
  i18n,
  pinia,
  router,
  vuetify,
  render: h => h(App),
}).$mount('#app');
