// The create flow's state, driven end to end against the real vault store (fake IndexedDB) with
// test keys: template, unlock, cosigners, verify, save, and what each step refuses.
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { effectScope, type EffectScope } from 'vue';
import { multisigAccountPublicKey, type MultisigAccountPublicKey } from '@/shared/gerovault';
import { testAccounts } from '@/shared/gerovault/__fixtures__/manifest';
import { clearDbCache } from '@/db/wallet-db';
import { vaultStore } from '@/db/vaultStore';
import { buildCreatedVault, firstManifest, ownVaultKeys, readCosigner, shareText, verificationView } from './createVault';
import { OwnAccountKeyError } from './ownAccountKeyFlow';
import { useCreateVault, type CreateVaultDeps } from './useCreateVault';

let accounts: MultisigAccountPublicKey[];
let texts: string[];

beforeAll(async () => {
  accounts = (await testAccounts()).map(a => multisigAccountPublicKey(a.toPublic().hex()));
  texts = await Promise.all(accounts.map(async (a, i) => shareText((await ownVaultKeys(a, { index: i + 1, reused: false })).encoded)));
});

let nextWallet = 429500;
const wallets: number[] = [];
const scopes: EffectScope[] = [];

afterEach(async () => {
  for (const scope of scopes.splice(0)) scope.stop();
  for (const id of wallets.splice(0)) {
    clearDbCache(id);
    await Dexie.delete(`wallet-${id}`);
  }
});

function start(overrides: Partial<CreateVaultDeps> = {}) {
  const walletId = nextWallet++;
  wallets.push(walletId);
  const unlockAccountKey = vi.fn(async (password: string) => {
    if (password !== 'right') throw new OwnAccountKeyError('wrong-password');
    return accounts[0];
  });
  const scope = effectScope();
  scopes.push(scope);
  const flow = scope.run(() => useCreateVault({
    store: vaultStore,
    walletId,
    network: 'preprod',
    unlockAccountKey,
    now: () => 1_790_000_000_000,
    ...overrides,
  }))!;
  return { flow, walletId, unlockAccountKey };
}

/** Template 2 of 3, this wallet unlocked, and cosigners 1 and 2 entered as Gero wallets. */
async function readyToVerify() {
  const started = start();
  const { flow } = started;
  flow.template.name = 'Ops petty cash';
  flow.goToCosigners();
  await flow.unlock('right');
  const [first, second] = flow.drafts.value;
  flow.updateDraft(first.id, { label: 'Dana', keys: texts[1] });
  flow.updateDraft(second.id, { label: 'Yuval', keys: texts[2] });
  await vi.waitFor(() => expect(flow.cosignersReady.value).toBe(true));
  return started;
}

describe('template step', () => {
  it('keeps one cosigner row per owner other than this wallet', () => {
    const { flow } = start();
    expect(flow.step.value).toBe('template');
    expect(flow.drafts.value).toHaveLength(2);
    flow.setOwners(5);
    expect(flow.drafts.value).toHaveLength(4);
    flow.setThreshold(9);
    expect(flow.template.threshold).toBe(5);
    flow.setOwners(2);
    expect(flow.drafts.value).toHaveLength(1);
    expect(flow.template.threshold).toBe(2);
  });

  it('moves on only with the bounds kept and the all-owners warning acknowledged', () => {
    const { flow } = start();
    flow.setThreshold(3);
    expect(flow.templateIssue.value).toBe('NOT_ACKNOWLEDGED');
    flow.goToCosigners();
    expect(flow.step.value).toBe('template');
    flow.template.acknowledged = true;
    flow.goToCosigners();
    expect(flow.step.value).toBe('cosigners');
  });
});

describe('unlocking this wallet\'s keys', () => {
  it('derives the keys at the next free index and keeps nothing but public keys', async () => {
    const { flow } = start();
    await flow.unlock('right');
    expect(flow.own.value?.index).toBe(1);
    expect(flow.unlockProblem.value).toBeNull();
    expect(shareText(flow.own.value!.encoded)).toBe(texts[0]);
  });

  it('says why it could not, and can be tried again', async () => {
    const { flow, unlockAccountKey } = start();
    await flow.unlock('wrong');
    expect(flow.unlockProblem.value).toBe('wrong-password');
    expect(flow.own.value).toBeNull();
    await flow.unlock('right');
    expect(flow.own.value).not.toBeNull();
    expect(unlockAccountKey).toHaveBeenCalledTimes(2);
  });

  it('refuses before asking for the credential when the store cannot be read', async () => {
    const { flow, unlockAccountKey } = start({
      store: { ...vaultStore, list: async () => { throw new Error('broken'); } },
    });
    await flow.unlock('right');
    expect(flow.unlockProblem.value).toBe('STORE_UNAVAILABLE');
    expect(unlockAccountKey).not.toHaveBeenCalled();
  });
});

describe('cosigners step', () => {
  it('reads each row and refuses this wallet\'s own keys', async () => {
    const { flow } = start();
    flow.goToCosigners();
    await flow.unlock('right');
    const [first, second] = flow.drafts.value;
    flow.updateDraft(first.id, { label: 'Me again', keys: texts[0] });
    flow.updateDraft(second.id, { label: 'Yuval', keys: texts[2] });
    await vi.waitFor(() => expect(flow.readings.value.map(r => (r.ok === false ? r.problem : 'ok'))).toEqual(['SAME_AS_YOURS', 'ok']));
    expect(flow.cosignersReady.value).toBe(false);
    await flow.goToVerify();
    expect(flow.step.value).toBe('cosigners');
  });
});

describe('the vault address on chain', () => {
  async function verifyWith(reader: CreateVaultDeps['reader']) {
    const started = start({ reader });
    const { flow } = started;
    flow.goToCosigners();
    await flow.unlock('right');
    const [first, second] = flow.drafts.value;
    flow.updateDraft(first.id, { label: 'Dana', keys: texts[1] });
    flow.updateDraft(second.id, { label: 'Yuval', keys: texts[2] });
    await vi.waitFor(() => expect(flow.cosignersReady.value).toBe(true));
    await flow.goToVerify();
    return flow;
  }

  it('reads the built vault\'s base address once, as a display', async () => {
    const history = vi.fn(async () => []);
    const flow = await verifyWith({ history });
    await vi.waitFor(() => expect(flow.addressActivity.value).toBe('none'));
    expect(history).toHaveBeenCalledWith(String(flow.vault.value!.addresses.base), { pageSize: 1 });
  });

  it('says when the address was used before, or could not be read, and saves either way', async () => {
    const used = await verifyWith({ history: async () => [{ txHash: 'ab'.repeat(32), blockHeight: 1, blockTime: 1 }] });
    await vi.waitFor(() => expect(used.addressActivity.value).toBe('used'));
    expect(await used.save()).not.toBeNull();
    const broken = await verifyWith({ history: async () => { throw new Error('offline'); } });
    await vi.waitFor(() => expect(broken.addressActivity.value).toBe('unreadable'));
  });

  it('does not read without a reader, and forgets the answer when going back', async () => {
    const none = await verifyWith(undefined);
    expect(none.addressActivity.value).toBe('unknown');
    const flow = await verifyWith({ history: async () => [] });
    await vi.waitFor(() => expect(flow.addressActivity.value).toBe('none'));
    flow.back();
    expect(flow.addressActivity.value).toBe('unknown');
  });
});

describe('verify and save', () => {
  it('builds the vault every cosigner builds, verifies, saves, and keeps later records', async () => {
    const { flow, walletId } = await readyToVerify();
    await flow.goToVerify();
    expect(flow.step.value).toBe('verify');
    const vault = flow.vault.value!;
    expect(flow.view.value?.groups).toHaveLength(8);
    expect(flow.verification.value).toMatchObject({ verified: 0, fundingOpen: false });

    // Cosigner 2's own device, built from the same keys, shows the QR this device scans.
    const theirCosigners = await Promise.all([texts[1], texts[0]].map(async (keys, i) => {
      const reading = await readCosigner({ source: 'gero', label: `Owner ${i}`, keys, index: '' });
      if (reading.ok === false) throw new Error(reading.problem);
      return reading.cosigner;
    }));
    const theirVault = await buildCreatedVault({
      network: 'preprod',
      template: { owners: 3, threshold: 2, acknowledged: false },
      own: await ownVaultKeys(accounts[2], { index: 3, reused: false }),
      cosigners: theirCosigners,
    });
    expect(theirVault.vaultId).toBe(vault.vaultId);
    const theirState = await firstManifest(theirVault, 1_790_000_500);
    if (theirState.ok === false) throw new Error(theirState.reason);
    const yuval = vault.cosigners.find(c => c.label === 'Yuval')!.hashes.payment;
    const dana = vault.cosigners.find(c => c.label === 'Dana')!.hashes.payment;
    expect(await flow.applyQr(yuval, 'not a code')).toBe('MALFORMED_QR');
    expect(await flow.applyQr(yuval, verificationView(theirState.manifest).qrPayload)).toBeUndefined();
    expect(flow.verification.value?.verified).toBe(1);

    const saved = await flow.save();
    expect(saved).toMatchObject({ status: 'accepted', name: 'Ops petty cash', ownIndex: 1 });
    expect(saved?.verifications.map(r => r.method)).toEqual(['qr']);

    await flow.confirmNumber(dana);
    expect(flow.verification.value?.verified).toBe(2);
    expect((await vaultStore.get(walletId, vault.vaultId))?.verifications.map(r => r.method).sort()).toEqual(['number', 'qr']);

    // Saved: the flow does not go back or save again.
    flow.back();
    expect(flow.step.value).toBe('verify');
    expect(await flow.save()).toBe(flow.saved.value);
  });

  it('drops the built vault and its records when going back', async () => {
    const { flow } = await readyToVerify();
    await flow.goToVerify();
    await flow.confirmNumber(flow.vault.value!.cosigners[0].hashes.payment);
    flow.back();
    expect(flow.step.value).toBe('cosigners');
    expect(flow.vault.value).toBeNull();
    expect(flow.records.value).toEqual([]);
  });

  it('keeps a record made after the save on screen when the store cannot write it, and says so', async () => {
    const failing = { ...vaultStore, update: async () => { throw Object.assign(new Error('x'), { code: 'STORE_UNAVAILABLE' }); } };
    const { flow } = start({ store: failing });
    flow.goToCosigners();
    await flow.unlock('right');
    const [a, b] = flow.drafts.value;
    flow.updateDraft(a.id, { label: 'Dana', keys: texts[1] });
    flow.updateDraft(b.id, { label: 'Yuval', keys: texts[2] });
    await vi.waitFor(() => expect(flow.cosignersReady.value).toBe(true));
    await flow.goToVerify();
    expect(await flow.save()).not.toBeNull();
    await flow.confirmNumber(flow.vault.value!.cosigners[0].hashes.payment);
    expect(flow.verification.value?.verified).toBe(1);
    expect(flow.saveProblem.value).toBe('STORE_UNAVAILABLE');
  });

  it('says why a save failed', async () => {
    const { flow } = await readyToVerify();
    await flow.goToVerify();
    const failing = { ...vaultStore, addCandidate: async () => { throw Object.assign(new Error('x'), { code: 'STORE_UNAVAILABLE' }); } };
    const again = start({ store: failing });
    again.flow.template.name = flow.template.name;
    // Same flow, failing store: drive it to the verify step.
    again.flow.goToCosigners();
    await again.flow.unlock('right');
    const [a, b] = again.flow.drafts.value;
    again.flow.updateDraft(a.id, { label: 'Dana', keys: texts[1] });
    again.flow.updateDraft(b.id, { label: 'Yuval', keys: texts[2] });
    await vi.waitFor(() => expect(again.flow.cosignersReady.value).toBe(true));
    await again.flow.goToVerify();
    expect(await again.flow.save()).toBeNull();
    expect(again.flow.saveProblem.value).toBe('STORE_UNAVAILABLE');
  });
});
