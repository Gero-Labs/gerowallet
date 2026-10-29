import { describe, it, expect } from 'vitest';
import { LAUNCHPADS, launchpadOf, type Launchpad } from '../launchpads';
import us from '@/plugins/i18n/us';

describe('launchpadOf', () => {
  it.each<[string | null | undefined, string | null | undefined, Launchpad | null]>([
    // snek.fun: curve-stage feed rows and graduates in the bulk list
    ['SNEKFUN', 'SNEKFUN', 'snekfun'],
    ['SNEKFUN_GRADUATE', 'MINSWAP', 'snekfun'],
    ['SNEKFUN_GRADUATE', null, 'snekfun'],
    // Solada: same contract
    ['SOLADA', 'SOLADA', 'solada'],
    ['SOLADA_GRADUATE', 'MINSWAP', 'solada'],
    ['SOLADA_GRADUATE', null, 'solada'],
    // dex alone identifies a curve-stage row whose source is missing
    [null, 'SNEKFUN', 'snekfun'],
    [undefined, 'SOLADA', 'solada'],
    // ordinary DEX-listed tokens
    ['MINSWAP', 'MINSWAP', null],
    [null, 'SUNDAESWAP', null],
    [null, null, null],
    [undefined, undefined, null],
    ['', '', null],
  ])('source=%s dex=%s -> %s', (source, dex, expected) => {
    expect(launchpadOf(source, dex)).toBe(expected);
  });

  it('matches the marker as a prefix of source only, case-sensitively', () => {
    expect(launchpadOf('XSOLADA')).toBeNull();
    expect(launchpadOf('solada_graduate')).toBeNull();
    expect(launchpadOf(null, 'SOLADA_GRADUATE')).toBeNull();
  });
});

describe('LAUNCHPADS', () => {
  it('keys every descriptor by its own id and has an i18n label for each', () => {
    for (const [key, lp] of Object.entries(LAUNCHPADS)) {
      expect(lp.id).toBe(key);
      expect(us[lp.labelKey as keyof typeof us]).toBeTruthy();
      expect(lp.icon).toMatch(/^mdi-[a-z-]+$/);
    }
  });

  it('pins the badge icons and labels', () => {
    expect(LAUNCHPADS.snekfun).toMatchObject({ marker: 'SNEKFUN', labelKey: 'market.snekfun', icon: 'mdi-snake' });
    expect(LAUNCHPADS.solada).toMatchObject({ marker: 'SOLADA', labelKey: 'market.solada', icon: 'mdi-rocket-launch-outline' });
    expect(us['market.solada' as keyof typeof us]).toBe('Solada');
  });
});
