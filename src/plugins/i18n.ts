import { createI18n, type LocaleMessageValue } from 'vue-i18n';
import us from 'virtual:gero-locales/us';
import { READY_LANGUAGES } from './i18n.config';

type Messages = Record<string, LocaleMessageValue<string>>;
type Parameters = Record<string, unknown> | unknown[];

export const i18nPlugin = createI18n({
  legacy: false,
  globalInjection: true,
  locale: 'us',
  fallbackLocale: 'us',
  messages: { us } as Record<string, Messages>,
  missingWarn: import.meta.env.DEV,
  fallbackWarn: import.meta.env.DEV,
});
const composer = i18nPlugin.global;
const loaders: Record<string, () => Promise<{ default: Messages }>> = {
  de: () => import('virtual:gero-locales/de'),
  es: () => import('virtual:gero-locales/es'),
};
const pending = new Map<string, Promise<void>>();

export function registerLocaleMessages(locale: string, messages: Messages): void {
  composer.setLocaleMessage(locale, messages);
}
export async function loadLanguage(locale: string): Promise<void> {
  if (!(READY_LANGUAGES as readonly string[]).includes(locale)) throw new Error(`Unsupported locale: ${locale}`);
  if (composer.availableLocales.includes(locale)) return;
  if (!pending.has(locale)) {
    const load = loaders[locale];
    if (!load) throw new Error(`No locale loader: ${locale}`);
    pending.set(locale, load().then(({ default: messages }) => registerLocaleMessages(locale, messages)).finally(() => pending.delete(locale)));
  }
  await pending.get(locale);
}
export function getLocaleCode(locale: string): string {
  return ({ us: 'en-US', de: 'de-DE', es: 'es-419' } as Record<string, string>)[locale] || 'en-US';
}
let localeRequest = 0;
export async function updateI18nLocale(locale: string): Promise<boolean> {
  const request = ++localeRequest;
  if (composer.locale.value === locale) return false;
  try {
    await loadLanguage(locale);
    if (request !== localeRequest) return false;
    composer.locale.value = locale;
    return true;
  } catch (error) {
    console.error(`Failed to load locale ${locale}:`, error);
    return false;
  }
}

/** Application translation API for services, including the DOM-free worker.
 * Explicit-locale calls retain their meaning; rendering uses the Vue 3 composer.
 */
const i18n = {
  get locale(): string { return composer.locale.value; },
  set locale(locale: string) { composer.locale.value = locale; },
  t(key: string, localeOrValues?: string | Parameters, values?: Parameters): string {
    const locale = typeof localeOrValues === 'string' ? localeOrValues : composer.locale.value;
    const parameters = typeof localeOrValues === 'string' ? values : localeOrValues;
    return Array.isArray(parameters)
      ? composer.t(key, parameters, { locale })
      : composer.t(key, parameters || {}, { locale });
  },
  tc(key: string, choice = 1, values: Record<string, unknown> = {}): string {
    return composer.t(key, values, choice);
  },
  te: composer.te,
  getLocaleMessage: composer.getLocaleMessage,
  setLocaleMessage: registerLocaleMessages,
};
export default i18n;
