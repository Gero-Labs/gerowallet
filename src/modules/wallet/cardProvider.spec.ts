import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CARD_PROVIDER } from './cardProvider';

const ROOT = join(__dirname, '..', '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/** The `const frameSrc = [ ... ];` literal from the manifest builder. */
function frameSrcBlock(): string {
  const manifest = read('scripts/manifest.ts');
  const start = manifest.indexOf('const frameSrc = [');
  expect(start).toBeGreaterThan(-1);
  return manifest.slice(start, manifest.indexOf('];', start));
}

describe('Gero Card provider wiring', () => {
  it('lets the extension frame the registration page', () => {
    const origin = new URL(CARD_PROVIDER.registrationUrl).origin;
    expect(frameSrcBlock()).toContain(`'${origin}/'`);
  });

  it('keeps the Zoho host the registration form submits to inside the frame', () => {
    expect(frameSrcBlock()).toContain("'https://forms.zohopublic.eu/'");
  });

  it('drops the retired kaiserex.com registration page from frame-src', () => {
    expect(frameSrcBlock()).not.toContain('kaiserex.com');
  });

  it('loads the registration page from the provider constant', () => {
    const modal = read('src/modules/wallet/components/KaiserexRegistrationModal.vue');
    expect(modal).toContain('CARD_PROVIDER.registrationUrl');
    expect(modal).not.toContain('kaiserex.com');
  });
});

describe('KaiserexAuthPage hygiene', () => {
  const page = read('src/modules/wallet/components/KaiserexAuthPage.vue');

  it('has no client-side fake login or 2FA', () => {
    expect(page).not.toMatch(/handleTwoFASubmit|twoFACode|showLoginForm|show2FAForm/);
  });

  it('never logs token data', () => {
    expect(page).not.toMatch(/console\.\w+\([^)]*token/i);
  });

  it('shows the provider name through i18n', () => {
    expect(page).toContain("{{ t('card.kaiserex') }}");
  });
});

describe('provider copy, legal facts and promotion date', () => {
  const locales = ['us', 'de', 'es'].map(l => read(`src/plugins/i18n/${l}.ts`));
  const walletSources = [
    'src/modules/wallet/components/KaiserexPartnershipSection.vue',
    'src/modules/wallet/components/KaiserexPartnershipBadge.vue',
    'src/modules/wallet/components/ApplicationStatusSection.vue',
  ].map(read);

  it('names the current legal entity and drops the old EU one', () => {
    for (const text of locales) {
      expect(text).toContain('Digi Ex Pro (Pty) Ltd');
      expect(text).toContain('2023/150340/07');
      expect(text).toContain('FSP 53786');
      expect(text).not.toMatch(/SmartAtlas|21766401|Satchel/);
    }
  });

  it('makes no partner claims Zione does not publish about itself', () => {
    expect(locales[0]).not.toMatch(/banking partner|10\+ Years|global regulations/i);
  });

  it('runs the zero-fees promotion until May 1st, 2027 in every locale', () => {
    const promo = /'card\.(enjoyZeroFeesUntil|startingMayFirst)': '([^']*)'/g;
    for (const text of locales) {
      const values = [...text.matchAll(promo)].map(m => m[2]);
      expect(values).toHaveLength(2);
      for (const value of values) expect(value).toMatch(/2027/);
    }
  });

  it('links to Zione, not kaiserex.com, and drops the outdated EU announcement', () => {
    for (const source of walletSources) {
      expect(source).not.toMatch(/kaiserex\.com|gero-card-satchel-eu-integration/);
    }
    expect(walletSources[2]).toContain('CARD_PROVIDER.supportEmail');
  });
});
