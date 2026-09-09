import Vue from 'vue';
import Vuetify from 'vuetify';
import VueI18n from 'vue-i18n';
import 'vuetify/dist/vuetify.min.css';
import '@mdi/font/css/materialdesignicons.css';
import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono';
import '@/shared/styles/tokens.css';
import en from '@/plugins/i18n/us';
import WalletLibrary from '@/shared/components/WalletLibrary/WalletLibrary.vue';
import { wallets } from './fixtures';
import type { Wallet } from '@/models/types';
import WalletSelector from '@/sidepanel/components/WalletSelector.vue';
import BottomSheet from '@/sidepanel/components/BottomSheet.vue';
import WalletCreation from '@/modules/welcome/components/WalletCreation/WalletCreation.vue';
import { walletLibraryRepository } from '@/db/wallet-library';
// Fixture-only handle for deliberately slow/failing persistence tests.
const mini = new URLSearchParams(location.search).get('mini');
const welcome = new URLSearchParams(location.search).has('welcome');
const panelState = Vue.observable({ loadingWalletId: null as number | null, errorMessage: '', sheet: false });
Object.assign(window, { walletLibraryFixture: { repository: walletLibraryRepository, panelState },
  chrome: { runtime: { getURL: (path: string) => `chrome-extension://fixture/${path}` },
    tabs: { create: ({ url }: { url: string }) => { document.documentElement.dataset.setupUrl = url; } } },
});
const selectInMini = (wallet: Wallet) => {
  panelState.loadingWalletId = wallet.id;
  document.documentElement.dataset.selectedWallet = JSON.stringify(wallet);
};
Vue.use(Vuetify); Vue.use(VueI18n);
new Vue({
  vuetify: new Vuetify({ theme: { dark: true, themes: { dark: { primary: '#33C7DD' } } } }),
  i18n: new VueI18n({ locale: 'us', messages: { us: en } }),
  render: h => welcome ? h('v-app', { attrs: { id: 'preview-app' } }, [h('main', { class: 'preview-frame preview-frame--welcome' }, [
    h(WalletCreation, { props: { selectedNetwork: { blockchain: 'Cardano', network: 'Mainnet' } } }),
  ])]) : mini ? h('v-app', { attrs: { id: 'preview-app' } }, [h('main', { class: 'preview-frame preview-frame--mini' },
    mini === 'sheet' ? [
      h('button', { attrs: { type: 'button' }, on: { click: () => { panelState.sheet = true; } } }, 'Switch wallet'),
      h(BottomSheet, { props: { value: panelState.sheet, title: 'Select Wallet', height: '85%' }, on: { input: (value: boolean) => { panelState.sheet = value; } } },
        [h(WalletSelector, { props: { compact: true, loadingWalletId: panelState.loadingWalletId, errorMessage: panelState.errorMessage }, on: { select: selectInMini } })]),
    ] : [h(WalletSelector, { props: { loadingWalletId: panelState.loadingWalletId, errorMessage: panelState.errorMessage }, on: { select: selectInMini } })])])
    : h('v-app', { attrs: { id: 'preview-app' } }, [h('main', { class: 'preview-frame' }, [
    h('header', [h('img', { attrs: { src: '/src/assets/svg/gero_dashboard.svg', alt: 'Gero' } }), h('h1', 'Your wallets'), h('p', 'Choose a wallet to continue')]),
    h(WalletLibrary, { props: { availableWallets: wallets }, on: { select: id => { document.documentElement.dataset.selectedWallet = String(id); } } }),
  ])]),
}).$mount('#app');
