import { describe, it, expect } from 'vitest';
import { detectHeldTokenMention } from './tokenMention';

const tokens = {
  lovelace: { unit: 'lovelace' },
  night: { unit: 'policyNIGHT.4e49474854', metadata: { ticker: 'NIGHT' } },
  snek: { unit: 'policySNEK.534e454b', metadata: { ticker: 'SNEK' } },
  ada2: { unit: 'policyXY.00', metadata: { ticker: 'XY' } }, // too short, ignored
};

describe('detectHeldTokenMention', () => {
  it('matches a held token ticker mentioned in the message and returns its unit as assetId', () => {
    expect(detectHeldTokenMention("what's the price of NIGHT", tokens as never)).toEqual({
      symbol: 'NIGHT',
      assetId: 'policyNIGHT.4e49474854',
    });
  });

  it('is case-insensitive and word-bounded', () => {
    expect(detectHeldTokenMention('how is snek doing today', tokens as never)?.symbol).toBe('SNEK');
    // substring inside another word must NOT match
    expect(detectHeldTokenMention('snekkers are great', tokens as never)).toBeNull();
  });

  it('returns null when no held token is mentioned', () => {
    expect(detectHeldTokenMention('how is my portfolio', tokens as never)).toBeNull();
    expect(detectHeldTokenMention('', tokens as never)).toBeNull();
  });

  it('ignores lovelace and tickers shorter than 3 chars', () => {
    expect(detectHeldTokenMention('show me XY', tokens as never)).toBeNull();
  });

  it('prefers the longest matching ticker', () => {
    const t = {
      a: { unit: 'uA', metadata: { ticker: 'IAG' } },
      b: { unit: 'uB', metadata: { ticker: 'IAGON' } },
    };
    expect(detectHeldTokenMention('thoughts on IAGON?', t as never)?.symbol).toBe('IAGON');
  });
});
