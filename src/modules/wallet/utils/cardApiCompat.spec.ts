import { describe, expect, it } from 'vitest';
import { cardUuidFromOrderStatus, depositAddressFromResponse } from './cardApiCompat';

describe('depositAddressFromResponse', () => {
  it('reads wallet_address first, then the spec name address', () => {
    expect(depositAddressFromResponse({ wallet_address: 'addr1a' })).toBe('addr1a');
    expect(depositAddressFromResponse({ address: 'addr1b' })).toBe('addr1b');
    expect(depositAddressFromResponse({ wallet_address: '', address: 'addr1c' })).toBe('addr1c');
  });

  it('returns null for anything else', () => {
    expect(depositAddressFromResponse(null)).toBeNull();
    expect(depositAddressFromResponse({})).toBeNull();
    expect(depositAddressFromResponse('addr1d')).toBeNull();
    expect(depositAddressFromResponse({ address: 42 })).toBeNull();
  });
});

describe('cardUuidFromOrderStatus', () => {
  it('reads the spec name cardUuid, then card_uuid', () => {
    expect(cardUuidFromOrderStatus({ status: 'done', cardUuid: 'u1' })).toBe('u1');
    expect(cardUuidFromOrderStatus({ status: 'done', card_uuid: 'u2' })).toBe('u2');
  });

  it('returns null while the card is not issued', () => {
    expect(cardUuidFromOrderStatus({ status: 'new' })).toBeNull();
    expect(cardUuidFromOrderStatus({ status: 'new', cardUuid: '' })).toBeNull();
    expect(cardUuidFromOrderStatus(undefined)).toBeNull();
  });
});
