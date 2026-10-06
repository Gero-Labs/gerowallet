import { describe, expect, it } from 'vitest';
import countries from './countries';

describe('Gero Card delivery countries', () => {
  it('includes South Africa, the card programme’s home jurisdiction', () => {
    expect(countries).toContainEqual({ code: 'ZA', label: 'South Africa' });
  });

  it('has unique ISO 3166-1 alpha-2 codes', () => {
    const codes = countries.map(c => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[A-Z]{2}$/);
  });
});
