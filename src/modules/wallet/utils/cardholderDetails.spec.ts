import { describe, expect, it } from 'vitest';
import {
  cardholderFieldErrors, emptyCardholderDetails, invalidCharacters, isAdultBirthDate, latestAdultBirthDate,
  parseMissingFields, residentialAddress, toCardholderPayload, toProviderBirthDate, toProviderText,
} from './cardholderDetails';

describe('toProviderText', () => {
  it('rewrites the Czech address Zione refused into accepted characters', () => {
    expect(toProviderText('Vnoučkova 2007,')).toBe('Vnouckova 2007');
    expect(toProviderText('Středočeský kraj')).toBe('Stredocesky kraj');
    expect(toProviderText('Benešov')).toBe('Benesov');
  });

  it('spells out letters that have no accent to drop', () => {
    expect(toProviderText('Straße')).toBe('Strasse');
    expect(toProviderText('Øster Allé')).toBe('Oster Alle');
    expect(toProviderText('Łódź')).toBe('Lodz');
  });

  it('turns punctuation into spaces or hyphens and drops apostrophes', () => {
    expect(toProviderText("O'Brien")).toBe('OBrien');
    expect(toProviderText('St. John, Apt. 5')).toBe('St John Apt 5');
    expect(toProviderText('12/3   Main  St')).toBe('12-3 Main St');
  });

  it('leaves characters it cannot convert for the validator', () => {
    expect(toProviderText('Улица 5 #2')).toBe('Улица 5 #2');
  });

  it('produces text that passes the address rule for common European input', () => {
    for (const input of ['Vnoučkova 2007,', 'Rua Augusta, 120', 'Calle Mayor nº 5', 'Hauptstraße 12a']) {
      expect(invalidCharacters(toProviderText(input), 'text')).toEqual([]);
    }
  });
});

describe('invalidCharacters', () => {
  it('lists each refused character once, in order', () => {
    expect(invalidCharacters('Vnoučkova 2007, Benešov', 'text')).toEqual(['č', ',', 'š']);
    expect(invalidCharacters('#1 & #2', 'text')).toEqual(['#', '&']);
  });

  it('refuses digits in names but not in addresses', () => {
    expect(invalidCharacters('Anne-Marie 2', 'name')).toEqual(['2']);
    expect(invalidCharacters('Anne-Marie', 'name')).toEqual([]);
    expect(invalidCharacters('221B Baker Street', 'text')).toEqual([]);
  });
});

describe('parseMissingFields', () => {
  it('keeps known fields in form order and drops anything else', () => {
    expect(parseMissingFields({ missing_fields: ['zipCode', 'passportNumber', 'firstName', 'address'] }))
      .toEqual(['firstName', 'address', 'zipCode']);
  });

  it('is empty for an empty list or a malformed body', () => {
    expect(parseMissingFields({ missing_fields: [] })).toEqual([]);
    for (const body of [null, undefined, 'User is not a Gerowallet user', { missing_fields: 'address' }, {}]) {
      expect(parseMissingFields(body)).toEqual([]);
    }
  });
});

describe('birth date', () => {
  const today = new Date(2026, 9, 19);

  it('converts a date input value to dd.MM.yyyy', () => {
    expect(toProviderBirthDate('1977-02-13')).toBe('13.02.1977');
    expect(toProviderBirthDate('13.02.1977')).toBe('');
    expect(toProviderBirthDate('')).toBe('');
  });

  it('accepts someone who turns 18 today and refuses a day younger', () => {
    expect(latestAdultBirthDate(today)).toBe('2008-10-19');
    expect(isAdultBirthDate('2008-10-19', today)).toBe(true);
    expect(isAdultBirthDate('2008-10-20', today)).toBe(false);
  });

  it('refuses dates that do not exist or are implausibly old', () => {
    expect(isAdultBirthDate('2001-02-30', today)).toBe(false);
    expect(isAdultBirthDate('1899-12-31', today)).toBe(false);
    expect(isAdultBirthDate('', today)).toBe(false);
  });
});

describe('toCardholderPayload', () => {
  it('sends only the listed fields, trimmed, with the date in Zione format', () => {
    const values = { ...emptyCardholderDetails(), firstName: ' John ', lastName: 'Doe', birthDate: '1977-02-13', city: 'London' };
    expect(toCardholderPayload(values, ['firstName', 'birthDate'])).toEqual({ firstName: 'John', birthDate: '13.02.1977' });
  });
});

describe('cardholderFieldErrors', () => {
  const refused = (status: number, data: unknown) => ({ response: { status, data } });

  it('maps the first message of each known field from a 422', () => {
    const error = refused(422, {
      message: 'Zip code contains forbidden symbols!',
      errors: { zipCode: ['Zip code contains forbidden symbols!', 'second'], birthDate: ['Date of Birth format is invalid!'], other: ['x'] },
    });
    expect(cardholderFieldErrors(error)).toEqual({
      zipCode: 'Zip code contains forbidden symbols!',
      birthDate: 'Date of Birth format is invalid!',
    });
  });

  it('is empty for anything that is not a 422 with field errors', () => {
    expect(cardholderFieldErrors(refused(400, 'Failed to save Cardholder details'))).toEqual({});
    expect(cardholderFieldErrors(refused(422, { message: 'x' }))).toEqual({});
    expect(cardholderFieldErrors(new Error('network'))).toEqual({});
  });
});

describe('residentialAddress', () => {
  const values = {
    ...emptyCardholderDetails(),
    address: 'Vnouckova 2007', city: 'Benesov', region: 'Stredocesky kraj', zipCode: '25601', country: 'CZ', phone: '+420601234567',
  };
  const home = ['address', 'city', 'region', 'zipCode', 'country'] as const;

  it('is the delivery address when the whole home address was in the form', () => {
    expect(residentialAddress(values, [...home, 'phone'])).toEqual({
      streetAddress: 'Vnouckova 2007', city: 'Benesov', stateProvince: 'Stredocesky kraj', zipCode: '25601', countryCode: 'CZ', phone: '+420601234567',
    });
    expect(residentialAddress(values, [...home])?.phone).toBe('');
  });

  it('is null when only part of the address was asked for', () => {
    expect(residentialAddress(values, ['address', 'city'])).toBeNull();
  });
});
