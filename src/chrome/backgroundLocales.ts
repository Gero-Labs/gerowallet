// Background-only, and imported FIRST by background.ts.
//
// The background is one iife, so loadLanguage()'s
// `import(`@/plugins/i18n/${lang}.ts`)` cannot split a chunk there: Rollup
// inlines every locale and declares its namespace wherever the module happens to
// land, which was after the reader in i18n.ts (scripts/check-bundle-tdz.mjs).
// Eagerly importing the whole locale directory here lands every locale, present
// and future, before anything that reads it. The options bundle is untouched and
// keeps its lazy per-locale chunks.
import.meta.glob('../plugins/i18n/*.ts', { eager: true });
