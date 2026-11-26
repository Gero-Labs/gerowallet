import { describe, expect, it } from 'vitest';
import {
  CosignerIndexHistory,
  DISCOVERY_GAP_LIMIT,
  FIRST_VAULT_INDEX,
  allocateVaultIndex,
  discoveryGapRefusal,
  nextVaultIndex,
} from './indexAllocation';
import { deriveParticipantKeyHashes, deriveSharedRoleKeys } from './keys';
import { buildVaultFromRoleKeys, vaultAddresses } from './scripts';
import { MAX_VAULT_INDEX } from './types';
import { publishedAccountKey, testCosignerAccount } from './__fixtures__/vectors';

const fresh: CosignerIndexHistory = { used: [], burned: [] };
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe('vault index allocation', () => {
  it('starts at 1, never 0', () => {
    expect(FIRST_VAULT_INDEX).toBe(1);
    expect(nextVaultIndex([fresh, fresh])).toBe(1);
    expect(allocateVaultIndex([fresh])).toEqual({ ok: true, index: 1 });
    // Index 0 being in use (the existing dApp witness key) changes nothing.
    expect(nextVaultIndex([{ used: [0], burned: [] }, fresh])).toBe(1);
  });

  it('takes the smallest index unused by every participant', () => {
    expect(nextVaultIndex([{ used: [1, 2], burned: [] }, { used: [1], burned: [] }])).toBe(3);
    // One participant's index from a vault with other people is taken for every set they join.
    expect(nextVaultIndex([{ used: [1], burned: [] }, fresh])).toBe(2);
    // An index nobody here has used, below others they have, is the next one.
    expect(nextVaultIndex([{ used: [1, 3], burned: [] }, { used: [3], burned: [] }])).toBe(2);
  });

  it('never returns a burned index', () => {
    expect(nextVaultIndex([{ used: [], burned: [1] }, fresh])).toBe(2);
    expect(nextVaultIndex([{ used: [1], burned: [2, 3] }, { used: [], burned: [4] }])).toBe(5);
    const all = Array.from({ length: 50 }, (_, i) => i + 1);
    for (let burned = 1; burned <= 50; burned++) {
      const next = nextVaultIndex([{ used: all.filter(i => i !== burned), burned: [burned] }]);
      expect(next).toBe(51);
    }
  });

  it('refuses to leave 20 or more consecutive unused indices below y for any participant', () => {
    // Participant 1 has used 1..25; participant 0 has nothing on chain, so y = 26 leaves 0..25 unused for them.
    const busy: CosignerIndexHistory = { used: range(1, 25), burned: [] };
    expect(allocateVaultIndex([fresh, busy])).toEqual({
      ok: false, code: 'DISCOVERY_GAP_EXCEEDED', participant: 0, gapStart: 0, gapLength: 26,
    });
    // 19 unused below y is still within the limit; 20 is not.
    expect(discoveryGapRefusal([fresh], DISCOVERY_GAP_LIMIT - 1)).toBeUndefined();
    expect(discoveryGapRefusal([fresh], DISCOVERY_GAP_LIMIT)).toMatchObject({ participant: 0, gapStart: 0, gapLength: DISCOVERY_GAP_LIMIT });
    // A run in the middle counts too, and burned indices are part of a gap: a scan cannot see them.
    const holed: CosignerIndexHistory = { used: [0, 1, ...range(22, 30)], burned: range(2, 21) };
    expect(discoveryGapRefusal([holed], 31)).toMatchObject({ gapStart: 2, gapLength: 20 });
    expect(discoveryGapRefusal([{ used: [0, 1, 11, ...range(22, 30)], burned: [] }], 31)).toBeUndefined();
  });

  it('refuses malformed input instead of guessing', () => {
    expect(allocateVaultIndex([])).toEqual({ ok: false, code: 'NO_PARTICIPANTS' });
    expect(allocateVaultIndex([fresh, { used: [-1], burned: [] }])).toEqual({ ok: false, code: 'INVALID_HISTORY', participant: 1 });
    expect(allocateVaultIndex([{ used: [1.5], burned: [] }])).toMatchObject({ code: 'INVALID_HISTORY' });
    expect(allocateVaultIndex([{ used: [MAX_VAULT_INDEX + 1], burned: [] }])).toMatchObject({ code: 'INVALID_HISTORY' });
    expect(allocateVaultIndex([{ used: [0], burned: undefined as never }])).toMatchObject({ code: 'INVALID_HISTORY' });
    expect(nextVaultIndex(undefined as never)).toBeUndefined();
  });

  it('two vaults with the same people never share a key', async () => {
    const people = await Promise.all([publishedAccountKey(), testCosignerAccount(11), testCosignerAccount(12)].map(async a => deriveSharedRoleKeys(await a)));
    const first = allocateVaultIndex(people.map(() => fresh));
    if (first.ok !== true) throw new Error('no index');
    const second = allocateVaultIndex(people.map(() => ({ used: [first.index], burned: [] })));
    if (second.ok !== true) throw new Error('no index');
    expect(second.index).not.toBe(first.index);

    const keysAt = async (index: number) =>
      (await Promise.all(people.map(p => deriveParticipantKeyHashes(p, index)))).flatMap(k => [k.payment, k.stake]);
    const a = await keysAt(first.index);
    const b = await keysAt(second.index);
    expect(a.filter(k => b.includes(k))).toEqual([]);

    const template = { kind: 'standard', threshold: 2 } as const;
    const v1 = await buildVaultFromRoleKeys({ template, owners: people, index: first.index });
    const v2 = await buildVaultFromRoleKeys({ template, owners: people, index: second.index });
    expect(v2.payment.hash).not.toBe(v1.payment.hash);
    expect(v2.stake.hash).not.toBe(v1.stake.hash);
    expect(vaultAddresses(v2, 'preprod').base).not.toBe(vaultAddresses(v1, 'preprod').base);
  });
});
