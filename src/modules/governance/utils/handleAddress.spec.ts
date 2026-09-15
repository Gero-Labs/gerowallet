// What a DRep publishes as their payment address.
//
// The DRep registration form accepts an ADA Handle in the payment-address field,
// and what goes into the CIP-119 document is the ADDRESS it resolves to. These
// cases guard the acceptance rule, because the failure mode is not a broken
// screen: it is a permanent published document pointing delegators' support at
// the wrong place, fixable only by hosting and hashing a new one.
import { describe, it, expect } from 'vitest';
import { handleName, looksLikeHandle, readHandleResponse } from './handleAddress';

/**
 * A mainnet enterprise address with a real bech32 checksum, so the validation is
 * genuinely exercised. Built from a known key hash rather than copied: several
 * `addr1...` fixtures elsewhere in this repo are hand-written strings that do
 * NOT check out, and they pass only in tests that never validate them.
 */
const ADDRESS = 'addr1vx42424242424242424242424242424242424242424242s9f9j4p';
const STAKE = 'stake1u86ndjr6s9vpkpzdtu4fdzlznj4gnx9cet2fcekjuuudntgjprfc5';

const ok = (ada: unknown) => ({ status: 200, data: { resolved_addresses: { ada } } });

describe('readHandleResponse, only a real payment address is accepted', () => {
  it('takes the resolved address', () => {
    expect(readHandleResponse(ok(ADDRESS))).toEqual({ status: 'resolved', address: ADDRESS });
  });

  it('trims surrounding whitespace before validating', () => {
    expect(readHandleResponse(ok(`  ${ADDRESS}  `))).toEqual({ status: 'resolved', address: ADDRESS });
  });

  it.each([
    ['a null address', ok(null)],
    ['an empty string', ok('')],
    ['whitespace only', ok('   ')],
    ['a number', ok(42)],
    ['an object', ok({ address: ADDRESS })],
    ['nonsense', ok('not-an-address')],
  ])('misses on %s', (_label, response) => {
    // Each of these used to be "truthy enough" to publish under a looser check.
    expect(readHandleResponse(response)).toEqual({ status: 'notFound' });
  });

  it('accepts a reward address, because the shared validator does', () => {
    // Not an endorsement: `isPaymentAddress` is
    // `Cardano.Address.isValid() || isValidByron()`, which admits stake
    // addresses, and `validateCip119Profile` gates the manually-typed value on
    // that same helper. Pinned as-is so the two paths cannot drift; tightening
    // it belongs in the shared helper, where the send flows would benefit too.
    expect(readHandleResponse(ok(STAKE))).toEqual({ status: 'resolved', address: STAKE });
  });

  it.each([
    ['a non-200 that still carries a body', { status: 404, data: { resolved_addresses: { ada: ADDRESS } } }],
    ['no resolved_addresses', { status: 200, data: {} }],
    ['a null resolved_addresses', { status: 200, data: { resolved_addresses: null } }],
    ['no data', { status: 200 }],
    ['null', null],
    ['a string', 'nope'],
    ['undefined', undefined],
  ])('misses on %s', (_label, response) => {
    expect(readHandleResponse(response)).toEqual({ status: 'notFound' });
  });
});

describe('handle shape', () => {
  it('recognises a handle, and not a bare $ or an address', () => {
    expect(looksLikeHandle('$musicbox')).toBe(true);
    expect(looksLikeHandle('  $musicbox  ')).toBe(true);
    expect(looksLikeHandle('$')).toBe(false);
    expect(looksLikeHandle(ADDRESS)).toBe(false);
    expect(looksLikeHandle('')).toBe(false);
  });

  it('strips the leading $ the field displays', () => {
    expect(handleName('$musicbox')).toBe('musicbox');
    expect(handleName('  $musicbox ')).toBe('musicbox');
    // Only the LEADING one: `$` is legal inside a handle name.
    expect(handleName('$music$box')).toBe('music$box');
  });
});
