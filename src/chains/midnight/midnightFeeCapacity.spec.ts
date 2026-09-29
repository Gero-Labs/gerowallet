import { describe, expect, it } from 'vitest';
import {
  blocksMidnightSend,
  blocksMidnightSendLive,
  mayLackDustLive,
  midnightFeeCapacity,
  midnightFeeCapacityLive,
} from './midnightFeeCapacity';
import type { MidnightDustState } from './midnightTypes';

function dust(current: bigint): MidnightDustState {
  return {
    status: 'generating',
    current,
    cap: 5_000_000_000_000_000n,
    generationRate: 1n,
    timeRemainingSeconds: null,
    registrationStatus: 'registered',
  } as unknown as MidnightDustState;
}

describe('midnightFeeCapacity', () => {
  it('reports none for a zero DUST balance', () => {
    // The case that hung: tokens held, no NIGHT, so no DUST was ever generated.
    expect(midnightFeeCapacity(dust(0n))).toBe('none');
    expect(blocksMidnightSend(dust(0n))).toBe(true);
  });

  it('reports ok for any positive balance', () => {
    expect(midnightFeeCapacity(dust(1n))).toBe('ok');
    expect(blocksMidnightSend(dust(1n))).toBe(false);
  });

  it('reports unknown — and never blocks — before dust state exists', () => {
    // Blocking here would reject every send made before the dust state lands.
    for (const v of [null, undefined]) {
      expect(midnightFeeCapacity(v)).toBe('unknown');
      expect(blocksMidnightSend(v)).toBe(false);
    }
  });

  it('treats a malformed balance as unknown rather than as zero', () => {
    // Persisted state round-trips through JSON, where a bigint can come back
    // as a string. Reading that as "no DUST" would block a funded wallet.
    const malformed = { ...dust(0n), current: '5000' } as unknown as MidnightDustState;
    expect(midnightFeeCapacity(malformed)).toBe('unknown');
    expect(blocksMidnightSend(malformed)).toBe(false);
  });

  it('does not judge whether the balance covers this particular fee', () => {
    // 1 base unit is certainly too little for a real fee, but we have no fee
    // estimate at this point — inventing a floor would reject valid sends.
    expect(midnightFeeCapacity(dust(1n))).toBe('ok');
  });
});

describe('midnightFeeCapacityLive — the guard the send surfaces use', () => {
  it('reports ok for a wallet whose DUST comes entirely from a Cardano cNIGHT registration', () => {
    // The mainnet case that motivated this: Path-A dustState reads 0 (no
    // native NIGHT registered), but the merged live balance is 3,381 DUST.
    // The old guard refused the send with "You need NIGHT".
    expect(midnightFeeCapacityLive({ dustBalance: 3_381_912_800n, settled: true })).toBe('ok');
    expect(blocksMidnightSendLive({ dustBalance: 3_381_912_800n, settled: true })).toBe(false);
    expect(mayLackDustLive({ dustBalance: 3_381_912_800n, settled: true })).toBe(false);
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
    expect(midnightFeeCapacityLive({ dustBalance: 1n, settled: true, verifiedZero: true })).toBe('ok');
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

  it('does not judge whether the balance covers this particular fee', () => {
    expect(midnightFeeCapacityLive({ dustBalance: 1n, settled: true })).toBe('ok');
  });
});
