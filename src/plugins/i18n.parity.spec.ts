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

  // The rescue card's limit hints (one cancel transaction takes one marketplace version, and
  // each version has its own cap): the cap is a placeholder, never a baked-in number, and the
  // copy never names the closed marketplace.
  describe.each(READY_LANGUAGES)('rescue limit hints: %s', (lang) => {
    const dict = locale(lang);

    it('takes the cap as {max} and names no number of its own', () => {
      expect(placeholders(dict['legacyListings.maxHint']!)).toEqual(['{max}']);
      expect(dict['legacyListings.maxHint']).not.toMatch(/\d/);
    });

    it('has the version hint, with no placeholder', () => {
      expect(dict['legacyListings.versionHint']?.trim()).toBeTruthy();
      expect(placeholders(dict['legacyListings.versionHint']!)).toEqual([]);
    });

    it('never names the marketplace anywhere in the rescue copy', () => {
      const offenders = Object.entries(dict).filter(([key, value]) => key.startsWith('legacyListings.') && /jpg/i.test(value)).map(([key]) => key);
      expect(offenders).toEqual([]);
    });
  });

  // The market's warnings and sheets. The "holds more" warning also shows for an output that holds
  // no NFT at all, so it may not say "more than the one NFT"; the German keeps one word for a
  // listing that sits stuck ("festsitzen"); the market copy never names the closed marketplace.
  describe.each(READY_LANGUAGES)('market copy: %s', (lang) => {
    const dict = locale(lang);

    it('says the listing does not hold exactly one NFT, which is true for no NFT at all as well as for extras', () => {
      const text = dict['signTx.listingHoldsMore']!;
      expect(text).not.toMatch(/more than the one NFT|mehr als das eine NFT|más que el único NFT/i);
      expect(text).toMatch(/exactly one NFT|genau ein NFT|exactamente un NFT/i);
    });

    it('never names the marketplace anywhere in the market copy', () => {
      const offenders = Object.entries(dict).filter(([key, value]) => key.startsWith('nftMarket.') && /jpg/i.test(value)).map(([key]) => key);
      expect(offenders).toEqual([]);
    });

    // The lookalike warning is useless without the real collection's policy ID: it is the one
    // thing that tells a copy from the original.
    it('keeps the real collection\'s name and policy ID in the lookalike warning', () => {
      expect(placeholders(dict['nftMarket.browse.lookalike']!)).toEqual(['{name}', '{policyId}']);
    });

    // The purchase sheet's figures are the worker's, never baked into the copy.
    it('takes the purchase sheet\'s amounts as placeholders and names no number of its own', () => {
      expect(placeholders(dict['nftMarket.buy.depositNote']!)).toEqual(['{deposit}']);
      expect(placeholders(dict['nftMarket.buy.priceDiffers']!)).toEqual(['{price}', '{shown}']);
      for (const key of ['nftMarket.buy.depositNote', 'nftMarket.buy.priceDiffers', 'nftMarket.buy.minUtxoNote', 'nftMarket.buy.nftAdaNote']) {
        expect(dict[key], key).not.toMatch(/\d/);
      }
    });
  });

  it('addresses German users formally in the browse and buy copy, as the rest of the market copy does', () => {
    const de = locale('de');
    const keys = Object.keys(de).filter((key) => key.startsWith('nftMarket.browse.') || key.startsWith('nftMarket.buy.'));
    expect(keys.length).toBeGreaterThan(0);
    const informal = keys.filter((key) => /\b(du|dein\w*|dich|dir)\b/i.test(de[key]!));
    expect(informal).toEqual([]);
  });

  // The count of listed NFTs is a plural: Spanish says "1 publicado", never "1 publicados".
  it('gives the listed count a singular and a plural form', () => {
    const forms = (lang: string) => locale(lang)['nftMarket.badge.listedCount']!.split('|').map((form) => form.trim());
    for (const lang of READY_LANGUAGES) expect(forms(lang), lang).toHaveLength(2);
    expect(forms('es')).toEqual(['{count} publicado', '{count} publicados']);
  });

  it('keeps "sitzt fest" for a stuck NFT in German, as the other listing warnings do', () => {
    expect(locale('de')['signTx.listingNeverSells']).toContain('sitzt fest');
    expect(locale('de')['signTx.listingNeverSells']).not.toContain('festgesetzt');
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
