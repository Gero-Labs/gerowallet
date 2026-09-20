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
export const READY_LANGUAGES = ['us', 'de'] as const;

export type ReadyLanguage = typeof READY_LANGUAGES[number];
