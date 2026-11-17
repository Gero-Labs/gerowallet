// Each chain's wallets get their own accent; Solana's is its purple -> green brand.
import { describe, expect, it } from 'vitest';
import { chainAccents, chainKeyFor, themes } from './themes';

describe('chain accents', () => {
  it('maps each wallet chain to its own palette, Cardano for anything else', () => {
    expect(chainKeyFor('Solana')).toBe('solana');
    expect(chainKeyFor('Bitcoin')).toBe('bitcoin');
    expect(chainKeyFor('Midnight')).toBe('midnight');
    expect(chainKeyFor('Cardano')).toBe('cardano');
    expect(chainKeyFor(undefined)).toBe('cardano');
  });

  it('gives Solana the brand green and a purple -> green gradient', () => {
    expect(chainAccents.solana).toEqual({ accent: '#14F195', gradient1: '#C084FC', gradient2: '#14F195' });
    expect(themes.solana.primary).toBe('#14F195');
  });
});
