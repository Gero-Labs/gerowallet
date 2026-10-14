import 'virtual:gero-visual-styles';
import { createApp } from 'vue';
import * as components from 'vuetify/components';
import vuetify from '@/plugins/vuetify';
import { i18nPlugin } from '@/plugins/i18n';
import Fixture from './Fixture.vue';

const app = createApp(Fixture).use(vuetify).use(i18nPlugin);
// Production auto-imports these components. Global registration also supports
// exercising real shared SFCs here without changing the production plugin.
for (const [name, component] of Object.entries(components)) app.component(name, component);
app.mount('#app');
