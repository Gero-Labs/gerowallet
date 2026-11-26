import { describe, expect, it } from 'vitest';
import {
  FIRST_VAULT_INDEX,
  MAX_PENDING_SETUPS,
  ParticipantIndexHistory,
  ReleasedIndex,
  isIndexTaken,
  nextVaultIndex,
} from './indexAllocation';
import { deriveParticipantKeyHashes, deriveRoleKeys } from './keys';
import { buildVaultFromParticipants, vaultAddresses } from './scripts';
import { decodeRegistration, encodeRegistration, rebuildFromRegistration } from './registration';
import { vaultId } from './vaultId';
import { MAX_VAULT_INDEX } from './types';
import { publishedAccountKey, testCosignerAccount } from './__fixtures__/vectors';

const fresh: ParticipantIndexHistory = { onChain: [], held: [], released: [] };
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const clearScan = { registrationFound: false, addressHistoryFound: false };
const nextIndex = (h: ParticipantIndexHistory) => {
  const r = nextVaultIndex(h);
  if (r.ok !== true) throw new Error(`refused: ${r.code}`);
  return r.index;
};

describe('per-participant vault index', () => {
  it('starts at 1, never 0', () => {
    expect(FIRST_VAULT_INDEX).toBe(1);
    expect(nextVaultIndex(fresh)).toEqual({ ok: true, index: 1, reused: false });
    expect(isIndexTaken(fresh, 0)).toBe(true);
    // A released index 0 cleared by a scan is still never handed out.
    expect(nextIndex({ ...fresh, released: [{ index: 0, scan: clearScan }] })).toBe(1);
  });

  it('skips every taken index: on chain, an accepted vault, a quarantined candidate, a live setup', () => {
    const history: ParticipantIndexHistory = {
      onChain: [1, 4],
      held: [{ index: 2, kind: 'vault' }, { index: 3, kind: 'candidate' }, { index: 5, kind: 'setup' }],
      released: [],
    };
    expect(nextIndex(history)).toBe(6);
    for (const i of [1, 2, 3, 4, 5]) expect(isIndexTaken(history, i)).toBe(true);
    expect(isIndexTaken(history, 6)).toBe(false);
  });

  it('a treasurer with vaults at 1 to 20 and a new colleague make a vault at 21 and 1', async () => {
    const treasurerHistory: ParticipantIndexHistory = {
      onChain: range(1, 20),
      held: range(1, 20).map(index => ({ index, kind: 'vault' as const })),
      released: [],
    };
    const treasurerIndex = nextIndex(treasurerHistory);
    const colleagueIndex = nextIndex(fresh);
    expect([treasurerIndex, colleagueIndex]).toEqual([21, 1]);

    const [treasurer, colleague, third] = await Promise.all(
      [publishedAccountKey(), testCosignerAccount(31), testCosignerAccount(32)].map(async a => deriveRoleKeys(await a)),
    );
    const vault = await buildVaultFromParticipants({
      template: { kind: 'standard', threshold: 2 },
      owners: [
        { roleKeys: treasurer, index: treasurerIndex },
        { roleKeys: colleague, index: colleagueIndex },
        { roleKeys: third, index: nextIndex(fresh) },
      ],
    });
    const reg = decodeRegistration({
      metadata: { cbor: encodeRegistration(vault).offChain.metadata },
      nativeScripts: { cbor: encodeRegistration(vault).offChain.native_scripts },
    });
    if (reg.ok !== true) throw new Error('refused');
    // The treasurer's own scan reaches 21 because 1 to 20 are on chain.
    const rebuilt = await rebuildFromRegistration(reg.registration, [
      { kind: 'own', roleKeys: treasurer, history: treasurerHistory },
      { kind: 'external', roleKeys: colleague },
      { kind: 'external', roleKeys: third },
    ]);
    expect(rebuilt).toMatchObject({ ok: true, indexes: [21, 1, 1] });
    if (rebuilt.ok === true) expect(vaultId(rebuilt.vault, 'preprod')).toBe(vaultId(vault, 'preprod'));
  });

  it('19 abandoned setups, then a 20th setup reuses index 1', () => {
    const released: ReleasedIndex[] = range(1, 19).map(index => ({ index, scan: clearScan }));
    expect(nextVaultIndex({ onChain: [], held: [], released })).toEqual({ ok: true, index: 1, reused: true });
    // Released indexes are reused first, smallest first, even with higher free ones.
    expect(nextIndex({ onChain: [], held: [{ index: 1, kind: 'setup' }], released })).toBe(2);
  });

  it('an 11th live pending setup is refused', () => {
    const ten: ParticipantIndexHistory = { onChain: [], held: range(1, MAX_PENDING_SETUPS).map(index => ({ index, kind: 'setup' as const })), released: [] };
    expect(nextVaultIndex(ten)).toEqual({ ok: false, code: 'TOO_MANY_PENDING' });
    const nine: ParticipantIndexHistory = { ...ten, held: ten.held.slice(1) };
    expect(nextVaultIndex(nine)).toMatchObject({ ok: true });
    // A setup already on chain no longer counts as pending, and neither do vaults or candidates.
    expect(nextVaultIndex({ ...ten, onChain: [1] })).toMatchObject({ ok: true, index: 11 });
    expect(nextVaultIndex({ ...nine, held: [...nine.held, { index: 30, kind: 'vault' }, { index: 31, kind: 'candidate' }] }))
      .toMatchObject({ ok: true });
  });

  it('an index whose setup address received a deposit is never reused', () => {
    const deposit: ParticipantIndexHistory = { onChain: [], held: [], released: [{ index: 1, scan: { registrationFound: false, addressHistoryFound: true } }] };
    expect(nextVaultIndex(deposit)).toEqual({ ok: true, index: 2, reused: false });
    expect(isIndexTaken(deposit, 1)).toBe(true);
    // A later scan reporting clear does not undo it: one scan found history.
    expect(nextIndex({ ...deposit, released: [...deposit.released, { index: 1, scan: clearScan }] })).toBe(2);
  });

  it('a released index stays taken without a fresh clear scan, or when a registration names its key', () => {
    expect(nextIndex({ ...fresh, released: [{ index: 1 }] })).toBe(2);
    expect(nextIndex({ ...fresh, released: [{ index: 1, scan: { registrationFound: true, addressHistoryFound: false } }] })).toBe(2);
    expect(nextIndex({ ...fresh, released: [{ index: 1, scan: { registrationFound: undefined, addressHistoryFound: false } as never }] })).toBe(2);
    expect(nextIndex({ onChain: [1], held: [], released: [{ index: 1, scan: clearScan }] })).toBe(2);
  });

  it('refuses malformed history instead of guessing', () => {
    expect(nextVaultIndex(undefined as never)).toEqual({ ok: false, code: 'INVALID_HISTORY' });
    expect(nextVaultIndex({ ...fresh, onChain: [-1] })).toEqual({ ok: false, code: 'INVALID_HISTORY' });
    expect(nextVaultIndex({ ...fresh, onChain: [1.5] })).toEqual({ ok: false, code: 'INVALID_HISTORY' });
    expect(nextVaultIndex({ ...fresh, onChain: [MAX_VAULT_INDEX + 1] })).toEqual({ ok: false, code: 'INVALID_HISTORY' });
    expect(nextVaultIndex({ ...fresh, held: [{ index: 1, kind: 'other' as never }] })).toEqual({ ok: false, code: 'INVALID_HISTORY' });
    expect(nextVaultIndex({ onChain: [], held: [] } as never)).toEqual({ ok: false, code: 'INVALID_HISTORY' });
    expect(isIndexTaken(undefined as never, 5)).toBe(true);
  });

  it('two vaults with the same people never share a key', async () => {
    const people = await Promise.all([publishedAccountKey(), testCosignerAccount(11), testCosignerAccount(12)].map(async a => deriveRoleKeys(await a)));
    const first = people.map(() => nextIndex(fresh));
    const afterFirst = first.map(index => ({ ...fresh, held: [{ index, kind: 'vault' as const }] }));
    const second = afterFirst.map(nextIndex);
    first.forEach((index, i) => expect(second[i]).not.toBe(index));

    const keysAt = async (indexes: number[]) =>
      (await Promise.all(people.map((p, i) => deriveParticipantKeyHashes(p, indexes[i])))).flatMap(k => [k.payment, k.stake]);
    const a = await keysAt(first);
    const b = await keysAt(second);
    expect(a.filter(k => b.includes(k))).toEqual([]);

    const template = { kind: 'standard', threshold: 2 } as const;
    const v1 = await buildVaultFromParticipants({ template, owners: people.map((roleKeys, i) => ({ roleKeys, index: first[i] })) });
    const v2 = await buildVaultFromParticipants({ template, owners: people.map((roleKeys, i) => ({ roleKeys, index: second[i] })) });
    expect(v2.payment.hash).not.toBe(v1.payment.hash);
    expect(v2.stake.hash).not.toBe(v1.stake.hash);
    expect(vaultAddresses(v2, 'preprod').base).not.toBe(vaultAddresses(v1, 'preprod').base);
  });
});
