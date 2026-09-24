import { describe, it, expect } from 'vitest';
import { rewardAddressToBech32, treasuryWithdrawalsOf } from './treasuryWithdrawals';

// A live mainnet treasury withdrawal (418df598…#0): yaci sends the key as hex,
// Koios lists the same withdrawal under the bech32 address below.
const HEX = 'f1eb06997a94b339ee0b0dd0de7bfec2a184d1af577586654d44e90558';
const BECH32 = 'stake1784sdxt6jjennmstphgdu7l7c2scf5d02a6cve2dgn5s2kq5u3j9v';

describe('rewardAddressToBech32', () => {
  it('re-encodes a hex reward address as the stake address Koios shows', () => {
    expect(rewardAddressToBech32(HEX)).toBe(BECH32);
  });

  it('uses the testnet prefix for a network-0 header', () => {
    const testnet = `e0${'ab'.repeat(28)}`;
    expect(rewardAddressToBech32(testnet).startsWith('stake_test1')).toBe(true);
  });

  it('leaves bech32, and hex that is not a reward address, as sent', () => {
    expect(rewardAddressToBech32(BECH32)).toBe(BECH32);
    // A base-address header (0x01) at the same length is not a reward address.
    const base = `01${'ab'.repeat(28)}`;
    expect(rewardAddressToBech32(base)).toBe(base);
    expect(rewardAddressToBech32('not-hex')).toBe('not-hex');
  });
});

describe('treasuryWithdrawalsOf', () => {
  it('reads the live payload shape', () => {
    const payload = {
      type: 'TREASURY_WITHDRAWALS_ACTION',
      policyHash: 'fa24fb305126805cf2164c161d852a0e7330cf988f1fe558cf7d4a64',
      withdrawals: { [HEX]: 11787063000000 },
    };
    expect(treasuryWithdrawalsOf(payload)).toEqual([{ rewardAddress: BECH32, lovelace: 11787063000000n }]);
  });

  it('keeps an amount that arrived as a decimal string exact', () => {
    const [withdrawal] = treasuryWithdrawalsOf({ withdrawals: { [HEX]: '9007199254740993' } });
    expect(withdrawal.lovelace).toBe(9007199254740993n);
  });

  it('leaves out entries it cannot read instead of showing zero', () => {
    const rows = treasuryWithdrawalsOf({ withdrawals: { [HEX]: 'lots', other: -5, [BECH32]: 1 } });
    expect(rows).toEqual([{ rewardAddress: BECH32, lovelace: 1n }]);
  });

  it('is empty for any other payload', () => {
    expect(treasuryWithdrawalsOf(null)).toEqual([]);
    expect(treasuryWithdrawalsOf({ type: 'INFO_ACTION' })).toEqual([]);
    expect(treasuryWithdrawalsOf({ withdrawals: [] })).toEqual([]);
  });
});
