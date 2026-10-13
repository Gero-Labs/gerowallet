import { createApp, watch } from 'vue';
import { createRouter, createWebHashHistory } from 'vue-router';
import { createI18n } from 'vue-i18n';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';
import 'vuetify/styles';
import App from './App.vue';
import Home from './Home.vue';
import Approval from './Approval.vue';
import { hydration, snapshot } from './state';
import us from './locales/us.json';
import de from './locales/de.json';
import es from './locales/es.json';
import './swap-contract';

export async function mount(surface: string) {
  const router = createRouter({
    history: createWebHashHistory(),
    routes: [
      { path: '/', component: Home },
      { path: '/approval', component: Approval, meta: { protected: true } },
      { path: '/:pathMatch(.*)*', redirect: '/' },
    ],
  });
  router.beforeEach(async (to) => {
    await hydration;
    return to.meta.protected && snapshot.locked ? '/' : true;
  });
  watch(() => snapshot.locked, (locked) => {
    if (locked && router.currentRoute.value.meta.protected) void router.replace('/');
  });
  const i18n = createI18n({ legacy: false, locale: 'us', fallbackLocale: 'us', messages: { us, de, es } });
  const app = createApp(App, { surface, target: __PILOT_TARGET__ });
  app.use(i18n);
  app.use(createVuetify({ components, directives }));
  app.use(router);
  await router.isReady();
  app.mount('#app');
}
