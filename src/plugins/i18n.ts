import Vue from 'vue';
import VueI18n from 'vue-i18n';


// Vuetify locales — only import supported languages (us, de)
import {
  de as vuetifyDe,
  en as vuetifyEn,
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

// Vuetify locale mapping — only supported languages
const vuetifyLocales: Record<string, any> = {
  de: vuetifyDe,
  us: vuetifyEn,
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
    const isRTL = false; // No RTL languages currently supported

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
    de: 'de-DE',
    us: 'en-US',
  };
  return localeCodes[lang] || 'en-US';
}

Vue.use(VueI18n);

const i18n: VueI18n = new VueI18n({
  locale: 'us', // Initial locale
  fallbackLocale: 'us', // Fallback to US English
  messages, // Initial messages (only US)
  silentTranslationWarn: true, // Silence warnings for missing keys (translations in progress)
  silentFallbackWarn: true, // Silence warnings when falling back to English
});

// CRITICAL: The IIFE below was causing issues because:
// 1. It runs after a 100ms delay
// 2. getSavedLocale() checks geroStore.config.locale first, which is always 'us' (default) before hydration
// 3. This returns 'us' instead of checking localStorage/chrome.storage for the actual saved locale
// 4. The IIFE then does nothing (savedLocale === 'us') or incorrectly sets locale
//
// The initial locale is now handled by main.ts/sidepanel main.ts which:
// 1. Reads from chrome.storage.local.get() BEFORE Vue app mounts
// 2. Loads the correct language file
// 3. Sets i18n.locale correctly
//
// This IIFE is DISABLED to prevent race conditions.
// DO NOT re-enable without understanding the full initialization order.
//
// (async () => {
//   await new Promise(resolve => setTimeout(resolve, 100));
//   const savedLocale = getSavedLocale();
//   if (savedLocale !== 'us') {
//     try {
//       await loadLanguage(savedLocale);
//       i18n.locale = savedLocale;
//     } catch (error) {
//       console.error('❌ Failed to load saved language:', savedLocale, error);
//     }
//   }
// })();

/**
 * Update i18n locale and load language file if needed
 * Centralized helper to avoid code duplication across stores
 * @param locale - The locale code to switch to (e.g., 'us', 'de')
 * @returns Promise<boolean> - true if locale was changed, false if already at target locale
 */
async function updateI18nLocale(locale: string): Promise<boolean> {
  try {
    if (i18n.locale === locale) {
      return false; // Already at target locale
    }

    await loadLanguage(locale);
    i18n.locale = locale;
    return true;
  } catch (error) {
    console.error('Failed to update i18n locale:', error);
    return false;
  }
}

// Export i18n instance and helper functions
export { loadLanguage, updateI18nLocale };
export default i18n;
