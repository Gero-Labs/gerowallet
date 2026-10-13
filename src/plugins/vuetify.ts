import { watch } from 'vue';
import { createVuetify } from 'vuetify';
import * as directives from 'vuetify/directives';
import { aliases, mdi } from 'vuetify/iconsets/mdi';
import { en, de, es } from 'vuetify/locale';
import i18n, { getLocaleCode } from '@/plugins/i18n';
import { chainAccents, chainKeyFor } from '@/config/themes';

// Single color source. Dark-only: the light palette was unreachable (no code
// path ever flipped theme.dark) and is deleted.
const vuetify = createVuetify({
  directives,
  // Preserve the wallet's existing responsive layout at the Router/Vuetify cutover.
  display: { thresholds: { xs: 0, sm: 600, md: 960, lg: 1280, xl: 1920, xxl: 2560 } },
  locale: { locale: 'en', fallback: 'en', messages: { en, de, es } },
  icons: { defaultSet: 'mdi', aliases, sets: { mdi } },
  defaults: {
    VBtn: { variant: 'elevated' },
    VTextField: { variant: 'filled' },
    VSelect: { variant: 'filled' },
  },
  theme: {
    defaultTheme: 'dark',
    themes: {
      dark: {
        dark: true,
        colors: {
        primary: chainAccents.cardano.accent,
        secondary: chainAccents.cardano.gradient2,
        accent: chainAccents.cardano.gradient1,
        success: '#47CD89',
        error: '#F97066',
        warning: '#FDB022',
        info: '#7AA7FF',
        background: '#000000',
        surface: '#0C0E12',
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
  },
});

/** Re-point Vuetify's accent slots on wallet-chain change. Typed; a wrong
 *  string can no longer silently reset to Cardano. */
export const updateVuetifyTheme = (chain: string) => {
  const a = chainAccents[chainKeyFor(chain)];
  const colors = vuetify.theme.themes.value['dark'].colors;
  colors['primary'] = a.accent;
  colors['secondary'] = a.gradient2;
  colors['accent'] = a.gradient1;
};

// Vuetify translation keys are exact locale names; document language uses the
// full regional tag for screen readers and browser formatting.
watch(() => i18n.locale, (locale: string) => {
  const tag = getLocaleCode(locale);
  vuetify.locale.current.value = locale === 'us' ? 'en' : locale;
  if (typeof document !== 'undefined') document.documentElement.lang = tag;
}, { immediate: true });

export default vuetify;
