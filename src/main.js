import '@mdi/font/css/materialdesignicons.css'
import Vue from 'vue'
import App from './App.vue'
import i18n from '@/plugins/i18n';
import vuetify from './plugins/vuetify'
import FlagIcon from 'vue-flag-icon';
import router from "@/modules/navigation/router";
import { createPinia, PiniaVuePlugin } from 'pinia'
import piniaPluginPersistedstate from "pinia-plugin-persistedstate";
import VueRouter from "vue-router";

Vue.config.productionTip = false

Vue.use(FlagIcon);
Vue.use(PiniaVuePlugin)
const pinia = createPinia()
pinia.use(piniaPluginPersistedstate);

Vue.use(VueRouter)

new Vue({
  i18n,
  vuetify,
  pinia,
  router,
  render: h => h(App)
}).$mount('#app')
