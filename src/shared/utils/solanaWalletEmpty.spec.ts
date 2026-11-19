import { describe, expect, it } from 'vitest';
import { isSolanaWalletEmpty } from './solanaWalletEmpty';

describe('isSolanaWalletEmpty', () => {
  it('is empty before the first sync and with nothing held', () => {
    expect(isSolanaWalletEmpty(null)).toBe(true);
    expect(isSolanaWalletEmpty({ lamports: null, tokens: null })).toBe(true);
    expect(isSolanaWalletEmpty({ lamports: '0', tokens: [{ mint: 'm', amount: '0', decimals: 6 }] })).toBe(true);
  });

  it('is not empty with SOL or with a token balance alone', () => {
    expect(isSolanaWalletEmpty({ lamports: '4899995000', tokens: [] })).toBe(false);
    expect(isSolanaWalletEmpty({ lamports: '0', tokens: [{ mint: 'm', amount: '25', decimals: 6 }] })).toBe(false);
  });

  it('treats an unreadable amount as nothing', () => {
    expect(isSolanaWalletEmpty({ lamports: 'x', tokens: [{ mint: 'm', amount: 'y', decimals: 6 }] })).toBe(true);
  });
});
