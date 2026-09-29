import { describe, expect, it } from 'vitest';
import { READY_LANGUAGES, readyLanguageFor } from './i18n.config';
import { PUSH_LOCALES, pushStrings } from './i18n/push';

/**
 * Every ready language must carry exactly the English key set, with the same
 * placeholders and plural shape. vue-i18n silently renders English (or the raw key)
 * for anything missing, so nothing else in the repo catches drift.
 *
 * Deliberately NOT inside `src/plugins/i18n/`: `loadLanguage()` glob-imports every
 * module there as a candidate locale (see i18n.config.ts).
 */
const modules = import.meta.glob<{ default: Record<string, string> }>('./i18n/*.ts', { eager: true });
const locale = (lang: string): Record<string, string> => {
  const mod = modules[`./i18n/${lang}.ts`];
  if (!mod) throw new Error(`no locale file for ${lang}`);
  return mod.default;
};

const us = locale('us');
const placeholders = (value: string): string[] => (value.match(/\{\w+\}/g) ?? []).sort();

describe('i18n parity', () => {
  for (const lang of READY_LANGUAGES.filter((l) => l !== 'us')) {
    describe(lang, () => {
      const dict = locale(lang);

      it('has every English key and nothing else', () => {
        expect(Object.keys(us).filter((k) => !(k in dict))).toEqual([]);
        expect(Object.keys(dict).filter((k) => !(k in us))).toEqual([]);
      });

      it('keeps every placeholder', () => {
        const drift = Object.keys(us).filter((k) => k in dict && placeholders(us[k]!).join() !== placeholders(dict[k]!).join());
        expect(drift).toEqual([]);
      });

      it('keeps the plural shape', () => {
        const drift = Object.keys(us).filter((k) => k in dict && us[k]!.split('|').length !== dict[k]!.split('|').length);
        expect(drift).toEqual([]);
      });

      it('translates every non-empty string', () => {
        expect(Object.keys(us).filter((k) => us[k]!.trim() && !dict[k]?.trim())).toEqual([]);
      });
    });
  }

  it('uses no em dash in any ready language or push string', () => {
    const tables = [
      ...READY_LANGUAGES.map((lang) => [lang, locale(lang)] as const),
      ...PUSH_LOCALES.map((lang) => [`push:${lang}`, pushStrings[lang] as Record<string, string>] as const),
    ];
    const offenders = tables.flatMap(([name, dict]) => Object.entries(dict).filter(([, v]) => v.includes('\u2014')).map(([k]) => `${name}:${k}`));
    expect(offenders).toEqual([]);
  });

  it('has push strings for every ready language', () => {
    expect([...PUSH_LOCALES].sort()).toEqual([...READY_LANGUAGES].sort());
  });

  // The service worker renders pushes from this table alone (no vue-i18n
  // fallback), so a missing key throws for that language's users.
  for (const lang of PUSH_LOCALES.filter((l) => l !== 'us')) {
    it(`push strings: ${lang} has every key with the same placeholders`, () => {
      const us = pushStrings.us as Record<string, string>;
      const dict = pushStrings[lang] as Record<string, string>;
      expect(Object.keys(dict).sort()).toEqual(Object.keys(us).sort());
      expect(Object.keys(us).filter((k) => placeholders(us[k]!).join() !== placeholders(dict[k] ?? '').join())).toEqual([]);
    });
  }
});

describe('readyLanguageFor', () => {
  it.each([
    ['es', 'es'], ['es-419', 'es'], ['es-MX', 'es'], ['es_AR', 'es'],
    ['de', 'de'], ['de-AT', 'de'],
    ['en', 'us'], ['en-GB', 'us'], ['EN-us', 'us'],
    ['pt-BR', 'us'], ['ja', 'us'], ['', 'us'], [undefined, 'us'], [null, 'us'],
    ['constructor', 'us'], ['toString', 'us'], ['__proto__', 'us'],
  ])('%s -> %s', (tag, expected) => {
    expect(readyLanguageFor(tag)).toBe(expected);
  });
});
