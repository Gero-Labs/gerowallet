import { describe, expect, it } from 'vitest';
import { hasMidnightProvingConsent } from './midnightProvingConsent';

describe('remote Midnight proving consent', () => {
  it('does not reuse consent for a different witness recipient', () => {
    const consent = { version: 2, acceptedAt: 123, provider: 'cloud' };
    expect(hasMidnightProvingConsent(consent, 'cloud')).toBe(true);
    expect(hasMidnightProvingConsent(consent, 'zkpaas')).toBe(false);
    expect(hasMidnightProvingConsent({ ...consent, provider: 'zkpaas' }, 'zkpaas')).toBe(true);
  });
  it.each([null, {}, { version: 1, acceptedAt: 123 }, { version: 2, acceptedAt: 123 },
    { version: 2, acceptedAt: NaN, provider: 'cloud' }, { version: 2, acceptedAt: 0, provider: 'cloud' },
  ])('rejects old shielded-only and corrupt consent %#', consent => {
    expect(hasMidnightProvingConsent(consent, 'cloud')).toBe(false);
  });
});
