// The background side of GeroVault invitations against a fake gero-sync: two devices, an
// initiator and a cosigner, run the whole remote, QR and link flows, and every answer that does
// not open and check is refused. Test keys only (the manifest specs' participants).
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Bip32PrivateKey, ready } from '@cardano-sdk/crypto';
import { blake2b } from '@noble/hashes/blake2.js';
import {
  acceptSubject,
  decodeSignedAccept,
  encodeSignedAccept,
  openForRecipient,
  sealForRecipients,
} from '@/shared/gerovault/invite';
import { bytesToHex, hexToBytes } from '@/shared/gerovault/cbor';
import { deriveRoleKeys, deriveVaultPublicKeys, multisigAccountPublicKey, vaultKeyHashes } from '@/shared/gerovault';
import { testAccounts } from '@/shared/gerovault/__fixtures__/manifest';
import { Blockchain, Network, WalletType, type Wallet } from '@/models/types';
import { OwnAccountKeyError } from '@/modules/gerovault/create/ownAccountKeyFlow';
import { FakeSync } from './__fixtures__/fakeSync';
import { createInviteApi } from './inviteApi';
import { cip8AttestationOf, type VaultKeyMaterial } from './inviteKeys';
import { createInviteRecords, memoryInviteKv, type StoredSetup } from './inviteRecords';
import { InviteServiceError, createInviteService, type InviteService } from './inviteService';

const NETWORK = 'cardano-preprod';
const fixed = (label: string, n = 32) => blake2b(new TextEncoder().encode(`invite spec|${label}`), { dkLen: n });
const credentialOf = (label: string) => bytesToHex(fixed(`stake ${label}`, 28));

let accounts: Bip32PrivateKey[];
beforeAll(async () => {
  await ready();
  accounts = await testAccounts();
});

/** Wallet id -> test account: 1 Adam (initiator), 2 Dana, 3 Yuval, 4 Dana's second wallet. */
const ACCOUNT_OF: Record<number, number> = { 1: 0, 2: 1, 3: 2, 4: 3 };
const NAMES: Record<number, string> = { 1: 'Adam', 2: 'Dana', 3: 'Yuval', 4: 'Dana spare' };

function wallet(id: number, overrides: Partial<Wallet> = {}): Wallet {
  return { id, name: NAMES[id], chain: Blockchain.CARDANO, network: Network.PREPROD, type: WalletType.Normal, encryptionMethod: 'password', ...overrides } as Wallet;
}

/** The vault payment key of a test account at `index`, as the background would open it. */
async function material(walletId: number, index: number): Promise<VaultKeyMaterial> {
  const account = accounts[ACCOUNT_OF[walletId]];
  const keys = await deriveVaultPublicKeys(await deriveRoleKeys(multisigAccountPublicKey(account.toPublic().hex())), index);
  const credential = (await vaultKeyHashes(keys)).payment;
  const signer = account.derive([0, index]).toRawKey();
  let wiped = false;
  return {
    index,
    accountKey: account.toPublic().hex(),
    payment: keys.payment,
    stake: keys.stake,
    credential,
    attest: async subject => {
      if (wiped) throw new OwnAccountKeyError('locked');
      return cip8AttestationOf(signer, credential, subject);
    },
    wipe: () => { wiped = true; },
  };
}

interface Device {
  service: InviteService;
  kv: ReturnType<typeof memoryInviteKv>;
  backedUp: Set<number>;
  wallets: Record<number, Wallet>;
  opened: number;
}

let clock = 1_790_000_000_000;
const now = () => clock;
let sync: FakeSync;
let seed = 0;

function device(name: string, walletIds: number[]): Device {
  const kv = memoryInviteKv();
  const records = createInviteRecords(kv);
  const wallets: Record<number, Wallet> = Object.fromEntries(walletIds.map(id => [id, wallet(id)]));
  const backedUp = new Set(walletIds);
  const d: Device = { service: undefined as unknown as InviteService, kv, backedUp, wallets, opened: 0 };
  const transport = sync.transport(name, async () => (await records.deviceKey())?.publicKey ?? null);
  for (const id of walletIds) sync.device(name, { links: [`${NETWORK}|${credentialOf(NAMES[id])}`] });
  d.service = createInviteService({
    api: createInviteApi(transport),
    records,
    keys: {
      open: async (walletId, auth, index) => {
        if (auth.password !== 'right') throw new OwnAccountKeyError('wrong-password');
        d.opened++;
        return material(walletId, index);
      },
    },
    wallets: {
      all: async () => d.wallets,
      stakeCredential: w => credentialOf(w.name),
      backedUp: async id => d.backedUp.has(id),
      contactCredentials: async () => new Set([credentialOf('Adam')]),
    },
    vaultIndexes: async () => [],
    resolveHandle: async () => null,
    random: n => fixed(`${name} random ${++seed}`, n),
    now,
    // PUT /device publishes the new key at once.
    onDeviceKeyCreated: () => { void records.deviceKey().then(k => sync.device(name, { inviteKey: k?.publicKey })); },
  });
  return d;
}

const RIGHT = { password: 'right' };

async function startSetup(d: Device, owners = 2, threshold = 2) {
  return d.service.startSetup({ walletId: 1, auth: RIGHT, name: 'Ops petty cash', owners, threshold });
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (error) {
    if (error instanceof InviteServiceError) return error.code;
    throw error;
  }
  return 'resolved';
}

beforeEach(() => {
  clock = 1_790_000_000_000;
  sync = new FakeSync(now);
});

describe('remote invitation, end to end', () => {
  it('invites by stake credential, the cosigner accepts, the slot fills with their vault keys only', async () => {
    const adam = device('adam', [1]);
    const dana = device('dana', [2]);
    await dana.service.status(); // the cosigner's device publishes its invite key

    const { setup, accountKey } = await startSetup(adam);
    expect(setup.ownIndex).toBe(1);
    expect(setup.signerReady).toBe(true);
    expect(accountKey).toMatch(/^[0-9a-f]{128}$/);
    const invited = await adam.service.invite({ setupId: setup.setupId, n: 0, stakeCredential: credentialOf('Dana'), label: 'Dana' });
    expect(invited.slots[0]).toMatchObject({ status: 'waiting', label: 'Dana', verified: false });

    const { invites } = await dana.service.refreshInvites();
    expect(invites).toHaveLength(1);
    const view = invites[0];
    expect(view).toMatchObject({ state: 'open', known: true, network: 'preprod', vault: { name: 'Ops petty cash', threshold: 2, owners: 2 }, inviter: { label: 'Adam', credential: credentialOf('Adam') } });
    expect(view.wallets).toEqual([{ walletId: 2, name: 'Dana', addressed: true, backedUp: true }]);

    const joined = await dana.service.accept({ ref: view.ref, walletId: 2, auth: RIGHT, label: 'Dana' });
    expect(joined.state).toBe('accepted');
    expect(joined.join).toMatchObject({ walletId: 2, ownIndex: 1, verified: false });

    const after = await adam.service.refreshSetup({ setupId: setup.setupId });
    const danaKeys = await material(2, 1);
    expect(after.slots[0]).toMatchObject({ status: 'accepted', verified: false, accept: { label: 'Dana', via: 'invite', payment: danaKeys.payment, stake: danaKeys.stake, stakeCredential: credentialOf('Dana') } });
    expect(after.refused).toBe(0);
  });

  it('sends only the two vault keys of this vault: no account or role key in the ACCEPT', async () => {
    const adam = device('adam', [1]);
    const dana = device('dana', [2]);
    await dana.service.status();
    const { setup } = await startSetup(adam);
    await adam.service.invite({ setupId: setup.setupId, n: 0, stakeCredential: credentialOf('Dana') });
    const [invite] = (await dana.service.refreshInvites()).invites;
    await dana.service.accept({ ref: invite.ref, walletId: 2, auth: RIGHT });

    const response = sync.setups.get(setup.setupId)!.responses[0];
    const replySecret = hexToBytes((await createInviteRecords(adam.kv).deviceKey())!.secret)!;
    const plain = openForRecipient('ACCEPT', hexToBytes(setup.setupId)!, response.delivery, replySecret);
    expect(plain.ok).toBe(true);
    const decoded = decodeSignedAccept((plain as { value: Uint8Array }).value);
    expect(decoded.ok).toBe(true);
    const body = (decoded as unknown as { value: { body: Record<string, unknown> } }).value.body;
    expect(Object.keys(body).sort()).toEqual(['acceptedAt', 'invite', 'label', 'network', 'setupId', 'stakeCredential', 'vaultKeys']);
    const text = bytesToHex((plain as { value: Uint8Array }).value);
    expect(text).not.toContain(accounts[1].toPublic().hex().slice(0, 64));
  });

  it('takes the next free index for each accepted invitation, and releases it when the setup is cancelled', async () => {
    const adam = device('adam', [1]);
    const yuval = device('yuval', [3]);
    const dana = device('dana', [2]);
    await dana.service.status();
    const first = (await startSetup(adam)).setup;
    await adam.service.invite({ setupId: first.setupId, n: 0, stakeCredential: credentialOf('Dana') });
    const second = (await yuval.service.startSetup({ walletId: 3, auth: RIGHT, name: 'Trip fund', owners: 2, threshold: 2 })).setup;
    await yuval.service.invite({ setupId: second.setupId, n: 0, stakeCredential: credentialOf('Dana') });

    const { invites } = await dana.service.refreshInvites();
    expect(invites).toHaveLength(2);
    const joins = [];
    for (const i of invites) joins.push((await dana.service.accept({ ref: i.ref, walletId: 2, auth: RIGHT })).join!.ownIndex);
    expect(joins.sort()).toEqual([1, 2]);

    expect((await dana.service.holds({ walletId: 2 })).held.map(h => h.index).sort()).toEqual([1, 2]);

    // gero-sync cannot tell a joined cosigner that the setup was cancelled: the join holds its
    // index until the invitation's expiry, then releases it (a released index stays taken until a scan).
    await yuval.service.cancelSetup({ setupId: second.setupId });
    expect((await dana.service.refreshInvites()).invites.find(i => i.setupId === second.setupId)?.state).toBe('accepted');
    clock += 8 * 86_400_000;
    const refreshed = (await dana.service.refreshInvites()).invites;
    expect(refreshed.filter(i => i.state === 'cancelled')).toHaveLength(2);
    const holds = await dana.service.holds({ walletId: 2 });
    expect(holds.held).toEqual([]);
    expect(holds.released.map(r => r.index).sort()).toEqual([1, 2]);
  });

  it('declines with nothing about the wallet and shows Declined', async () => {
    const adam = device('adam', [1]);
    const dana = device('dana', [2]);
    await dana.service.status();
    const { setup } = await startSetup(adam);
    await adam.service.invite({ setupId: setup.setupId, n: 0, stakeCredential: credentialOf('Dana') });
    const [invite] = (await dana.service.refreshInvites()).invites;
    expect((await dana.service.decline({ ref: invite.ref })).state).toBe('declined');
    expect(dana.opened).toBe(0);
    const after = await adam.service.refreshSetup({ setupId: setup.setupId });
    expect(after.slots[0].status).toBe('declined');
  });

  it('revokes: the cosigner sees who revoked it and can no longer accept', async () => {
    const adam = device('adam', [1]);
    const dana = device('dana', [2]);
    await dana.service.status();
    const { setup } = await startSetup(adam);
    await adam.service.invite({ setupId: setup.setupId, n: 0, stakeCredential: credentialOf('Dana') });
    const [invite] = (await dana.service.refreshInvites()).invites;
    expect((await adam.service.revoke({ setupId: setup.setupId, n: 0 })).slots[0].status).toBe('revoked');
    const [revoked] = (await dana.service.refreshInvites()).invites;
    expect(revoked).toMatchObject({ state: 'revoked', revokedByInviter: true });
    expect(await code(dana.service.accept({ ref: invite.ref, walletId: 2, auth: RIGHT }))).toBe('REVOKED');
  });
});

describe('in person (QR) and by link', () => {
  it('joins by QR with the MAC, rotates the QR after the scan, and fills one card per scan', async () => {
    const adam = device('adam', [1]);
    const dana = device('dana', [2]);
    const yuval = device('yuval', [3]);
    const { setup } = await startSetup(adam, 3, 2);
    const qr = await adam.service.link({ setupId: setup.setupId, kind: 'qr' });
    expect(qr.payload.startsWith('gvi1')).toBe(true);
    expect(qr.expiresAt - clock).toBeLessThanOrEqual(600_000);

    const opened = await dana.service.openLink({ text: qr.payload });
    expect(opened).toMatchObject({ source: 'link', state: 'open', known: true, vault: { owners: 3 } });
    expect(opened.wallets.map(w => w.walletId)).toEqual([2]);
    await dana.service.accept({ ref: opened.ref, walletId: 2, auth: RIGHT, label: 'Dana' });
    const after = await adam.service.refreshSetup({ setupId: setup.setupId });
    expect(after.slots[0]).toMatchObject({ status: 'accepted', accept: { via: 'qr', label: 'Dana' } });
    expect(after.links.find(l => l.joinTokenHash === qr.joinTokenHash)?.state).toBe('used');

    // A second scan of the same, used code is refused; a new code fills the next card.
    expect(await code(yuval.service.openLink({ text: qr.payload }))).toBe('ALREADY_ANSWERED');
    const next = await adam.service.link({ setupId: setup.setupId, kind: 'qr' });
    expect(next.joinTokenHash).not.toBe(qr.joinTokenHash);
    const byYuval = await yuval.service.openLink({ text: next.url });
    await yuval.service.accept({ ref: byYuval.ref, walletId: 3, auth: RIGHT });
    const full = await adam.service.refreshSetup({ setupId: setup.setupId });
    expect(full.slots.map(s => s.status)).toEqual(['accepted', 'accepted']);
  });

  it('refuses an expired QR', async () => {
    const adam = device('adam', [1]);
    const dana = device('dana', [2]);
    const { setup } = await startSetup(adam);
    const qr = await adam.service.link({ setupId: setup.setupId, kind: 'qr' });
    clock += 601_000;
    expect(await code(dana.service.openLink({ text: qr.payload }))).toBe('EXPIRED');
  });
});

describe('fails closed', () => {
  async function invited() {
    const adam = device('adam', [1]);
    const dana = device('dana', [2]);
    await dana.service.status();
    const { setup } = await startSetup(adam);
    const view = await adam.service.invite({ setupId: setup.setupId, n: 0, stakeCredential: credentialOf('Dana') });
    return { adam, dana, setup: view };
  }

  async function adamSetup(adam: Device): Promise<StoredSetup> {
    return (await createInviteRecords(adam.kv).setup((await adam.service.listSetups())[0].setupId))!;
  }

  it('refuses an ACCEPT signed by a key other than the vault keys it carries', async () => {
    const { adam, setup } = await invited();
    const stored = await adamSetup(adam);
    const replyKey = hexToBytes((await createInviteRecords(adam.kv).deviceKey())!.publicKey)!;
    const dana = await material(2, 1);
    const body = {
      network: NETWORK as 'cardano-preprod',
      setupId: hexToBytes(setup.setupId)!,
      invite: hexToBytes(stored.slots[0].invite!.digest)!,
      label: 'Dana',
      stakeCredential: hexToBytes(credentialOf('Dana'))!,
      vaultKeys: { payment: hexToBytes(dana.payment)!, stake: hexToBytes(dana.stake)! },
      acceptedAt: Math.floor(clock / 1000),
    };
    // Signed by Yuval's key over Dana's keys: the attestation names the wrong credential.
    const yuval = await material(3, 1);
    const sig = await yuval.attest(acceptSubject(body));
    const sealed = sealForRecipients('ACCEPT', body.setupId, encodeSignedAccept(body, sig), [{ slot: 0, key: replyKey }], {
      contentKey: fixed('k'), nonce: fixed('n', 24), wraps: [{ ephemeralSecret: fixed('e'), nonce: fixed('w', 24) }],
    });
    sync.inject(setup.setupId, { kind: 'accept', inviteId: setup.slots[0].invite!.inviteId, delivery: { wrap: sealed.wraps[0], nonce: sealed.nonce, ciphertext: sealed.ciphertext } });
    const after = await adam.service.refreshSetup({ setupId: setup.setupId });
    expect(after.slots[0].status).toBe('waiting');
    expect(after.refused).toBe(1);
  });

  it('refuses a genuine ACCEPT replayed into another setup', async () => {
    const { adam, dana, setup } = await invited();
    const [invite] = (await dana.service.refreshInvites()).invites;
    await dana.service.accept({ ref: invite.ref, walletId: 2, auth: RIGHT });
    const genuine = sync.setups.get(setup.setupId)!.responses[0];
    const other = (await adam.service.startSetup({ walletId: 1, auth: RIGHT, name: 'Other', owners: 2, threshold: 2 })).setup;
    const otherView = await adam.service.invite({ setupId: other.setupId, n: 0, stakeCredential: credentialOf('Dana') });
    sync.inject(other.setupId, { kind: 'accept', inviteId: otherView.slots[0].invite!.inviteId, delivery: genuine.delivery });
    const after = await adam.service.refreshSetup({ setupId: other.setupId });
    expect(after.slots[0].status).toBe('waiting');
    expect(after.refused).toBe(1);
  });

  it('refuses an invitation gero-sync files under another setup id', async () => {
    const { dana } = await invited();
    sync.listHook = (_d, rows) => rows.map(r => ({ ...r, setupId: 'ab'.repeat(16) }));
    const { invites, refused } = await dana.service.refreshInvites();
    expect(invites).toHaveLength(0);
    expect(refused).toBe(1);
  });

  it('refuses a decoy wrap handed to the wrong device', async () => {
    const { dana, setup } = await invited();
    const invite = sync.setups.get(setup.setupId)!.invites[0];
    // Slot 4 is a decoy: its wrap names a key that is not this device's.
    sync.listHook = (_d, rows) => rows.map(r => ({ ...r, delivery: { wrap: invite.wraps[4], nonce: invite.nonce, ciphertext: invite.ciphertext } }));
    const { invites, refused } = await dana.service.refreshInvites();
    expect(invites).toHaveLength(0);
    expect(refused).toBe(1);
  });

  it('stops on a directory with an unusable key', async () => {
    const adam = device('adam', [1]);
    const { setup } = await startSetup(adam);
    const api = (sync as unknown as { route: (...a: unknown[]) => unknown });
    const route = api.route.bind(sync);
    api.route = (device: unknown, method: unknown, path: unknown, body: unknown) => {
      const out = route(device, method, path, body) as Record<string, unknown>;
      if (path === '/vault-invites/recipients') return { ...out, entries: (out['entries'] as { slot: number }[]).map(e => (e.slot === 2 ? { slot: 2, inviteKey: '00'.repeat(32) } : e)) };
      return out;
    };
    expect(await code(adam.service.invite({ setupId: setup.setupId, n: 0, stakeCredential: credentialOf('Dana') }))).toBe('BROKEN_SERVER');
  });

  it('refuses to accept an expired invitation, from the wrong wallet, without a backup, or with the wrong password', async () => {
    const { dana } = await invited();
    dana.wallets[4] = wallet(4);
    const [invite] = (await dana.service.refreshInvites()).invites;
    expect(await code(dana.service.accept({ ref: invite.ref, walletId: 4, auth: RIGHT }))).toBe('NOT_ADDRESSED');
    dana.backedUp.delete(2);
    expect(await code(dana.service.accept({ ref: invite.ref, walletId: 2, auth: RIGHT }))).toBe('NOT_BACKED_UP');
    dana.backedUp.add(2);
    expect(await code(dana.service.accept({ ref: invite.ref, walletId: 2, auth: { password: 'wrong' } }))).toBe('WRONG_PASSWORD');
    dana.wallets[2] = wallet(2, { network: Network.MAINNET });
    expect(await code(dana.service.accept({ ref: invite.ref, walletId: 2, auth: RIGHT }))).toBe('WRONG_NETWORK');
    dana.wallets[2] = wallet(2);
    clock += 8 * 86_400_000;
    expect(await code(dana.service.accept({ ref: invite.ref, walletId: 2, auth: RIGHT }))).toBe('EXPIRED');
    // Nothing was taken: no index is held by the failed attempts.
    expect((await dana.service.holds({ walletId: 2 })).held).toEqual([]);
  });

  it('refuses the same vault keys twice', async () => {
    const adam = device('adam', [1]);
    const dana = device('dana', [2]);
    const { setup } = await startSetup(adam, 3, 2);
    const qr = await adam.service.link({ setupId: setup.setupId, kind: 'link' });
    const opened = await dana.service.openLink({ text: qr.url });
    await dana.service.accept({ ref: opened.ref, walletId: 2, auth: RIGHT });
    const first = sync.setups.get(setup.setupId)!.responses[0];
    // The same answer filed again under a second link: a duplicate, never a second cosigner.
    sync.inject(setup.setupId, { kind: 'accept', joinTokenHash: first.joinTokenHash, delivery: first.delivery });
    const after = await adam.service.refreshSetup({ setupId: setup.setupId });
    expect(after.slots.filter(s => s.status === 'accepted')).toHaveLength(1);
  });

  it('needs the password again once the signer has timed out', async () => {
    const adam = device('adam', [1]);
    const { setup } = await startSetup(adam);
    clock += 31 * 60_000;
    expect(await code(adam.service.invite({ setupId: setup.setupId, n: 0, stakeCredential: credentialOf('Dana') }))).toBe('LOCKED');
    expect(await code(adam.service.unlockSetup({ setupId: setup.setupId, auth: { password: 'wrong' } }))).toBe('WRONG_PASSWORD');
    expect((await adam.service.unlockSetup({ setupId: setup.setupId, auth: RIGHT })).setup.signerReady).toBe(true);
  });

  it('lists the pending setups when the device holds too many', async () => {
    const adam = device('adam', [1]);
    for (let i = 0; i < 10; i++) await adam.service.startSetup({ walletId: 1, auth: RIGHT, name: `Vault ${i}`, owners: 2, threshold: 2 });
    try {
      await startSetup(adam);
      expect.unreachable();
    } catch (error) {
      expect((error as InviteServiceError).code).toBe('TOO_MANY_PENDING');
      expect(((error as InviteServiceError).details?.['open'] as unknown[]).length).toBe(10);
    }
  });
});

describe('push text', () => {
  it('names who invited and to which vault, and who joined', async () => {
    const adam = device('adam', [1]);
    const dana = device('dana', [2]);
    await dana.service.status();
    const { setup } = await startSetup(adam);
    await adam.service.invite({ setupId: setup.setupId, n: 0, stakeCredential: credentialOf('Dana') });
    const pushed = await dana.service.forPush('vault_invite', setup.setupId);
    expect(pushed).toMatchObject({ kind: 'invite', inviter: 'Adam', vault: 'Ops petty cash', known: true });
    await dana.service.accept({ ref: (pushed as { ref: string }).ref, walletId: 2, auth: RIGHT, label: 'Dana' });
    expect(await adam.service.forPush('vault_response', setup.setupId)).toMatchObject({ kind: 'joined', cosigner: 'Dana', vault: 'Ops petty cash' });
    expect(await dana.service.forPush('vault_invite', 'cd'.repeat(16))).toBeNull();
  });
});
