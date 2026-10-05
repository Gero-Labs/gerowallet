import { describe, expect, it } from 'vitest';
import { heldUnits, MAINNET_USDCX_UNIT, usdcxAssetIdFor } from './assets';

describe('heldUnits', () => {
  const id = MAINNET_USDCX_UNIT;

  it('reads whole quantities as exact decimal strings', () => {
    expect(heldUnits({ [id]: { quantity: '12500000' } }, id)).toBe('12500000');
    expect(heldUnits({ [id]: { quantity: 12500000 } }, id)).toBe('12500000');
    expect(heldUnits({ [id]: { quantity: 123456789012345678901n } }, id)).toBe('123456789012345678901');
  });

  it('treats anything else as nothing held', () => {
    expect(heldUnits({}, id)).toBe('0');
    expect(heldUnits(undefined, id)).toBe('0');
    expect(heldUnits({ [id]: { quantity: '12.5' } }, id)).toBe('0');
    expect(heldUnits({ [id]: { quantity: -1 } }, id)).toBe('0');
    expect(heldUnits({ [id]: { quantity: -1n } }, id)).toBe('0');
    expect(heldUnits({ [id]: { quantity: '1' } }, null)).toBe('0');
  });
});

describe('usdcxAssetIdFor', () => {
  it('knows USDCx on mainnet only', () => {
    expect(usdcxAssetIdFor('Mainnet')).toBe(MAINNET_USDCX_UNIT);
    expect(usdcxAssetIdFor('Preprod')).toBeNull();
    expect(usdcxAssetIdFor(undefined)).toBeNull();
  });
});
