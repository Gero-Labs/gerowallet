import Vue from 'vue';
import VueI18n from 'vue-i18n';
import { walletStore } from '@/stores/walletStore';

// Vuetify locales - import all available
import {
  en as vuetifyEn,
  ru as vuetifyRu,
  de as vuetifyDe,
  es as vuetifyEs,
  fr as vuetifyFr,
  it as vuetifyIt,
  ja as vuetifyJa,
  nl as vuetifyNl,
  pt as vuetifyPt,
  tr as vuetifyTr,
  zhHans as vuetifyCn,
  th as vuetifyTh,
  cs as vuetifyCz,
  el as vuetifyGr,
  he as vuetifyHe,
} from 'vuetify/src/locale';

// Only load US English by default (other languages lazy-loaded on demand)
import us from '@/plugins/i18n/us';

/**
 * Wrap translations with Vuetify locale support
 */
const wrapWithVuetify = (translations: any, vuetifyLocale: any, rtl = false, locale = 'en-US') => ({
  rtl, // Fixed: Boolean instead of string
  locale,
  $vuetify: { ...vuetifyLocale },
  ...translations,
});

// Vuetify locale mapping (all 22 languages from languages.ts)
const vuetifyLocales: Record<string, any> = {
  cn: vuetifyCn, // Chinese
  cz: vuetifyCz, // Czech - FIXED
  de: vuetifyDe, // German
  es: vuetifyEs, // Spanish
  fr: vuetifyFr, // French
  gb: vuetifyEn, // English (GB)
  gr: vuetifyGr, // Greek
  he: vuetifyHe, // Hebrew
  hr: vuetifyEn, // Croatian - fallback to English
  id: vuetifyEn, // Indonesian - fallback to English
  in: vuetifyEn, // Hindi - fallback to English
  it: vuetifyIt, // Italian
  jp: vuetifyJa, // Japanese
  nl: vuetifyNl, // Dutch
  pk: vuetifyEn, // Urdu - fallback to English
  pt: vuetifyPt, // Portuguese
  ru: vuetifyRu, // Russian
  th: vuetifyTh, // Thai
  tr: vuetifyTr, // Turkish
  tz: vuetifyEn, // Swahili - fallback to English
  us: vuetifyEn, // English (US)
  vn: vuetifyEn, // Vietnamese - fallback to English
};

// Initial messages with only US English
const messages: Record<string, any> = {
  us: wrapWithVuetify(us, vuetifyEn, false, 'en-US'),
};

/**
 * Lazy load language file
 */
async function loadLanguage(lang: string): Promise<void> {
  if (messages[lang]) return; // Already loaded

  try {
    const translations = await import(`@/plugins/i18n/${lang}.ts`);
    const vuetifyLocale = vuetifyLocales[lang] || vuetifyEn;
    const isRTL = lang === 'he' || lang === 'pk'; // Hebrew and Urdu are RTL

    messages[lang] = wrapWithVuetify(translations.default, vuetifyLocale, isRTL, getLocaleCode(lang));

    i18n.setLocaleMessage(lang, messages[lang]);
  } catch (error) {
    console.warn(`Failed to load language ${lang}:`, error);
    // Fallback to English if language fails to load
    messages[lang] = messages['us'];
    i18n.setLocaleMessage(lang, messages[lang]);
  }
}

/**
 * Get full locale code for a language
 */
function getLocaleCode(lang: string): string {
  const localeCodes: Record<string, string> = {
    cn: 'zh-CN',
    cz: 'cs-CZ',
    de: 'de-DE',
    es: 'es-ES',
    fr: 'fr-FR',
    gb: 'en-GB',
    gr: 'el-GR',
    he: 'he-IL',
    hr: 'hr-HR',
    id: 'id-ID',
    in: 'hi-IN',
    it: 'it-IT',
    jp: 'ja-JP',
    nl: 'nl-NL',
    pk: 'ur-PK',
    pt: 'pt-PT',
    ru: 'ru-RU',
    th: 'th-TH',
    tr: 'tr-TR',
    tz: 'sw-TZ',
    us: 'en-US',
    vn: 'vi-VN',
  };
  return localeCodes[lang] || 'en-US';
}

Vue.use(VueI18n);

/**
 * Get saved locale from Pinia store (centralized)
 * FIXED: Use walletStore instead of direct localStorage access
 */
const getSavedLocale = (): string => {
  try {
    // Use centralized store pattern (walletStore) instead of localStorage
    const locale = walletStore.config?.locale;
    if (locale) {
      console.log('🌐 Found locale in walletStore:', locale);
      return locale;
    }

    // Fallback: read from localStorage only if store is not initialized yet
    // (e.g., during very first app start before store hydration)
    const savedConfig = localStorage.getItem('walletStore');
    if (savedConfig) {
      const config = JSON.parse(savedConfig);
      const fallbackLocale = config?.config?.locale || 'us';
      console.log('🌐 Found locale in localStorage:', fallbackLocale);
      return fallbackLocale;
    }
  } catch (e) {
    console.warn('Failed to load saved locale:', e);
  }

  console.log('🌐 Using default locale: us');
  return 'us';
};

const i18n: VueI18n = new VueI18n({
  locale: 'us', // Initial locale
  fallbackLocale: 'us', // Fallback to US English
  messages, // Initial messages (only US)
  silentTranslationWarn: false, // Show warnings for missing keys in development
  silentFallbackWarn: false, // Show warnings when falling back
});

// Load saved locale on initialization
(async () => {
  // Wait for store to be hydrated (especially after page refresh)
  await new Promise(resolve => setTimeout(resolve, 100));

  const savedLocale = getSavedLocale();
  console.log('🌐 Initializing i18n with saved locale:', savedLocale);

  if (savedLocale !== 'us') {
    try {
      await loadLanguage(savedLocale);
      i18n.locale = savedLocale;
      console.log('✅ Language loaded successfully:', savedLocale);
    } catch (error) {
      console.error('❌ Failed to load saved language:', savedLocale, error);
    }
  }
})();

// Export both i18n and loadLanguage helper
export { loadLanguage };
export default i18n;
