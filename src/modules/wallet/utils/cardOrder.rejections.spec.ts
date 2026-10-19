import { describe, expect, it } from 'vitest';
import {
  addressLine, emptyAddress, isMissingDetailsRejection, isStoredDetailsRejection, toProviderAddress,
} from './cardOrder';

describe('order rejections', () => {
  it('recognises Zione refusing characters in stored details', () => {
    expect(isStoredDetailsRejection('Address contains forbidden symbols!')).toBe(true);
    expect(isStoredDetailsRejection('First name contains Forbidden Symbols')).toBe(true);
    expect(isStoredDetailsRejection('Card order failed')).toBe(false);
    expect(isStoredDetailsRejection(undefined)).toBe(false);
  });

  it('recognises Zione refusing an order for missing details', () => {
    expect(isMissingDetailsRejection('The address field is required.')).toBe(true);
    expect(isMissingDetailsRejection('Missing field')).toBe(true);
    expect(isMissingDetailsRejection('User is unverified')).toBe(false);
    expect(isMissingDetailsRejection('')).toBe(false);
  });
});

describe('toProviderAddress', () => {
  it('rewrites the text fields of a known address and keeps phone and country', () => {
    const address = {
      streetAddress: 'Vnoučkova 2007,', city: 'Benešov', stateProvince: 'Středočeský kraj', zipCode: '256 01',
      countryCode: 'CZ', phone: '+420601234567',
    };
    expect(toProviderAddress(address)).toEqual({
      streetAddress: 'Vnouckova 2007', city: 'Benesov', stateProvince: 'Stredocesky kraj', zipCode: '256 01',
      countryCode: 'CZ', phone: '+420601234567',
    });
  });
});

describe('addressLine', () => {
  it('joins the parts that are present', () => {
    const address = { ...emptyAddress(), streetAddress: 'Vnouckova 2007', city: 'Benesov', zipCode: '25601', stateProvince: 'Stredocesky kraj', countryCode: 'CZ' };
    expect(addressLine(address, 'Czechia')).toBe('Vnouckova 2007, 25601 Benesov, Stredocesky kraj, Czechia');
    expect(addressLine({ ...address, stateProvince: '' })).toBe('Vnouckova 2007, 25601 Benesov, CZ');
  });
});
