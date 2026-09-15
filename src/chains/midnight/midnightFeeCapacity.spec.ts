import { describe, expect, it } from 'vitest';
import { blocksMidnightSend, midnightFeeCapacity } from './midnightFeeCapacity';
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
