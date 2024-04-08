import '@mdi/font/css/materialdesignicons.css'
import Vue from 'vue'
import App from './App.vue'
import i18n from '@/plugins/i18n';
import vuetify from './plugins/vuetify'
import FlagIcon from 'vue-flag-icon';
import router from "@/router";
import store from "@/store";

Vue.config.productionTip = false

Vue.use(FlagIcon);

new Vue({
  i18n,
  vuetify,
  router,
  store,
  render: h => h(App)
}).$mount('#app')
