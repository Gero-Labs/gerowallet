import Vue from 'vue';
import Vuetify from 'vuetify/lib';
import i18n from '@/plugins/i18n';

Vue.use(Vuetify);

export default new Vuetify({
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
        background: '#1E1E1E',
        navigationDrawerBackground: '#141414',
        appBarBackground: '#141414',
        cardBackground: '#0F0F0F',
      },
    },
  },
});
