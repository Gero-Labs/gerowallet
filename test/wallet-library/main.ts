import Vue from 'vue';
import Vuetify from 'vuetify';
import VueI18n from 'vue-i18n';
import 'vuetify/dist/vuetify.min.css';
import '@mdi/font/css/materialdesignicons.css';
import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono';
import '@/shared/styles/tokens.css';
import en from '@/plugins/i18n/us';
import WalletLibrary from '@/options/modules/welcome/components/WalletLibrary.vue';
import { wallets } from './fixtures';
Vue.use(Vuetify); Vue.use(VueI18n);
new Vue({
  vuetify: new Vuetify({ theme: { dark: true, themes: { dark: { primary: '#33C7DD' } } } }),
  i18n: new VueI18n({ locale: 'us', messages: { us: en } }),
  render: h => h('v-app', { attrs: { id: 'preview-app' } }, [h('main', { class: 'preview-frame' }, [
    h('header', [h('img', { attrs: { src: '/src/assets/svg/gero_dashboard.svg', alt: 'Gero' } }), h('h1', 'Your wallets'), h('p', 'Choose a wallet to continue')]),
    h(WalletLibrary, { props: { availableWallets: wallets }, on: { select: id => { document.documentElement.dataset.selectedWallet = String(id); } } }),
  ])]),
}).$mount('#app');
