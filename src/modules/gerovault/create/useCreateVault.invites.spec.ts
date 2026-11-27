// The create flow by invitation, against a fake invitation client: the setup starts at unlock
// with this wallet's index from the background, a cosigner's keys fill in once their ACCEPT is in
// the setup (never before), a closed vault key asks for the credential again, and the save closes
// the setup. Test keys only.
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { effectScope, type EffectScope } from 'vue';
import { deriveRoleKeys, deriveVaultPublicKeys, multisigAccountPublicKey, type MultisigAccountPublicKey } from '@/shared/gerovault';
import { testAccounts } from '@/shared/gerovault/__fixtures__/manifest';
import { clearDbCache } from '@/db/wallet-db';
import { vaultStore } from '@/db/vaultStore';
import { InviteClientError, type SetupViewModel, type SlotView } from '@/modules/gerovault/invites/inviteClient';
import { useCreateVault, type CreateInviteDeps } from './useCreateVault';

const SETUP = 'a1'.repeat(16);
let accounts: MultisigAccountPublicKey[];
let accountHex: string[];
let keys: { payment: string; stake: string }[];

beforeAll(async () => {
  accountHex = (await testAccounts()).map(a => a.toPublic().hex());
  accounts = accountHex.map(hex => multisigAccountPublicKey(hex));
  keys = await Promise.all(accounts.map(async a => {
    const k = await deriveVaultPublicKeys(await deriveRoleKeys(a), 1);
    return { payment: k.payment, stake: k.stake };
  }));
});

const scopes: EffectScope[] = [];
const wallets: number[] = [];
let nextWallet = 539100;
afterEach(async () => {
  for (const s of scopes.splice(0)) s.stop();
  for (const id of wallets.splice(0)) {
    clearDbCache(id);
    await Dexie.delete(`wallet-${id}`);
  }
});

function setupView(over: Partial<SetupViewModel> = {}, slots: SlotView[] = [{ n: 0, status: 'empty', verified: false }]): SetupViewModel {
  return {
    setupId: SETUP, walletId: 0, network: 'preprod', name: 'Ops petty cash', owners: 2, threshold: 2, ownIndex: 1, ownLabel: 'Adam',
    ownPayment: keys[0].payment, ownStake: keys[0].stake, createdAt: 0, expiresAt: 9e12, state: 'open', signerReady: true,
    slots, links: [], refused: 0, ...over,
  };
}

const accepted = (over: Partial<SlotView> = {}): SlotView => ({
  n: 0, status: 'accepted', verified: false, label: 'Dana',
  accept: { label: 'Dana', stakeCredential: '11'.repeat(28), payment: keys[1].payment, stake: keys[1].stake, via: 'invite', acceptedAt: 1 },
  ...over,
});

function start(client: Partial<CreateInviteDeps['client']>, extra: Partial<CreateInviteDeps> = {}) {
  const walletId = nextWallet++;
  wallets.push(walletId);
  const full = {
    status: vi.fn(async () => ({ inviteKey: 'ab'.repeat(32) })),
    holds: vi.fn(async () => ({ held: [], released: [] })),
    startSetup: vi.fn(async () => ({ setup: setupView({ walletId }), accountKey: accountHex[0] })),
    unlockSetup: vi.fn(async () => ({ setup: setupView({ walletId }), accountKey: accountHex[0] })),
    updateTerms: vi.fn(),
    getSetup: vi.fn(),
    refreshSetup: vi.fn(async () => setupView({ walletId })),
    invite: vi.fn(),
    link: vi.fn(),
    withdrawLink: vi.fn(),
    remind: vi.fn(),
    revoke: vi.fn(),
    markVerified: vi.fn(async () => setupView({ walletId }, [accepted({ verified: true })])),
    completeSetup: vi.fn(async () => setupView({ walletId, state: 'completed' })),
    cancelSetup: vi.fn(),
    ...client,
  } as unknown as CreateInviteDeps['client'];
  const auth = vi.fn(async (password: string) => ({ password }));
  const scope = effectScope();
  scopes.push(scope);
  const flow = scope.run(() => useCreateVault({
    store: vaultStore,
    walletId,
    network: 'preprod',
    unlockAccountKey: vi.fn(async () => { throw new Error('the paste path is not used'); }),
    now: () => 1_790_000_000_000,
    invites: { client: full, auth, untitledName: 'Shared vault', pollMs: 3_600_000, ...extra },
  }))!;
  return { flow, client: full as unknown as { [K in keyof CreateInviteDeps['client']]: ReturnType<typeof vi.fn> }, auth, walletId };
}

describe('create by invitation', () => {
  it('starts the setup at unlock with the template, and derives the keys the worker signs with', async () => {
    const { flow, client, auth } = start({});
    await vi.waitFor(() => expect(flow.inviteMode.value).toBe('on'));
    flow.template.name = '';
    flow.setOwners(2);
    flow.setThreshold(2);
    flow.template.acknowledged = true;
    flow.goToCosigners();
    await flow.unlock('secret');
    expect(auth).toHaveBeenCalledWith('secret');
    expect(client.startSetup).toHaveBeenCalledWith(expect.objectContaining({ name: 'Shared vault', owners: 2, threshold: 2 }), { password: 'secret' });
    expect(flow.own.value?.index).toBe(1);
    expect(flow.own.value?.vaultKeys.payment).toBe(keys[0].payment);
    // Nobody joined yet: the slot waits, and Continue stays off.
    await vi.waitFor(() => expect(flow.readings.value[0]).toEqual({ ok: false, problem: 'INVITE_PENDING' }));
    expect(flow.cosignersReady.value).toBe(false);
  });

  it('fills a cosigner from their checked ACCEPT, verifies, saves and closes the setup', async () => {
    const { flow, client } = start({});
    await vi.waitFor(() => expect(flow.inviteMode.value).toBe('on'));
    flow.setOwners(2);
    flow.setThreshold(2);
    flow.template.acknowledged = true;
    flow.goToCosigners();
    await flow.unlock('secret');
    flow.setup.value = setupView({ walletId: flow.setup.value!.walletId }, [accepted()]);
    await vi.waitFor(() => expect(flow.cosignersReady.value).toBe(true));
    await flow.goToVerify();
    expect(flow.step.value).toBe('verify');
    const dana = flow.vault.value!.cosigners[0];
    await flow.confirmNumber(dana.hashes.payment);
    expect(client.markVerified).toHaveBeenCalledWith(SETUP, 0);
    const saved = await flow.save();
    expect(saved?.status).toBe('accepted');
    expect(client.completeSetup).toHaveBeenCalledWith(SETUP, saved!.vaultId);
  });

  it('refuses keys the page derives differently from the worker', async () => {
    const { flow } = start({ startSetup: vi.fn(async () => ({ setup: setupView({ ownPayment: keys[2].payment }), accountKey: accountHex[0] })) });
    await vi.waitFor(() => expect(flow.inviteMode.value).toBe('on'));
    flow.goToCosigners();
    await flow.unlock('secret');
    expect(flow.own.value).toBeNull();
    expect(flow.unlockProblem.value).toBe('not-supported');
  });

  it('maps the background refusals to the unlock problems, with the pending setups', async () => {
    const open = [{ setupId: SETUP, name: 'Old one' }];
    const { flow } = start({ startSetup: vi.fn(async () => { throw new InviteClientError('TOO_MANY_PENDING', { open }); }) });
    await vi.waitFor(() => expect(flow.inviteMode.value).toBe('on'));
    flow.goToCosigners();
    await flow.unlock('secret');
    expect(flow.unlockProblem.value).toBe('TOO_MANY_PENDING');
    expect(flow.inviteProblem.value?.details).toEqual({ open });
  });

  it('asks for the credential again once the vault key closed in the worker', async () => {
    const { flow, client } = start({ invite: vi.fn(async () => { throw new InviteClientError('LOCKED'); }) });
    await vi.waitFor(() => expect(flow.inviteMode.value).toBe('on'));
    flow.goToCosigners();
    await flow.unlock('secret');
    expect(await flow.inviteCosigner(0, { stakeCredential: '22'.repeat(28) })).toBe(false);
    expect(flow.setup.value?.signerReady).toBe(false);
    expect(flow.inviteProblem.value).toMatchObject({ code: 'LOCKED', n: 0 });
    await flow.unlock('secret');
    expect(client.unlockSetup).toHaveBeenCalledWith(SETUP, { password: 'secret' });
    expect(flow.setup.value?.signerReady).toBe(true);
  });

  it('reopens a setup from the overview with its terms', async () => {
    const { flow } = start({ getSetup: vi.fn(async () => setupView({ walletId: wallets[wallets.length - 1], owners: 3, threshold: 2, slots: [accepted(), { n: 1, status: 'waiting', verified: false }] })) }, { resumeSetupId: SETUP });
    await vi.waitFor(() => expect(flow.step.value).toBe('cosigners'));
    expect(flow.template.owners).toBe(3);
    expect(flow.drafts.value).toHaveLength(2);
    expect(flow.setup.value?.setupId).toBe(SETUP);
  });

  it('falls back to the paste flow when the background does not answer', async () => {
    const { flow } = start({ status: vi.fn(async () => { throw new InviteClientError('UNAVAILABLE'); }) });
    await vi.waitFor(() => expect(flow.inviteMode.value).toBe('off'));
  });
});
