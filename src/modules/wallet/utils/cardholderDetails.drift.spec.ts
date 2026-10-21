import { describe, expect, it } from 'vitest';
import { cardholderFieldErrors, parseMissingFields } from './cardholderDetails';

// Zione's published spec has drifted from its live API before, so the wallet reads the
// documented shape and the likely alternatives instead of needing a hotfix.
describe('spec drift tolerance', () => {
  it('reads the missing fields from the documented key, a camelCase key or a bare array', () => {
    expect(parseMissingFields({ missing_fields: ['address'] })).toEqual(['address']);
    expect(parseMissingFields({ missingFields: ['address'] })).toEqual(['address']);
    expect(parseMissingFields(['address', 'city'])).toEqual(['address', 'city']);
  });

  it('accepts other spellings of the same field', () => {
    expect(parseMissingFields({ missing_fields: ['first_name', 'Last-Name', 'BIRTHDATE', 'zip_code'] }))
      .toEqual(['firstName', 'lastName', 'birthDate', 'zipCode']);
    expect(parseMissingFields({ missing_fields: ['country_code', 'postal_code', 'date_of_birth', 'phone_number'] }))
      .toEqual(['birthDate', 'phone', 'zipCode', 'country']);
  });

  it('leaves out fields the wallet cannot ask for', () => {
    expect(parseMissingFields({ missing_fields: ['passportNumber', 'passport_expiry_date'] })).toEqual([]);
  });

  it('maps validation errors under other spellings onto the form fields', () => {
    const error = { response: { status: 422, data: { errors: { zip_code: ['Zip code contains forbidden symbols!'], birth_date: 'Invalid date' } } } };
    expect(cardholderFieldErrors(error)).toEqual({
      zipCode: 'Zip code contains forbidden symbols!',
      birthDate: 'Invalid date',
    });
  });
});
