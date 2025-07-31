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

new Vue({
  vuetify,
  i18n,
  router,
  render: h => h(App)
}).$mount('#app');
