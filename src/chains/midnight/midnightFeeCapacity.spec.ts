import { describe, expect, it } from 'vitest';
import {
  blocksMidnightSendLive,
  hasAnyDustLive,
  mayLackDustLive,
  midnightFeeCapacityLive,
} from './midnightFeeCapacity';
import { dustShortForFee } from './midnightFeeEstimate';

/** 1 DUST in Specks. */
const DUST = 10n ** 15n;

describe('midnightFeeCapacityLive — the guard the send surfaces use', () => {
  it('reports ok for a wallet whose DUST comes entirely from a Cardano cNIGHT registration', () => {
    // The mainnet case that motivated this: Path-A dustState reads 0 (no
    // native NIGHT registered), but the merged live balance is 3,381 DUST.
    // The old guard refused the send with "You need NIGHT".
    const cNight = 3_381_912_800n * 10n ** 9n; // 3,381.9 DUST in Specks
    expect(midnightFeeCapacityLive({ dustBalance: cNight, settled: true })).toBe('ok');
    expect(blocksMidnightSendLive({ dustBalance: cNight, settled: true })).toBe(false);
    expect(mayLackDustLive({ dustBalance: cNight, settled: true })).toBe(false);
  });

  it('reports a settled zero as unverified: it may lack DUST, but nothing blocks', () => {
    // The indexer reports live generation, not spendable DUST. A zero can hide DUST generated
    // earlier that is still decaying (all backing cNIGHT moved away with the registration still
    // active, or a registration removed), so a zero is never proof that nothing is spendable.
    expect(midnightFeeCapacityLive({ dustBalance: 0n, settled: true })).toBe('unverified');
    expect(blocksMidnightSendLive({ dustBalance: 0n, settled: true })).toBe(false);
    expect(mayLackDustLive({ dustBalance: 0n, settled: true })).toBe(true);
  });

  it('reports none, and blocks, only for a zero the caller asserts is verified', () => {
    // The hook for a future balance source that counts existing DUST outputs. Nothing sets it today.
    const verified = { dustBalance: 0n, settled: true, verifiedZero: true };
    expect(midnightFeeCapacityLive(verified)).toBe('none');
    expect(blocksMidnightSendLive(verified)).toBe(true);
    expect(mayLackDustLive(verified)).toBe(true);
    // An explicit false is the same as leaving it out.
    expect(midnightFeeCapacityLive({ dustBalance: 0n, settled: true, verifiedZero: false })).toBe('unverified');
  });

  it('lets a positive balance and an unsettled reading outrank verifiedZero', () => {
    // verifiedZero only speaks for a settled zero.
    expect(midnightFeeCapacityLive({ dustBalance: DUST, settled: true, verifiedZero: true })).toBe('ok');
    expect(midnightFeeCapacityLive({ dustBalance: 1n, settled: true, verifiedZero: true })).toBe('short');
    expect(midnightFeeCapacityLive({ dustBalance: 0n, settled: false, verifiedZero: true })).toBe('unknown');
    expect(blocksMidnightSendLive({ dustBalance: 0n, settled: false, verifiedZero: true })).toBe(false);
  });

  it('never blocks or warns while either path is still in flight', () => {
    // A zero merged balance before Path B has answered is exactly what a
    // Path-B wallet looks like for the length of one poll. Refusing or warning here would
    // re-create the bug for a moment on every open.
    expect(midnightFeeCapacityLive({ dustBalance: 0n, settled: false })).toBe('unknown');
    expect(blocksMidnightSendLive({ dustBalance: 0n, settled: false })).toBe(false);
    expect(mayLackDustLive({ dustBalance: 0n, settled: false })).toBe(false);
    for (const v of [null, undefined]) {
      expect(midnightFeeCapacityLive(v)).toBe('unknown');
      expect(blocksMidnightSendLive(v)).toBe(false);
      expect(mayLackDustLive(v)).toBe(false);
    }
  });

  // A ledger 9 fee is around 0.6 DUST: under the 1 DUST the send review warns at
  // (dustShortForFee), a positive balance may not pay it. Warn and offer a sponsor,
  // never block: the chain decides.
  it('reports a positive balance under a fee\'s worth as short: it may lack DUST, but nothing blocks', () => {
    for (const dustBalance of [1n, 3n * 10n ** 14n, DUST - 1n]) {
      expect(dustShortForFee(dustBalance)).toBe(true);
      expect(midnightFeeCapacityLive({ dustBalance, settled: true })).toBe('short');
      expect(mayLackDustLive({ dustBalance, settled: true })).toBe(true);
      expect(blocksMidnightSendLive({ dustBalance, settled: true })).toBe(false);
      expect(hasAnyDustLive({ dustBalance, settled: true })).toBe(true);
    }
    expect(midnightFeeCapacityLive({ dustBalance: DUST, settled: true })).toBe('ok');
    expect(mayLackDustLive({ dustBalance: DUST, settled: true })).toBe(false);
  });

  it('says a wallet holds no DUST only for a settled zero', () => {
    expect(hasAnyDustLive({ dustBalance: 0n, settled: true })).toBe(false);
    expect(hasAnyDustLive({ dustBalance: 0n, settled: true, verifiedZero: true })).toBe(false);
    expect(hasAnyDustLive({ dustBalance: 0n, settled: false })).toBe(true);
    expect(hasAnyDustLive({ dustBalance: DUST, settled: true })).toBe(true);
  });
});
