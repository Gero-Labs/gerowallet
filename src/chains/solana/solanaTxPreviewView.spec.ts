import { describe, expect, it } from 'vitest';
import { signedUnits, solanaChangeRows, solanaWarningKey, solanaWarningRows } from './solanaTxPreviewView';
import type { SolanaPreviewWarning } from './solanaTxPreview';

describe('signedUnits', () => {
  it('signs and trims, and drops zero', () => {
    expect(signedUnits('-1500000000', 9)).toEqual({ amount: '−1.5', direction: 'out' });
    expect(signedUnits('2500000', 6)).toEqual({ amount: '+2.5', direction: 'in' });
    expect(signedUnits('0', 6)).toBeNull();
    expect(signedUnits('-0', 6)).toBeNull();
    expect(signedUnits('1e5', 6)).toBeNull();
  });
});

describe('solanaChangeRows', () => {
  it('lists SOL first, then tokens, skipping no-change rows', () => {
    expect(solanaChangeRows({ solChange: '-5000', tokenChanges: [{ mint: 'M', decimals: 2, change: '150' }, { mint: 'Z', decimals: 2, change: '0' }] }))
      .toEqual([
        { asset: 'SOL', isSol: true, amount: '−0.000005', direction: 'out' },
        { asset: 'M', isSol: false, amount: '+1.5', direction: 'in' },
      ]);
    expect(solanaChangeRows({ solChange: null, tokenChanges: [] })).toEqual([]);
  });
});

describe('solana warning rows', () => {
  const w = (code: string, severity: 'critical' | 'warning', extra: object = {}) => ({ code, severity, ...extra }) as SolanaPreviewWarning;

  it('maps every warning to a message and puts critical ones first, once each', () => {
    const rows = solanaWarningRows({ warnings: [
      w('UNKNOWN_PROGRAMS', 'warning', { programs: ['x'] }),
      w('GIVES_TOKEN_AUTHORITY', 'critical', { account: 'a', newAuthority: 'b' }),
      w('TOKEN_ACCOUNT_OWNER_CHANGED', 'critical', { account: 'c', newOwner: 'd' }),
      w('TOKEN_DELEGATE', 'critical', { account: 'a', delegate: 'b', amount: '1', unlimited: true }),
    ] });
    expect(rows).toEqual([
      { key: 'solana.dapp.warn.givesTokenAccount', critical: true },
      { key: 'solana.dapp.warn.delegateUnlimited', critical: true },
      { key: 'solana.dapp.warn.unknownPrograms', critical: false },
    ]);
    expect(solanaWarningKey(w('DURABLE_NONCE', 'warning', { nonceAccount: 'n' }))).toBe('solana.dapp.warn.durableNonce');
  });
});
