import { describe, expect, it } from 'vitest';
import { isMidnightWalletEmpty } from './midnightWalletEmpty';

const zero = { nightShielded: 0n, nightUnshielded: 0n, dust: 0n };

describe('isMidnightWalletEmpty', () => {
  it('is empty with nothing held and before the first sync', () => {
    expect(isMidnightWalletEmpty(null)).toBe(true);
    expect(isMidnightWalletEmpty(zero)).toBe(true);
    expect(isMidnightWalletEmpty({ ...zero, shieldedTokens: { abc: 0n } })).toBe(true);
  });

  it('is not empty with NIGHT on either side, DUST or a shielded token', () => {
    expect(isMidnightWalletEmpty({ ...zero, nightUnshielded: 5n })).toBe(false);
    expect(isMidnightWalletEmpty({ ...zero, nightShielded: 5n })).toBe(false);
    expect(isMidnightWalletEmpty({ ...zero, dust: 1n })).toBe(false);
    expect(isMidnightWalletEmpty({ ...zero, shieldedTokens: { abc: 7n } })).toBe(false);
  });

  it('is not empty with an unshielded token such as USDM', () => {
    const usdm = { tokenType: 'ab'.repeat(32), value: 9_990_000n };
    expect(isMidnightWalletEmpty(zero, [usdm])).toBe(false);
    expect(isMidnightWalletEmpty(null, [usdm])).toBe(false);
    expect(isMidnightWalletEmpty(zero, [{ ...usdm, value: '9990000' as never }])).toBe(false);
  });

  it('ignores NIGHT and zero-value UTxOs, which the balance fields already cover', () => {
    expect(isMidnightWalletEmpty(zero, [{ tokenType: '0'.repeat(64), value: 5n }])).toBe(true);
    expect(isMidnightWalletEmpty(zero, [{ tokenType: '', value: 5n }])).toBe(true);
    expect(isMidnightWalletEmpty(zero, [{ tokenType: 'ab'.repeat(32), value: 0n }])).toBe(true);
  });

  it('reads broadcast decimal strings', () => {
    expect(isMidnightWalletEmpty({ nightShielded: '0', nightUnshielded: '12', dust: '0' } as never)).toBe(false);
  });
});
