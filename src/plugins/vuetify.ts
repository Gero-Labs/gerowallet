import Vue from 'vue';
import Vuetify from 'vuetify/lib';
import { ClickOutside } from 'vuetify/lib/directives';
import i18n from '@/plugins/i18n';

Vue.use(Vuetify);

export default new Vuetify({
  directives: {
    ClickOutside
  },
  lang: {
    t: (key: string, ...params: (string | number)[]): string => i18n.t(key, params) as string,
  },
  icons: {
    iconfont: 'mdi', // Material Design Icons
  },
  theme: {
    dark: true,
    options: {
      customProperties: true,
    },
    themes: {
      dark: {
        primary: '#2f9cac',
        secondary: '#b0bec5',
        accent: '#8c9eff',
        success: '#75E0A7',
        error: '#ff6464',
        geroTeal: '#00DFF3',
        background: '#000',
        contentBackground: '#000',
        navigationDrawerBackground: '#000',
        appBarBackground: '#141414',
        cardBackground: '#0C0E12',
      },
    },
  },
});
