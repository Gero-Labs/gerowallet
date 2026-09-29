import Vue, { watch } from 'vue';
import Vuetify from 'vuetify/lib';
import { ClickOutside } from 'vuetify/lib/directives';
import i18n, { getLocaleCode } from '@/plugins/i18n';
import { chainAccents, chainKeyFor } from '@/config/themes';

Vue.use(Vuetify);

// Single color source. Dark-only: the light palette was unreachable (no code
// path ever flipped theme.dark) and is deleted.
const vuetify = new Vuetify({
  directives: { ClickOutside },
  lang: {
    t: (key: string, ...params: (string | number)[]): string => i18n.t(key, params) as string,
  },
  icons: { iconfont: 'mdi' },
  theme: {
    dark: true,
    options: { customProperties: true },
    themes: {
      dark: {
        primary: chainAccents.cardano.accent,
        secondary: chainAccents.cardano.gradient2,
        accent: chainAccents.cardano.gradient1,
        success: '#47CD89',
        error: '#F97066',
        warning: '#FDB022',
        info: '#7AA7FF',
        background: '#000000',
        contentBackground: '#000000',
        navigationDrawerBackground: '#000000',
        appBarBackground: '#0C0E12',
        cardBackground: '#0C0E12',
        raisedBackground: '#12151B',
        overlayBackground: '#1A1E26',
        textPrimary: '#F7F8F9',
        textSecondary: '#B8BCC4',
        textMuted: '#7A8088',
        // legacy alias, still referenced as a color name in a few files
        geroTeal: '#00DFF3',
      },
    },
  },
});

/** Re-point Vuetify's accent slots on wallet-chain change. Typed; a wrong
 *  string can no longer silently reset to Cardano. */
export const updateVuetifyTheme = (chain: string) => {
  const a = chainAccents[chainKeyFor(chain)];
  vuetify.framework.theme.themes.dark.primary = a.accent;
  vuetify.framework.theme.themes.dark.secondary = a.gradient2;
  vuetify.framework.theme.themes.dark.accent = a.gradient1;
};

// Our lang.t hands strings to vue-i18n, but Vuetify still formats its own dates
// (v-date-picker month and weekday names) from lang.current, which nothing set,
// and the page's <html lang> stayed "en" for screen readers. Both follow the UI
// locale now.
watch(() => i18n.locale, (locale: string) => {
  const tag = getLocaleCode(locale);
  vuetify.framework.lang.current = tag;
  if (typeof document !== 'undefined') document.documentElement.lang = tag;
}, { immediate: true });

export default vuetify;
