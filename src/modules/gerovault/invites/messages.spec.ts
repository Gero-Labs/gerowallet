// Every key the invitation screens show exists in every language: the code maps, the keys the
// templates name, and the ones built from a status.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import us from '@/plugins/i18n/us';
import de from '@/plugins/i18n/de';
import es from '@/plugins/i18n/es';
import { ALL_INVITE_MESSAGE_KEYS } from './messages';

const catalogs: Record<string, Record<string, string>> = { us, de, es };

function keysInScreens(): string[] {
  const dir = join(__dirname);
  const files = [
    ...readdirSync(dir).filter(f => f.endsWith('.vue') || (f.endsWith('.ts') && !f.endsWith('.spec.ts'))).map(f => join(dir, f)),
    join(dir, '..', 'create', 'CosignerCard.vue'),
    join(dir, '..', 'create', 'OwnKeysCard.vue'),
    join(dir, '..', 'create', 'VerifyStep.vue'),
    join(dir, '..', 'views', 'GerovaultCreate.vue'),
    join(dir, '..', '..', '..', 'shared', 'components', 'NotifyInbox.vue'),
  ];
  const keys = new Set<string>();
  for (const file of files) {
    for (const match of readFileSync(file, 'utf8').matchAll(/'(gerovault\.invite\.[A-Za-z0-9_.-]+[A-Za-z0-9_-])'/g)) keys.add(match[1]);
  }
  return [...keys];
}

/** Keys a template builds from a value: every value it can take. */
const BUILT = [
  ...['waiting', 'accepted', 'verified', 'unverified', 'declined', 'revoked', 'expired', 'empty'].map(s => `gerovault.invite.status.${s}`),
  ...['declined', 'revoked', 'expired'].map(s => `gerovault.invite.card.ended.${s}`),
  ...['invite', 'qr', 'link'].map(s => `gerovault.invite.card.joinedVia.${s}`),
];

describe('invitation messages', () => {
  it.each(Object.keys(catalogs))('are all in %s', lang => {
    const missing = [...ALL_INVITE_MESSAGE_KEYS, ...keysInScreens(), ...BUILT].filter(key => typeof catalogs[lang][key] !== 'string');
    expect(missing).toEqual([]);
  });

  it('use no long dash and keep German formal', () => {
    for (const catalog of Object.values(catalogs)) {
      const ours = Object.entries(catalog).filter(([key]) => key.startsWith('gerovault.invite.'));
      expect(ours.length).toBeGreaterThan(150);
      expect(ours.filter(([, text]) => /[–—]/.test(text))).toEqual([]);
    }
    const informal = Object.entries(de).filter(([key, text]) => key.startsWith('gerovault.invite.') && /\b(du|dein\w*|dich|dir)\b/i.test(text));
    expect(informal).toEqual([]);
  });
});
