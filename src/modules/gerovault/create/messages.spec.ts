// Every key the create flow shows exists in every language, including the keys the screens name
// directly in their templates.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import us from '@/plugins/i18n/us';
import de from '@/plugins/i18n/de';
import es from '@/plugins/i18n/es';
import { ALL_CREATE_MESSAGE_KEYS } from './messages';

const catalogs: Record<string, Record<string, string>> = { us, de, es };

function keysInScreens(): string[] {
  const dir = join(__dirname);
  const files = [...readdirSync(dir).filter(f => f.endsWith('.vue') || (f.endsWith('.ts') && !f.endsWith('.spec.ts'))).map(f => join(dir, f)),
    join(dir, '..', 'views', 'GerovaultCreate.vue')];
  const keys = new Set<string>();
  for (const file of files) {
    for (const match of readFileSync(file, 'utf8').matchAll(/'(gerovault\.create\.[A-Za-z0-9_.-]+)'/g)) keys.add(match[1]);
  }
  return [...keys];
}

describe('create flow messages', () => {
  it.each(Object.keys(catalogs))('are all in %s', lang => {
    const missing = [...ALL_CREATE_MESSAGE_KEYS, ...keysInScreens()].filter(key => typeof catalogs[lang][key] !== 'string');
    expect(missing).toEqual([]);
  });

  it('use no long dash in any language', () => {
    for (const catalog of Object.values(catalogs)) {
      const ours = Object.entries(catalog).filter(([key]) => key.startsWith('gerovault.create.'));
      expect(ours.length).toBeGreaterThan(100);
      expect(ours.filter(([, text]) => /[\u2013\u2014]/.test(text))).toEqual([]);
    }
  });
});
