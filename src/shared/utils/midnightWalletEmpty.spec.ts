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

  it('reads broadcast decimal strings', () => {
    expect(isMidnightWalletEmpty({ nightShielded: '0', nightUnshielded: '12', dust: '0' } as never)).toBe(false);
  });
});
