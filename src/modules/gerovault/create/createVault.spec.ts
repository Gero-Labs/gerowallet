// The create flow's logic: template bounds, own index and keys, cosigner input, the vault every
// cosigner builds, the first manifest and the ceremony records. Test keys only (`__fixtures__`).
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { bech32 } from 'bech32';
import type { Bip32PrivateKey } from '@cardano-sdk/crypto';
import {
  GeroVaultError,
  MAX_OWNERS,
  decodeManifest,
  deriveParticipantKeyHashes,
  deriveRoleKeys,
  deriveVaultPublicKeys,
  encodeVaultPublicKeys,
  multisigAccountPublicKey,
  vaultSpecWarnings,
  type MultisigAccountPublicKey,
} from '@/shared/gerovault';
import { testAccounts } from '@/shared/gerovault/__fixtures__/manifest';
import { clearDbCache } from '@/db/wallet-db';
import { vaultStore } from '@/db/vaultStore';
import {
  allocateOwnIndex,
  buildCreatedVault,
  candidateInput,
  clampOwners,
  clampThreshold,
  firstManifest,
  fingerprint,
  ownVaultKeys,
  readCosigner,
  recordNumberMatch,
  recordQrScan,
  saveCreatedVault,
  scriptKeys,
  shareText,
  templateProblem,
  templateWarnings,
  verificationState,
  verificationView,
  withoutDuplicates,
  type CosignerDraft,
  type CreatedVault,
  type OwnVaultKeys,
  type ReadyCosigner,
} from './createVault';

const toBech32 = (prefix: string, hex: string) => bech32.encode(prefix, bech32.toWords(Buffer.from(hex, 'hex')), 1023);

let accounts: Bip32PrivateKey[];
let publicAccounts: MultisigAccountPublicKey[];

beforeAll(async () => {
  accounts = await testAccounts();
  publicAccounts = accounts.map(a => multisigAccountPublicKey(a.toPublic().hex()));
});

const gero = (label: string, keys: string): CosignerDraft => ({ source: 'gero', label, keys, index: '' });
const external = (label: string, keys: string, index: string): CosignerDraft => ({ source: 'external', label, keys, index });

async function ready(draft: CosignerDraft): Promise<ReadyCosigner> {
  const reading = await readCosigner(draft);
  if (reading.ok === false) throw new Error(`not ready: ${reading.problem}`);
  return reading.cosigner;
}

describe('template', () => {
  const choice = (owners: number, threshold: number, extra: Partial<{ name: string; acknowledged: boolean }> = {}) =>
    ({ name: '', acknowledged: false, owners, threshold, ...extra });

  it('keeps the core library bounds: 2 to 20 owners, a threshold of 2 up to the owners', () => {
    expect(templateProblem(choice(1, 2))).toBe('TOO_FEW_OWNERS');
    expect(templateProblem(choice(MAX_OWNERS + 1, 2))).toBe('TOO_MANY_OWNERS');
    expect(templateProblem(choice(3, 1))).toBe('THRESHOLD_TOO_LOW');
    expect(templateProblem(choice(3, 4))).toBe('THRESHOLD_OUT_OF_RANGE');
    expect(templateProblem(choice(3, 2))).toBeUndefined();
    expect(templateProblem(choice(20, 20, { acknowledged: true }))).toBeUndefined();
  });

  it('asks for the acknowledgement when every owner must sign', () => {
    expect(templateProblem(choice(3, 3))).toBe('NOT_ACKNOWLEDGED');
    expect(templateProblem(choice(3, 3, { acknowledged: true }))).toBeUndefined();
  });

  it('gives the same warnings as the library for the same counts', async () => {
    const people = await Promise.all(publicAccounts.slice(0, 3).map(async a => deriveParticipantKeyHashes(await deriveRoleKeys(a), 1)));
    for (const threshold of [2, 3]) {
      expect(templateWarnings(3, threshold)).toEqual(vaultSpecWarnings({ template: { kind: 'standard', threshold }, owners: people }));
    }
  });

  it('refuses a name the label rules refuse, and takes none', () => {
    expect(templateProblem(choice(2, 2, { acknowledged: true, name: 'Ops\u0007cash' }))).toBe('INVALID_NAME');
    expect(templateProblem(choice(2, 2, { acknowledged: true, name: '   ' }))).toBeUndefined();
  });

  it('clamps the counts the buttons reach', () => {
    expect(clampOwners(1)).toBe(2);
    expect(clampOwners(25)).toBe(20);
    expect(clampThreshold(1, 5)).toBe(2);
    expect(clampThreshold(9, 5)).toBe(5);
  });
});

describe('own index and keys', () => {
  it('starts at 1 and skips the indexes of vaults and candidates this wallet holds', () => {
    expect(allocateOwnIndex([])).toEqual({ ok: true, index: 1, reused: false });
    expect(allocateOwnIndex([{ ownIndex: 1, status: 'accepted' }, { ownIndex: 2, status: 'candidate' }])).toEqual({ ok: true, index: 3, reused: false });
    expect(allocateOwnIndex([{ ownIndex: 2, status: 'accepted' }])).toEqual({ ok: true, index: 1, reused: false });
  });

  it('derives the vault keys at the index, with both paths and the text to share', async () => {
    const own = await ownVaultKeys(publicAccounts[1], { index: 4, reused: false });
    expect(own.paths).toEqual({ payment: "m/1854'/1815'/0'/0/4", stake: "m/1854'/1815'/0'/2/4" });
    expect(own.vaultKeys.payment).toBe(accounts[1].derive([0, 4]).toRawKey().toPublic().hex());
    expect(own.vaultKeys.stake).toBe(accounts[1].derive([2, 4]).toRawKey().toPublic().hex());
    expect(own.hashes).toEqual(await deriveParticipantKeyHashes(await deriveRoleKeys(publicAccounts[1]), 4));
    expect(shareText(own.encoded)).toMatch(/^addr_shared_vk1[a-z0-9]+\nstake_shared_vk1[a-z0-9]+$/);
    expect(fingerprint(own.hashes.payment)).toMatch(/^[0-9a-f]{4}\.\.\.[0-9a-f]{4}$/);
  });
});

describe('cosigner input', () => {
  let shared: string;
  beforeAll(async () => {
    shared = shareText((await ownVaultKeys(publicAccounts[2], { index: 3, reused: false })).encoded);
  });

  it('reads a Gero cosigner\'s two vault keys in either order and with any separator', async () => {
    const [payment, stake] = shared.split('\n');
    const a = await ready(gero('Dana', shared));
    const b = await ready(gero(' Dana ', `${stake}, ${payment}`));
    expect(b.hashes).toEqual(a.hashes);
    expect(b.label).toBe('Dana');
    expect(a.index).toBeUndefined();
  });

  it('derives an external wallet\'s keys from its account key or its role keys, at the index it reports', async () => {
    const roles = await deriveRoleKeys(publicAccounts[3]);
    const expected = await deriveVaultPublicKeys(roles, 7);
    const byAccount = await ready(external('Ledger', toBech32('acct_shared_xvk', publicAccounts[3].hex), '7'));
    const byRoles = await ready(external('Ledger', `${toBech32('stake_shared_xvk', roles.stake.hex)}\n${toBech32('addr_shared_xvk', roles.payment.hex)}`, '7'));
    expect(byAccount.vaultKeys.payment).toBe(expected.payment);
    expect(byAccount.vaultKeys.stake).toBe(expected.stake);
    expect(byRoles.hashes).toEqual(byAccount.hashes);
    expect(byAccount.index).toBe(7);
  });

  it('names what is wrong with an entry', async () => {
    const account = toBech32('acct_shared_xvk', publicAccounts[3].hex);
    const problem = async (draft: CosignerDraft) => {
      const reading = await readCosigner(draft);
      return reading.ok === false ? reading.problem : undefined;
    };
    expect(await problem(gero('', shared))).toBe('LABEL_REQUIRED');
    expect(await problem(gero('Dana\u202e', shared))).toBe('INVALID_LABEL');
    expect(await problem(gero('Dana', ''))).toBe('KEYS_REQUIRED');
    expect(await problem(gero('Dana', shared.split('\n')[0]))).toBe('TWO_KEYS_EXPECTED');
    expect(await problem(gero('Dana', `${account} ${account}`))).toBe('EXTENDED_KEY_NOT_ACCEPTED');
    expect(await problem(gero('Dana', 'addr_shared_vk1qqq stake_shared_vk1qqq'))).toBe('INVALID_VAULT_KEYS');
    expect(await problem(external('Ledger', shared, '1'))).toBe('VAULT_KEYS_NOT_EXTERNAL');
    expect(await problem(external('Ledger', toBech32('acct_xvk', publicAccounts[3].hex), '1'))).toBe('CIP1852_KEY');
    expect(await problem(external('Ledger', publicAccounts[3].hex, '1'))).toBe('INVALID_EXTERNAL_KEYS');
    expect(await problem(external('Ledger', account, ''))).toBe('INDEX_REQUIRED');
    expect(await problem(external('Ledger', account, '-1'))).toBe('INVALID_INDEX');
    expect(await problem(external('Ledger', account, '2147483648'))).toBe('INVALID_INDEX');
    expect(await problem(external('Ledger', account, '0'))).toBeUndefined();
  });

  it('refuses this wallet\'s own keys sent back, and the same cosigner twice', async () => {
    const own = await ownVaultKeys(publicAccounts[2], { index: 3, reused: false });
    const other = shareText((await ownVaultKeys(publicAccounts[1], { index: 1, reused: false })).encoded);
    const readings = await Promise.all([gero('Me', shared), gero('Dana', other), gero('Dana again', other)].map(readCosigner));
    const checked = withoutDuplicates(own.hashes, readings);
    expect(checked.map(r => (r.ok === false ? r.problem : 'ok'))).toEqual(['SAME_AS_YOURS', 'ok', 'SAME_AS_ANOTHER']);
    expect(withoutDuplicates(undefined, readings).map(r => (r.ok === false ? r.problem : 'ok'))).toEqual(['ok', 'ok', 'SAME_AS_ANOTHER']);
  });
});

/**
 * Three Gero wallets (test accounts 0, 1 and 2, at their own indexes 1, 3 and 2) and one external
 * wallet (account 3 at index 5) create one vault, each on its own device, entering the others in
 * its own order.
 */
async function eachDeviceBuilds(withExternal: boolean): Promise<CreatedVault[]> {
  const indexes = [1, 3, 2];
  const owns: OwnVaultKeys[] = await Promise.all(indexes.map((index, i) => ownVaultKeys(publicAccounts[i], { index, reused: false })));
  const texts = owns.map(o => shareText(o.encoded));
  const externalDraft = external('Hardware', toBech32('acct_shared_xvk', publicAccounts[3].hex), '5');
  const others = (me: number) => [0, 1, 2].filter(i => i !== me).map(i => gero(`Owner ${i}`, texts[i]));
  return Promise.all(owns.map(async (own, me) => {
    const drafts = withExternal ? [externalDraft, ...others(me)] : others(me);
    const ordered = me === 1 ? [...drafts].reverse() : drafts;
    const cosigners = await Promise.all(ordered.map(ready));
    return buildCreatedVault({
      network: 'preprod',
      template: { owners: cosigners.length + 1, threshold: 2, acknowledged: false },
      own,
      cosigners,
    });
  }));
}

describe('every cosigner builds the same vault', () => {
  it('gets the same scripts, address and vault id on every device', async () => {
    const vaults = await eachDeviceBuilds(false);
    const first = vaults[0];
    expect(first.vaultId).toMatch(/^[0-9a-f]{64}$/);
    expect(String(first.addresses.base)).toMatch(/^addr_test1/);
    for (const vault of vaults) {
      expect(vault.vaultId).toBe(first.vaultId);
      expect(vault.addresses).toEqual(first.addresses);
      expect(vault.scripts.payment.cbor).toBe(first.scripts.payment.cbor);
      expect(vault.scripts.stake.cbor).toBe(first.scripts.stake.cbor);
    }
  });

  it('shows the same verification number and QR on every device, and each device checks its own entry', async () => {
    const vaults = await eachDeviceBuilds(false);
    const states = await Promise.all(vaults.map((v, i) => firstManifest(v, 1_790_000_000 + i)));
    const views = states.map(s => {
      if (s.ok === false) throw new Error(s.reason);
      expect(s.ack.ownCredential).toBe(vaults[states.indexOf(s)].own.hashes.payment);
      return verificationView(s.manifest);
    });
    expect(views[0].groups).toHaveLength(8);
    for (const group of views[0].groups) expect(group).toMatch(/^[0-9]{5}$/);
    for (const view of views) {
      expect(view.groups).toEqual(views[0].groups);
      expect(view.qrPayload).toBe(views[0].qrPayload);
    }
    expect(views[0].qrPayload).toBe(`gero-vault/v1|VERIFY|cardano-preprod|${vaults[0].vaultId}|${views[0].digest}`);
  });

  it('includes an external wallet added from its account key at the index it reports', async () => {
    const vaults = await eachDeviceBuilds(true);
    for (const vault of vaults) expect(vault.vaultId).toBe(vaults[0].vaultId);
    const externalKeys = await deriveVaultPublicKeys(await deriveRoleKeys(publicAccounts[3]), 5);
    expect(vaults[0].cosigners.find(c => c.source === 'external')?.vaultKeys.payment).toBe(externalKeys.payment);
    // Its manifest entry needs this owner's vault key signature, which this module cannot make yet.
    expect(await firstManifest(vaults[0], 1_790_000_000)).toEqual({ ok: false, reason: 'EXTERNAL_COSIGNERS' });
  });

  it('lists each script\'s threshold and keys, sorted, for the Details layer', async () => {
    const [vault] = await eachDeviceBuilds(false);
    const payment = scriptKeys(vault.scripts.payment);
    expect(payment.threshold).toBe(2);
    expect(payment.keys).toEqual([vault.own, ...vault.cosigners].map(p => p.hashes.payment).sort());
    expect(scriptKeys(vault.scripts.stake).keys).toEqual([vault.own, ...vault.cosigners].map(p => p.hashes.stake).sort());
  });

  it('refuses a vault whose cosigner count does not match the template', async () => {
    const [vault] = await eachDeviceBuilds(false);
    await expect(buildCreatedVault({
      network: 'preprod',
      template: { owners: 4, threshold: 2, acknowledged: false },
      own: vault.own,
      cosigners: vault.cosigners,
    })).rejects.toBeInstanceOf(GeroVaultError);
  });

  it('needs the acknowledgement for an all-owners vault', async () => {
    const [vault] = await eachDeviceBuilds(false);
    const build = (acknowledged: boolean) => buildCreatedVault({ network: 'preprod', template: { owners: 3, threshold: 3, acknowledged }, own: vault.own, cosigners: vault.cosigners });
    await expect(build(false)).rejects.toMatchObject({ code: 'WARNING_NOT_ACKNOWLEDGED' });
    await expect(build(true)).resolves.toMatchObject({ threshold: 3 });
  });
});

describe('the verification ceremony', () => {
  async function device(me: number) {
    const vaults = await eachDeviceBuilds(false);
    const states = await Promise.all(vaults.map(v => firstManifest(v, 1_790_000_000)));
    const state = states[me];
    if (state.ok === false) throw new Error(state.reason);
    const qrOf = (i: number) => {
      const s = states[i];
      if (s.ok === false) throw new Error(s.reason);
      return verificationView(s.manifest).qrPayload;
    };
    return { vault: vaults[me], ...state, qrOf, cosigner: (i: number) => vaults[i].own.hashes.payment };
  }

  it('records a number match and a QR scan, and counts each cosigner verified once', async () => {
    const d = await device(0);
    let records = recordNumberMatch(d.vault, d.manifest, [], d.cosigner(1), 1_790_000_100);
    records = recordNumberMatch(d.vault, d.manifest, records, d.cosigner(1), 1_790_000_200);
    expect(records).toHaveLength(1);
    const scanned = recordQrScan(d.vault, d.manifest, records, d.cosigner(2), d.qrOf(2), 1_790_000_300);
    if (scanned.ok === false) throw new Error(scanned.code);
    const state = await verificationState(d.manifest, d.ack, scanned.records);
    expect(state.verified).toBe(2);
    expect(state.cosigners.map(c => [c.credential === d.cosigner(1) ? 'B' : 'C', c.state, c.method]).sort()).toEqual([
      ['B', 'verified', 'number'],
      ['C', 'verified', 'qr'],
    ]);
  });

  it('keeps funding closed until every owner has a device binding, verified or not', async () => {
    const d = await device(0);
    const records = [d.cosigner(1), d.cosigner(2)].reduce((acc, c) => recordNumberMatch(d.vault, d.manifest, acc, c, 1_790_000_100), [] as ReturnType<typeof recordNumberMatch>);
    expect((await verificationState(d.manifest, d.ack, records)).fundingOpen).toBe(false);
    expect((await verificationState(d.manifest, d.ack, [])).fundingOpen).toBe(false);
    expect(d.ack.unattested).toHaveLength(3);
  });

  it('refuses a QR of another vault, of other keys, or no QR at all', async () => {
    const d = await device(0);
    const otherVault = d.qrOf(1).replace(d.vault.vaultId, 'ab'.repeat(32));
    const otherKeys = d.qrOf(1).replace(/\|[0-9a-f]{64}$/, `|${'cd'.repeat(32)}`);
    expect(recordQrScan(d.vault, d.manifest, [], d.cosigner(1), otherVault, 1)).toEqual({ ok: false, code: 'OTHER_VAULT' });
    expect(recordQrScan(d.vault, d.manifest, [], d.cosigner(1), otherKeys, 1)).toEqual({ ok: false, code: 'DIFFERENT_KEYS' });
    expect(recordQrScan(d.vault, d.manifest, [], d.cosigner(1), 'hello', 1)).toEqual({ ok: false, code: 'MALFORMED_QR' });
  });

  it('verifies nobody but a Gero cosigner of this vault', async () => {
    const d = await device(0);
    expect(() => recordNumberMatch(d.vault, d.manifest, [], d.vault.own.hashes.payment, 1)).toThrow(GeroVaultError);
    expect(() => recordQrScan(d.vault, d.manifest, [], '00'.repeat(28), d.qrOf(1), 1)).toThrow(GeroVaultError);
  });
});

describe('save', () => {
  let nextWallet = 318400;
  const wallets: number[] = [];
  const walletId = () => {
    const id = nextWallet++;
    wallets.push(id);
    return id;
  };
  afterEach(async () => {
    for (const id of wallets.splice(0)) {
      clearDbCache(id);
      await Dexie.delete(`wallet-${id}`);
    }
  });

  it('stores the vault as accepted, with its manifest, labels and records, and refuses it twice', async () => {
    const [vault] = await eachDeviceBuilds(false);
    const state = await firstManifest(vault, 1_790_000_000);
    if (state.ok === false) throw new Error(state.reason);
    const records = recordNumberMatch(vault, state.manifest, [], vault.cosigners[0].hashes.payment, 1_790_000_100);
    const wallet = walletId();
    const input = candidateInput(vault, ' Ops petty cash ', state.manifest);
    const saved = await saveCreatedVault(vaultStore, wallet, input, records);
    expect(saved).toMatchObject({ vaultId: vault.vaultId, status: 'accepted', origin: 'created', name: 'Ops petty cash', ownIndex: 1, network: 'preprod' });
    expect(saved.verifications).toEqual(records);
    expect(saved.manifest?.version).toBe(1);
    expect(decodeManifest(saved.manifest!.cbor).ok).toBe(true);
    expect(saved.participants.find(p => p.self)?.vaultKeys).toEqual(encodeVaultPublicKeys(vault.own.vaultKeys));
    expect(saved.participants.filter(p => !p.self).map(p => p.label).sort()).toEqual(['Owner 1', 'Owner 2']);
    // The next vault of this wallet takes the next index.
    expect(allocateOwnIndex(await vaultStore.list(wallet))).toEqual({ ok: true, index: 2, reused: false });
    await expect(saveCreatedVault(vaultStore, wallet, input, records)).rejects.toMatchObject({ code: 'VAULT_EXISTS' });
  });

  it('refuses to save a vault at an index another vault of this wallet took meanwhile', async () => {
    // Two setups in two tabs both took index 1; the first to save keeps it.
    const [first] = await eachDeviceBuilds(false);
    const [second] = await eachDeviceBuilds(true);
    expect(first.own.index).toBe(second.own.index);
    const wallet = walletId();
    await saveCreatedVault(vaultStore, wallet, candidateInput(first, ''), []);
    await expect(saveCreatedVault(vaultStore, wallet, candidateInput(second, ''), [])).rejects.toMatchObject({ code: 'INDEX_TAKEN' });
    expect((await vaultStore.list(wallet)).map(v => v.vaultId)).toEqual([first.vaultId]);
  });

  it('never takes over a restored or imported candidate of the same vault', async () => {
    const [vault] = await eachDeviceBuilds(true);
    const wallet = walletId();
    await vaultStore.addCandidate(wallet, { ...candidateInput(vault, ''), origin: 'restored' });
    await expect(saveCreatedVault(vaultStore, wallet, candidateInput(vault, ''), [])).rejects.toMatchObject({ code: 'VAULT_EXISTS' });
    expect((await vaultStore.get(wallet, vault.vaultId))?.status).toBe('candidate');
  });

  it('accepts a candidate an earlier attempt left behind', async () => {
    const [vault] = await eachDeviceBuilds(true);
    const wallet = walletId();
    const input = candidateInput(vault, '');
    await vaultStore.addCandidate(wallet, input);
    const saved = await saveCreatedVault(vaultStore, wallet, input, []);
    expect(saved.status).toBe('accepted');
    expect(saved.manifest).toBeNull();
    expect(saved.name).toBeUndefined();
  });
});
