// The cosigner's side of a two-owner vault joined by invitation: the vault they build reads the
// same 40 digits as the initiator's, a key swapped on the way gives other digits (the ceremony
// catches it), and the overview sorts invitations as the UX rules ask. Test keys only.
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { deriveRoleKeys, deriveVaultPublicKeys, multisigAccountPublicKey, verificationNumber, type MultisigAccountPublicKey } from '@/shared/gerovault';
import { testAccounts } from '@/shared/gerovault/__fixtures__/manifest';
import { clearDbCache } from '@/db/wallet-db';
import { vaultStore } from '@/db/vaultStore';
import { buildCreatedVault, firstManifest, ownVaultKeys, readCosigner, shareText } from '@/modules/gerovault/create/createVault';
import type { ReceivedView } from './inviteClient';
import { buildJoinedVault, joinedVaultProblem, saveJoinedVault } from './joinedVault';
import { useVaultInvitations } from './useVaultInvitations';

let accounts: MultisigAccountPublicKey[];
let raw: { payment: string; stake: string }[];

beforeAll(async () => {
  accounts = (await testAccounts()).map(a => multisigAccountPublicKey(a.toPublic().hex()));
  raw = await Promise.all(accounts.map(async a => {
    const k = await deriveVaultPublicKeys(await deriveRoleKeys(a), 1);
    return { payment: k.payment, stake: k.stake };
  }));
});

const WALLET = 640100;
afterEach(async () => {
  clearDbCache(WALLET);
  await Dexie.delete(`wallet-${WALLET}`);
});

function invite(over: Partial<ReceivedView> = {}): ReceivedView {
  return {
    ref: 'b2'.repeat(16), source: 'mailbox', setupId: 'a1'.repeat(16), network: 'preprod', state: 'accepted', known: true, receivedAt: 1, expiresAt: 9e12,
    revokedByInviter: false, digest: 'cd'.repeat(32), vault: { name: 'Ops petty cash', threshold: 2, owners: 2 },
    inviter: { label: 'Adam', credential: '11'.repeat(28), payment: raw[0].payment, stake: raw[0].stake }, participants: [], wallets: [],
    join: { walletId: WALLET, ownIndex: 1, label: 'Dana', payment: raw[1].payment, stake: raw[1].stake, acceptedAt: 1, verified: false },
    ...over,
  };
}

/** The initiator's vault for the same keys, built by the create flow. */
async function initiatorNumber(cosignerKeys: { payment: string; stake: string }): Promise<readonly string[]> {
  const own = await ownVaultKeys(accounts[0], { index: 1, reused: false });
  const { vaultKeysFromRaw } = await import('./rawKeys');
  const { encodeVaultPublicKeys } = await import('@/shared/gerovault');
  const reading = await readCosigner({ source: 'gero', label: 'Dana', keys: shareText(encodeVaultPublicKeys(vaultKeysFromRaw(cosignerKeys.payment, cosignerKeys.stake))), index: '' });
  if (!reading.ok) throw new Error('fixture');
  const vault = await buildCreatedVault({ network: 'preprod', template: { owners: 2, threshold: 2, acknowledged: true }, own, cosigners: [reading.cosigner] });
  const state = await firstManifest(vault, 1);
  if (!state.ok) throw new Error('fixture');
  return verificationNumber(state.manifest);
}

describe('the joined vault', () => {
  it('reads the same number on both sides, and is kept verified after the ceremony', async () => {
    const joined = await buildJoinedVault(accounts[1], invite(), 1);
    expect(joined.manifestState.ok).toBe(true);
    const cosignerSide = verificationNumber((joined.manifestState as { manifest: Parameters<typeof verificationNumber>[0] }).manifest);
    expect(cosignerSide).toEqual(await initiatorNumber(raw[1]));

    const { record, verifications } = await saveJoinedVault(vaultStore, WALLET, joined, 'Ops petty cash', 2);
    expect(record).toMatchObject({ status: 'accepted', ownIndex: 1 });
    expect(verifications.map(v => v.method)).toEqual(['number']);
  });

  it('gives other digits when a key was swapped on the way (the ceremony catches it)', async () => {
    // The relay handed the cosigner an invitation signed by Yuval's key instead of Adam's.
    const swapped = await buildJoinedVault(accounts[1], invite({ inviter: { label: 'Adam', credential: '11'.repeat(28), payment: raw[2].payment, stake: raw[2].stake } }), 1);
    const cosignerSide = verificationNumber((swapped.manifestState as { manifest: Parameters<typeof verificationNumber>[0] }).manifest);
    expect(cosignerSide).not.toEqual(await initiatorNumber(raw[1]));
  });

  it('refuses another wallet\'s account key and waits for more owners', async () => {
    await expect(buildJoinedVault(accounts[2], invite(), 1)).rejects.toMatchObject({ code: 'KEY_MISMATCH' });
    expect(joinedVaultProblem(invite({ vault: { name: 'Treasury', threshold: 2, owners: 3 } }))).toBe('MORE_OWNERS');
    expect(joinedVaultProblem(invite({ join: undefined }))).toBe('NOT_JOINED');
  });
});

describe('useVaultInvitations', () => {
  it('sorts invitations: from people you know, from strangers, joined and waiting for the number', async () => {
    const list = [
      invite({ ref: '01'.repeat(16), state: 'open', known: true, join: undefined }),
      invite({ ref: '02'.repeat(16), state: 'open', known: false, join: undefined }),
      invite({ ref: '03'.repeat(16) }),
      invite({ ref: '04'.repeat(16), state: 'declined', join: undefined }),
    ];
    const client = {
      listSetups: vi.fn(async () => []),
      refreshSetup: vi.fn(),
      listInvites: vi.fn(async () => ({ invites: list, refused: 1 })),
      remind: vi.fn(), cancelSetup: vi.fn(), decline: vi.fn(), block: vi.fn(), openLink: vi.fn(), getInvite: vi.fn(),
    };
    const inv = useVaultInvitations({ client, walletId: () => 1 });
    await inv.reload();
    expect(inv.state.value).toBe('ready');
    expect(inv.forYou.value.map(i => i.ref)).toEqual(['01'.repeat(16)]);
    expect(inv.requests.value.map(i => i.ref)).toEqual(['02'.repeat(16)]);
    expect(inv.toVerify.value.map(i => i.ref)).toEqual(['03'.repeat(16)]);
    expect(inv.refused.value).toBe(1);
  });

  it('hides itself when the background has no invitation handler', async () => {
    const { InviteClientError } = await import('./inviteClient');
    const client = {
      listSetups: vi.fn(async () => { throw new InviteClientError('UNAVAILABLE'); }),
      refreshSetup: vi.fn(), listInvites: vi.fn(), remind: vi.fn(), cancelSetup: vi.fn(), decline: vi.fn(), block: vi.fn(), openLink: vi.fn(), getInvite: vi.fn(),
    };
    const inv = useVaultInvitations({ client, walletId: () => 1 });
    await inv.reload();
    expect(inv.state.value).toBe('unavailable');
  });
});
