/**
 * i18n Configuration
 * Centralized constants for internationalization
 */

/**
 * Languages that are ready for production use
 * Only these languages will be shown in the language selector
 */
export const READY_LANGUAGES = ['us', 'de'] as const;

export type ReadyLanguage = typeof READY_LANGUAGES[number];
