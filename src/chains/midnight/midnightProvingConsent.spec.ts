import { describe, expect, it } from 'vitest';
import { hasMidnightProvingConsent } from './midnightProvingConsent';

describe('remote Midnight proving consent', () => {
  it('does not reuse consent for a different witness recipient', () => {
    const consent = { version: 3, acceptedAt: 123, provider: 'cloud' };
    expect(hasMidnightProvingConsent(consent, 'cloud')).toBe(true);
    expect(hasMidnightProvingConsent(consent, 'zkpaas')).toBe(false);
    expect(hasMidnightProvingConsent({ ...consent, provider: 'zkpaas' }, 'zkpaas')).toBe(true);
  });
  it.each([null, {}, { version: 1, acceptedAt: 123 }, { version: 3, acceptedAt: 123 },
    { version: 3, acceptedAt: NaN, provider: 'cloud' }, { version: 3, acceptedAt: 0, provider: 'cloud' },
    // v2 predates the key-material disclosure (PRIV-01): the user must accept again.
    { version: 2, acceptedAt: 123, provider: 'cloud' },
  ])('rejects old shielded-only, pre-disclosure and corrupt consent %#', consent => {
    expect(hasMidnightProvingConsent(consent, 'cloud')).toBe(false);
  });
});
