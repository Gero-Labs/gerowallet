import Vue from 'vue';
import Vuetify from 'vuetify/lib';
import { ClickOutside } from 'vuetify/lib/directives';
import i18n from '@/plugins/i18n';
import { themes } from '@/config/themes';

Vue.use(Vuetify);

const vuetify = new Vuetify({
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
        primary: themes.cardano.primary,
        secondary: themes.cardano.secondary,
        accent: themes.cardano.accent,
        success: '#75E0A7',
        error: '#ff6464',
        geroTeal: '#00DFF3',
        background: '#000',
        contentBackground: '#000',
        navigationDrawerBackground: '#000',
        appBarBackground: '#141414',
        cardBackground: '#0C0E12',
      },
      light: {
        primary: themes.cardano.primary,
        secondary: themes.cardano.secondary,
        accent: themes.cardano.accent,
        success: '#75E0A7',
        error: '#ff6464',
        geroTeal: '#00DFF3',
        background: '#fff',
        contentBackground: '#fff',
        navigationDrawerBackground: '#fff',
        appBarBackground: '#f5f5f5',
        cardBackground: '#fff',
      },
    },
  },
});

// Function to update Vuetify theme colors dynamically
export const updateVuetifyTheme = (isApex: boolean, isDark: boolean = true) => {
  const themeColors = isApex ? themes.apex : themes.cardano;
  const themeType = isDark ? 'dark' : 'light';
  
  vuetify.framework.theme.themes[themeType].primary = themeColors.primary;
  vuetify.framework.theme.themes[themeType].secondary = themeColors.secondary;
  vuetify.framework.theme.themes[themeType].accent = themeColors.accent;
};

export default vuetify;
