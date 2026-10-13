import { createApp, h, reactive } from 'vue';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';
import { VApp } from 'vuetify/components';
import { createI18n } from 'vue-i18n';
import 'vuetify/styles';
import '@mdi/font/css/materialdesignicons.css';
import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono';
import '@/shared/styles/tokens.css';
import en from 'virtual:gero-locales/us';
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
const panelState = reactive({ loadingWalletId: null as number | null, errorMessage: '', sheet: false });
Object.assign(window, { walletLibraryFixture: { repository: walletLibraryRepository, panelState },
  chrome: { runtime: { getURL: (path: string) => `chrome-extension://fixture/${path}` },
    tabs: { create: ({ url }: { url: string }) => { document.documentElement.dataset.setupUrl = url; } } },
});
const selectInMini = (wallet: Wallet) => {
  panelState.loadingWalletId = wallet.id;
  document.documentElement.dataset.selectedWallet = JSON.stringify(wallet);
};
const vuetify = createVuetify({ components, directives, theme: { defaultTheme: 'dark', themes: { dark: { dark: true, colors: { primary: '#33C7DD' } } } } });
const i18n = createI18n({ legacy: false, locale: 'us', messages: { us: en } });
createApp({
  render: () => h(VApp, { id: 'preview-app' }, { default: () => welcome ? h('main', { class: 'preview-frame preview-frame--welcome' }, [
    h(WalletCreation, { selectedNetwork: { blockchain: 'Cardano', network: 'Mainnet' } }),
  ]) : mini ? h('main', { class: 'preview-frame preview-frame--mini' },
    mini === 'sheet' ? [
      h('button', { type: 'button', onClick: () => { panelState.sheet = true; } }, 'Switch wallet'),
      h(BottomSheet, { modelValue: panelState.sheet, title: 'Select Wallet', height: '85%', 'onUpdate:modelValue': (value: boolean) => { panelState.sheet = value; } },
        { default: () => h(WalletSelector, { compact: true, loadingWalletId: panelState.loadingWalletId, errorMessage: panelState.errorMessage, onSelect: selectInMini }) }),
    ] : [h(WalletSelector, { loadingWalletId: panelState.loadingWalletId, errorMessage: panelState.errorMessage, onSelect: selectInMini })])
    : h('main', { class: 'preview-frame' }, [
    h('header', [h('img', { src: '/src/assets/svg/gero_dashboard.svg', alt: 'Gero' }), h('h1', 'Your wallets'), h('p', 'Choose a wallet to continue')]),
    h(WalletLibrary, { availableWallets: wallets, onSelect: (id: number) => { document.documentElement.dataset.selectedWallet = String(id); } }),
  ]) }),
}).use(vuetify).use(i18n).mount('#app');
