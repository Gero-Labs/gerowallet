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
