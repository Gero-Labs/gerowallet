// The Midnight vault's copy lives in one locale module per screen group
// (src/plugins/i18n/gerovaultMidnight/), each spread once into us.ts, es.ts and de.ts, so no screen
// edits the shared locale files. Each module keeps to its own key prefix and the three languages of
// a module carry the same keys.
import { describe, expect, it } from 'vitest';
import us from '@/plugins/i18n/us';
import es from '@/plugins/i18n/es';
import de from '@/plugins/i18n/de';
import usSource from '@/plugins/i18n/us.ts?raw';
import esSource from '@/plugins/i18n/es.ts?raw';
import deSource from '@/plugins/i18n/de.ts?raw';

const modules = import.meta.glob<{ default: Record<string, string> }>('/src/plugins/i18n/gerovaultMidnight/*.ts', { eager: true });
const LANGUAGES = { us, es, de } as const;
const SOURCES = { us: usSource, es: esSource, de: deSource } as const;
const PIECES = {
  create: { name: 'Create', prefixes: ['gerovaultMidnight.create.'] },
  approve: { name: 'Approve', prefixes: ['gerovaultMidnight.approve.'] },
  recovery: { name: 'Recovery', prefixes: ['gerovaultMidnight.recovery.', 'gerovaultMidnight.guardian.'] },
  vault: { name: 'Vault', prefixes: ['gerovaultMidnight.vault.'] },
} as const;

const moduleOf = (piece: string, lang: string): Record<string, string> => {
  const found = modules[`/src/plugins/i18n/gerovaultMidnight/${piece}.${lang}.ts`];
  if (!found) throw new Error(`no locale module ${piece}.${lang}.ts`);
  return found.default;
};

describe('the Midnight vault locale modules', () => {
  it('are exactly one per screen group and language', () => {
    const expected = Object.keys(PIECES).flatMap(piece => Object.keys(LANGUAGES).map(lang => `/src/plugins/i18n/gerovaultMidnight/${piece}.${lang}.ts`));
    expect(Object.keys(modules).sort()).toEqual(expected.sort());
  });

  describe.each(Object.entries(PIECES))('%s', (piece, { name, prefixes }) => {
    it('keeps to its own prefix, with the same keys in every language', () => {
      const keys = Object.keys(moduleOf(piece, 'us')).sort();
      expect(keys.filter(key => !prefixes.some(prefix => key.startsWith(prefix)))).toEqual([]);
      for (const lang of Object.keys(LANGUAGES)) expect(Object.keys(moduleOf(piece, lang)).sort(), lang).toEqual(keys);
    });

    it.each(Object.keys(LANGUAGES) as (keyof typeof LANGUAGES)[])('is spread once into %s.ts, and its keys reach that locale', lang => {
      const source = SOURCES[lang];
      expect(source.split(`import gerovaultMidnight${name} from './gerovaultMidnight/${piece}.${lang}';`).length - 1).toBe(1);
      expect(source.split(`...gerovaultMidnight${name},`).length - 1).toBe(1);
      const locale = LANGUAGES[lang] as Record<string, string>;
      for (const [key, value] of Object.entries(moduleOf(piece, lang))) expect(locale[key], key).toBe(value);
    });
  });

  it('leaves gerovaultMidnight.* keys to the modules: none is written in a shared locale file', () => {
    for (const [lang, source] of Object.entries(SOURCES)) {
      expect(source.match(/['"]gerovaultMidnight\./g) ?? [], lang).toEqual([]);
    }
  });
});
