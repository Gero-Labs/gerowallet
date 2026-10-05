import { describe, expect, it } from 'vitest';
import { providerReason } from './cardApiErrors';

const failure = (data: unknown) => ({ response: { data } });

describe('providerReason', () => {
  it('reads a plain-text body', () => {
    expect(providerReason(failure('Country is not supported!'))).toBe('Country is not supported!');
  });

  it('reads error, error.message, reason and message in that order', () => {
    expect(providerReason(failure({ error: 'Order limit reached' }))).toBe('Order limit reached');
    expect(providerReason(failure({ error: { message: 'Card already ordered' } }))).toBe('Card already ordered');
    expect(providerReason(failure({ reason: 'KYC pending' }))).toBe('KYC pending');
    expect(providerReason(failure({ message: 'Bad request' }))).toBe('Bad request');
  });

  it('is undefined when there is nothing to show', () => {
    expect(providerReason(failure({}))).toBeUndefined();
    expect(providerReason(failure('  '))).toBeUndefined();
    expect(providerReason(new Error('network'))).toBeUndefined();
    expect(providerReason(null)).toBeUndefined();
  });
});
