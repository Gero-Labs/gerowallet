import '@mdi/font/css/materialdesignicons.css';
import 'vuetify/dist/vuetify.min.css';

import Vue from 'vue';
import VueRouter from 'vue-router';
import FlagIcon from 'vue-flag-icon';
import { createPinia, Pinia, PiniaVuePlugin } from 'pinia';
import VueShowdown from 'vue-showdown'
import i18n from '../plugins/i18n';
import vuetify from '../plugins/vuetify';
import VueQrcodeReader from 'vue-qrcode-reader'
import router from '../modules/navigation/router';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';
import { ClickOutside } from 'vuetify/lib/directives';

import App from './App.vue';
import { useStore } from '@/stores';

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
Vue.directive('click-outside', ClickOutside);

new Vue({
  vuetify,
  i18n,
  pinia,
  router,
  render: h => h(App),
  async created() {
    const store = useStore();
    // 1) make sure Dexie has opened
    //    (db.open() is already called in your db module)
    // 2) do an initial load
    await store.loadWallets();
    // 3) then start the liveQuery
    await store.subscribeWallets();
  },
}).$mount('#app');
