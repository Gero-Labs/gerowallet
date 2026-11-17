import { describe, it, expect } from 'vitest';
import { listedTokens, tokenRowDecimals, type ListableToken } from './listedTokens';

const token = (fields: ListableToken & { unit: string }) => fields;

describe('listedTokens', () => {
  const spendable = {
    ada: token({ unit: 'lovelace', policy_id: '', verified: true }),
    snek: token({ unit: 'snek', policy_id: 'p1', verified: true }),
    scam: token({ unit: 'scam', policy_id: 'p2', verified: true, isScam: true }),
    stranger: token({ unit: 'stranger', policy_id: 'p3', verified: false }),
  };
  const programmable = {
    micky: token({ unit: 'micky', policy_id: 'p4', isProgrammable: true, cip113Registered: true, verified: false }),
    dum: token({ unit: 'dum', policy_id: 'p5', isProgrammable: true, cip113Registered: true }),
    unregistered: token({ unit: 'unregistered', policy_id: 'p6', isProgrammable: true, cip113Registered: false, verified: false }),
  };

  it('lists verified spendable tokens and registered CIP-113 holdings', () => {
    expect(listedTokens(spendable, programmable).map((t) => t.unit)).toEqual(['snek', 'micky', 'dum']);
  });

  // The header used to count only verified spendable tokens, so a wallet holding three
  // CIP-113 tokens showed "Tokens 1" above four rows.
  it('counts CIP-113 holdings, which have no row of their own in walletStore.tokens', () => {
    expect(listedTokens({ ada: spendable.ada }, programmable)).toHaveLength(2);
  });

  it('lists nothing before the wallet has tokens', () => {
    expect(listedTokens(null, programmable)).toEqual([]);
    expect(listedTokens(spendable, null).map((t) => t.unit)).toEqual(['snek']);
  });
});

describe('tokenRowDecimals', () => {
  // Issue 1441: the token sheet read the top level alone, where a wallet token has nothing.
  it('reads a wallet token\'s decimals from its metadata', () => {
    expect(tokenRowDecimals({ metadata: { decimals: 2 } })).toBe(2);
    expect(tokenRowDecimals({ metadata: { decimals: 0 } })).toBe(0);
  });

  it('reads the pinned ADA row\'s top-level decimals', () => {
    expect(tokenRowDecimals({ decimals: 6 })).toBe(6);
  });

  it('states nothing when the row does, so each caller picks its own default', () => {
    expect(tokenRowDecimals({ metadata: {} })).toBeUndefined();
    expect(tokenRowDecimals({ metadata: null })).toBeUndefined();
    expect(tokenRowDecimals(null)).toBeUndefined();
  });

  it('takes a whole number written as text, and nothing else', () => {
    expect(tokenRowDecimals({ metadata: { decimals: '2' } })).toBe(2);
    for (const decimals of [-1, 1.5, Number.NaN, '2.5', '', true]) {
      expect(tokenRowDecimals({ metadata: { decimals } })).toBeUndefined();
    }
  });
});
