/**
 * i18n Configuration
 * Centralized constants for internationalization
 *
 * Deliberately NOT inside `src/plugins/i18n/`. `loadLanguage()` there resolves a
 * template-literal import of `@/plugins/i18n/<lang>.ts`, which Vite expands into
 * a map of EVERY module in that directory - so a config module living beside the
 * locales became a candidate locale, and its inlined namespace ended up read (in
 * the single-iife background bundle) ~161k lines before it is declared. Keeping
 * it one level up leaves the glob to actual languages. See
 * scripts/check-bundle-tdz.mjs.
 */

/**
 * Languages that are ready for production use
 * Only these languages will be shown in the language selector
 */
export const READY_LANGUAGES = ['us', 'de', 'es'] as const;

export type ReadyLanguage = typeof READY_LANGUAGES[number];

// Our locale keys are not always BCP 47 language subtags ('us' is English).
const BROWSER_LANGUAGE_ALIASES: Record<string, ReadyLanguage> = { en: 'us' };

/**
 * The ready UI language that serves a browser language tag, e.g.
 * `chrome.i18n.getUILanguage()` values like 'es-419', 'de-AT' or 'en-GB'.
 * Anything we do not speak yet falls back to 'us'.
 */
export function readyLanguageFor(tag: string | null | undefined): ReadyLanguage {
  const primary = (tag || '').toLowerCase().split(/[-_]/)[0];
  const alias = BROWSER_LANGUAGE_ALIASES[primary];
  if (alias) return alias;
  return (READY_LANGUAGES as readonly string[]).includes(primary) ? primary as ReadyLanguage : 'us';
}
