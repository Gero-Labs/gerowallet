import '../shared/styles/tokens.css';
import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@mdi/font/css/materialdesignicons.css';
import 'vuetify/styles';
import '../shared/styles/liquid-glass.css';
import '../shared/styles/baseline.css';
import '../shared/styles/vuetify-compat.css';
import '../shared/styles/iso.css';

import { createApp, watch } from 'vue';
import Notifications from '@/shared/components/ToastNotifications.vue';
import FlagIcon from '@/shared/components/FlagIcon.vue';
import i18n, { i18nPlugin, loadLanguage } from '../plugins/i18n';
import vuetify from '../plugins/vuetify';
import router from './router';
import App from './App.vue';
import { walletStore, hydrateWalletStore } from '@/stores/walletStore';
import { geroStore, type GeroStore } from '@/stores/geroStore';
import { activityTracker } from '@/services/activityTracker.service';
import featureFlagsStore from '@/stores/featureFlagsStore';
import { waitForOptionsStartup } from '@/options/startup';

async function loadSavedState(): Promise<void> {
  const initialLocale = i18n.locale;
  const saved = await chrome.storage.local.get<{ geroStore?: Partial<GeroStore>; walletStore?: { config?: { locale?: string } } }>(['walletStore', 'geroStore']);
  if (saved.geroStore) Object.assign(geroStore, saved.geroStore);
  const locale = saved.geroStore?.config?.locale || saved.walletStore?.config?.locale || 'us';
  await loadLanguage(locale);
  if (i18n.locale === initialLocale) i18n.locale = locale;
}

void waitForOptionsStartup({ walletStore: hydrateWalletStore, locale: loadSavedState }).then(() => {
  const app = createApp(App);
  app.use(vuetify);
  app.use(i18nPlugin);
  app.use(router);
  app.component('notifications', Notifications);
  app.component('flag', FlagIcon);
  app.mount('#app');

  const flagsBaseUrl = import.meta.env['VITE_FLAGS_BASE_URL'];
  if (flagsBaseUrl) {
    featureFlagsStore.initialize(flagsBaseUrl).catch(error => console.error('Failed to initialize feature flags:', error));
  }
  const stopActivity = watch(
    () => [walletStore.loggedWallet, walletStore.isLocked],
    () => {
      if (walletStore.loggedWallet && !walletStore.isLocked) activityTracker.start();
      else activityTracker.stop();
    },
    { immediate: true },
  );
  app.onUnmount(stopActivity);
});
