import { describe, expect, it } from 'vitest';
import type { CardInfo } from '@/models/card';
import { emptyAddress, lovelaceFromAda, savedDeliveryAddress, toOrderPayload } from './cardOrder';

describe('lovelaceFromAda', () => {
  it('converts exact amounts', () => {
    expect(lovelaceFromAda('47.5')).toBe(47_500_000n);
    expect(lovelaceFromAda(10)).toBe(10_000_000n);
    expect(lovelaceFromAda('0.000001')).toBe(1n);
  });

  it('rounds up past six decimals so the quote is always covered', () => {
    expect(lovelaceFromAda('47.99946773')).toBe(47_999_468n);
    expect(lovelaceFromAda('1.00000000')).toBe(1_000_000n);
  });

  it('refuses non-amounts and zero', () => {
    for (const value of ['', 'abc', '-1', '1e3', '0', '0.0000000', null, undefined]) {
      expect(lovelaceFromAda(value)).toBeNull();
    }
  });
});

describe('savedDeliveryAddress', () => {
  const card = (updated: string, address: string) =>
    ({
      cardData: {
        own_type: 'physical',
        updated_at: updated,
        delivery: { address, city: 'Lisbon', region: 'Lisbon', zip: '1100-048', country_code: 'PT', phone: '+351' },
      },
    }) as unknown as CardInfo;

  it('uses the most recently updated physical card', () => {
    const saved = savedDeliveryAddress([card('2026-01-01', 'Old street 1'), card('2026-06-01', 'New street 2')]);
    expect(saved?.streetAddress).toBe('New street 2');
    expect(saved?.countryCode).toBe('PT');
  });

  it('is null without a physical card', () => {
    expect(savedDeliveryAddress([])).toBeNull();
  });
});

describe('toOrderPayload', () => {
  it('maps and trims the form fields', () => {
    const payload = toOrderPayload(
      { ...emptyAddress(), streetAddress: ' Rua Augusta 120 ', city: 'Lisbon ', stateProvince: 'Lisbon', zipCode: '1100-048', countryCode: 'PT', phone: '+351912345678' },
      'regular',
    );
    expect(payload).toEqual({
      address: 'Rua Augusta 120',
      region: 'Lisbon',
      city: 'Lisbon',
      zipCode: '1100-048',
      countryCode: 'PT',
      phone: '+351912345678',
      deliveryMethod: 'regular',
    });
  });
});
