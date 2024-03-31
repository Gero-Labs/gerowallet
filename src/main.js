import Vue from 'vue'
import App from './App.vue'
import i18n from '@/plugins/i18n';
import vuetify from './plugins/vuetify'
import FlagIcon from 'vue-flag-icon';

Vue.config.productionTip = false

Vue.use(FlagIcon);

new Vue({
  i18n,
  vuetify,
  render: h => h(App)
}).$mount('#app')
