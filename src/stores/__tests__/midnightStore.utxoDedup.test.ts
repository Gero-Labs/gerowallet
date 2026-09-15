/**
 * `applyUtxoDeltas` dedup-key integrity.
 *
 * The UTxO set is keyed by `${intentHash}:${outputIndex}`. Both halves come
 * from an unvalidated gero-sync WS payload, so a malformed output can produce
 * a key COLLISION between two genuinely different UTxOs. When that happens the
 * store must never let `balances.nightUnshielded` drift away from the NIGHT
 * sum of the surviving set — that field has been zeroed by production
 * regressions twice (see the comments in midnight-sync.service.ts and
 * midnightStore.ts) and is the balance the dashboard renders.
 *
 * Sibling coverage, deliberately kept separate: the
 * `NIGHT balance isolation (store integration)` block in
 * `src/chains/midnight/midnightTokenBalances.spec.ts` drives the same action
 * with DISTINCT keys and asserts colors are isolated. This file is the
 * complement — same-key inputs, asserting the balance still tracks the set.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { midnightStore, midnightActions } from '../midnightStore';
import { NIGHT_TOKEN_TYPE_NULL } from '@/services/midnight-sync.service';
import { isNativeNight } from '@/chains/midnight/midnightTokenBalances';
import type { MidnightUnshieldedUtxo } from '@/chains/midnight/midnightTypes';

const OWNER = 'mn_shield-addr_test1wallet';
const TOKEN_COLOR = 'a'.repeat(64);
const INTENT = 'b'.repeat(64);

function utxo(over: Partial<MidnightUnshieldedUtxo> = {}): MidnightUnshieldedUtxo {
  return {
    owner: OWNER,
    tokenType: NIGHT_TOKEN_TYPE_NULL,
    value: 0n,
    intentHash: INTENT,
    outputIndex: 0,
    ctime: undefined,
    initialNonce: '',
    registeredForDustGeneration: false,
    ...over,
  };
}

/**
 * The store's own stated invariant: balance is derived from the UTxO set.
 * Uses the shared `isNativeNight` predicate rather than re-implementing it, so
 * this cannot silently disagree with the guard inside `applyUtxoDeltas`.
 */
function nightSumOfSet(): bigint {
  return midnightStore.utxos.reduce(
    (sum, u) => (isNativeNight(u.tokenType) ? sum + u.value : sum),
    0n,
  );
}

beforeEach(() => {
  midnightStore.utxos = [];
  midnightStore.balances = {
    nightShielded: 0n,
    nightUnshielded: 0n,
    nightRegistered: 0n,
    dust: 0n,
    dustGenerating: 0n,
  };
  midnightStore.lastMidnightTxId = null;
});

describe('applyUtxoDeltas — colliding dedup keys', () => {
  it('keeps nightUnshielded consistent when a NIGHT and a token UTxO share a key', () => {
    // Same tx creates a NIGHT change output and a token output for us, and the
    // payload gave both the same (intentHash, outputIndex).
    midnightActions.applyUtxoDeltas({
      added: [
        utxo({ tokenType: NIGHT_TOKEN_TYPE_NULL, value: 10n }),
        utxo({ tokenType: TOKEN_COLOR, value: 5n }),
      ],
      removed: [],
    });

    // Only one entry can survive a shared key — whichever it is, the balance
    // must agree with it. The bug: the token overwrote the NIGHT entry without
    // adjusting balanceDelta, leaving 10n credited for a set holding no NIGHT.
    expect(midnightStore.utxos).toHaveLength(1);
    expect(midnightStore.balances.nightUnshielded).toBe(nightSumOfSet());
  });

  it('keeps nightUnshielded consistent in the reverse arrival order', () => {
    midnightActions.applyUtxoDeltas({
      added: [
        utxo({ tokenType: TOKEN_COLOR, value: 5n }),
        utxo({ tokenType: NIGHT_TOKEN_TYPE_NULL, value: 10n }),
      ],
      removed: [],
    });

    expect(midnightStore.utxos).toHaveLength(1);
    expect(midnightStore.balances.nightUnshielded).toBe(nightSumOfSet());
  });

  it('does not leave a stale NIGHT balance behind when the survivor is spent', () => {
    midnightActions.applyUtxoDeltas({
      added: [
        utxo({ tokenType: NIGHT_TOKEN_TYPE_NULL, value: 10n }),
        utxo({ tokenType: TOKEN_COLOR, value: 5n }),
      ],
      removed: [],
    });
    // Spending the survivor empties the set, so the balance must reach zero.
    midnightActions.applyUtxoDeltas({
      added: [],
      removed: [{ intentHash: INTENT, outputIndex: 0 }],
    });

    expect(midnightStore.utxos).toHaveLength(0);
    expect(midnightStore.balances.nightUnshielded).toBe(0n);
  });
});

describe('applyUtxoDeltas — behaviour that must not regress', () => {
  it('does not double-count a duplicate replay of the same UTxO', () => {
    const u = utxo({ value: 10n });
    midnightActions.applyUtxoDeltas({ added: [u], removed: [] });
    midnightActions.applyUtxoDeltas({ added: [u], removed: [] });

    expect(midnightStore.utxos).toHaveLength(1);
    expect(midnightStore.balances.nightUnshielded).toBe(10n);
  });

  it('preserves the balance across an in-place DUST registration', () => {
    // Registration spends and re-creates the SAME key, only flagged. Removals
    // run before additions so the flagged version is re-admitted.
    midnightActions.applyUtxoDeltas({ added: [utxo({ value: 10n })], removed: [] });
    midnightActions.applyUtxoDeltas({
      added: [utxo({ value: 10n, registeredForDustGeneration: true })],
      removed: [{ intentHash: INTENT, outputIndex: 0 }],
    });

    expect(midnightStore.utxos).toHaveLength(1);
    expect(midnightStore.utxos[0].registeredForDustGeneration).toBe(true);
    expect(midnightStore.balances.nightUnshielded).toBe(10n);
  });

  it('refreshes metadata on a duplicate without touching the balance', () => {
    midnightActions.applyUtxoDeltas({ added: [utxo({ value: 10n })], removed: [] });
    midnightActions.applyUtxoDeltas({
      added: [utxo({ value: 10n, registeredForDustGeneration: true })],
      removed: [],
    });

    expect(midnightStore.utxos[0].registeredForDustGeneration).toBe(true);
    expect(midnightStore.balances.nightUnshielded).toBe(10n);
  });
});
