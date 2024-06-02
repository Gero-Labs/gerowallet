import Vue from 'vue';
import Vuetify from 'vuetify/lib/framework';

import i18n from '@/plugins/i18n';

Vue.use(Vuetify);

export default new Vuetify({
  lang: {
    t: (key: string, ...params) => i18n.t(key, params),
  },
  icons: {
    iconfont: 'mdi',
  },
  theme: {
    dark: true,
    options: {
      customProperties: true,
    },
    themes: {
      dark: {
        anchor: "#7ED8FF",
        primary: '#00DFF3', // #2F9CAC
        secondary: '#B0BEC5',
        accent: '#8C9EFF',
        success: '#75E0A7',
        error: '#FF7777', // #FF6464
        background: '#1E1E1E',
        navigationDrawerBackground: '#141414',
        appBarBackground: '#141414',
        cardBackground: '#0F0F0F',
      },
    },
  },
});
