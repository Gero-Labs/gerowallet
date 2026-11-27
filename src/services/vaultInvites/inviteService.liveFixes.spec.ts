// What the two-desktop preprod run found (PR 1778): a cosigner whose device never made an invite
// key, a reminder that could not reach them afterwards, one wallet taking two slots, a verified
// cosigner filed under Requests, and a rate limit read as "offline". Against the fake gero-sync.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeSync } from './__fixtures__/fakeSync';
import { NETWORK, RIGHT, codeOf, credentialOf, loadAccounts, makeDevice, material, type Device } from './__fixtures__/inviteHarness';
import { InviteServiceError } from './inviteService';
import type { InviteTransport } from './inviteApi';

let clock = 1_790_000_000_000;
const now = () => clock;
let sync: FakeSync;

beforeAll(loadAccounts);
beforeEach(() => {
  clock = 1_790_000_000_000;
  sync = new FakeSync(now);
});

const device = (name: string, ids: number[], opts?: Parameters<typeof makeDevice>[4]) => makeDevice(sync, now, name, ids, opts);

async function startSetup(d: Device, owners = 2, threshold = 2) {
  return (await d.service.startSetup({ walletId: 1, auth: RIGHT, name: 'Ops petty cash', owners, threshold })).setup;
}

const postsTo = (suffix: RegExp) => sync.calls.filter(c => c.method === 'POST' && suffix.test(c.path));

describe('B1: the device invite key does not wait for Create vault', () => {
  it('a device that only reads its mailbox makes its key, publishes it, and can then be invited', async () => {
    const adam = device('adam', [1]);
    const dana = device('dana', [2]);
    // Dana never opened Create vault: her overview read the mailbox, nothing else.
    expect((await dana.service.refreshInvites()).invites).toEqual([]);
    expect(dana.published).toBe(1);
    const key = (await dana.records.deviceKey())?.publicKey;
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(sync.devices.get('dana')?.inviteKey).toBe(key);

    const setup = await startSetup(adam);
    await adam.service.invite({ setupId: setup.setupId, n: 0, stakeCredential: credentialOf('Dana') });
    const { invites } = await dana.service.refreshInvites();
    expect(invites).toHaveLength(1);
    expect(invites[0]).toMatchObject({ state: 'open', vault: { name: 'Ops petty cash' } });
    // One key for the device's life: reading again makes no second one.
    expect(dana.published).toBe(1);
    expect((await dana.records.deviceKey())?.publicKey).toBe(key);
  });

  it('the registration publishes the key of a device no vault screen ever touched', async () => {
    const adam = device('adam', [1]);
    const dana = device('dana', [2]);
    const key = await dana.register();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    const setup = await startSetup(adam);
    await adam.service.invite({ setupId: setup.setupId, n: 0, stakeCredential: credentialOf('Dana') });
    // The invitation was sealed to her real key: slot 0 of the directory is hers.
    const wraps = sync.setups.get(setup.setupId)!.invites[0].wraps;
    expect(wraps[0].recipientKey).toBe(key);
    expect((await dana.service.refreshInvites()).invites).toHaveLength(1);
  });
});

describe('B2: Remind is a fresh directory lookup and a re-send', () => {
  it('recovers an invitation sealed before the cosigner had a key', async () => {
    const adam = device('adam', [1]);
    const dana = device('dana', [2]);
    const setup = await startSetup(adam);
    // Dana's device has published no key yet: the directory is five decoys, and the invitation is lost.
    const invited = await adam.service.invite({ setupId: setup.setupId, n: 0, stakeCredential: credentialOf('Dana'), label: 'Dana' });
    const firstId = invited.slots[0].invite!.inviteId;
    expect(await dana.register()).toMatch(/^[0-9a-f]{64}$/);
    expect((await dana.service.refreshInvites()).invites).toEqual([]);

    const reminded = await adam.service.remind({ setupId: setup.setupId, n: 0 });
    // A new sealed invitation replaced the old one (PROTOCOL 7.5.2), in the same slot.
    expect(reminded.slots[0]).toMatchObject({ status: 'waiting', label: 'Dana' });
    expect(reminded.slots[0].invite!.inviteId).not.toBe(firstId);
    expect(reminded.slots[0].invite!.remindedAt).toBe(clock);
    const server = sync.setups.get(setup.setupId)!.invites;
    expect(server.map(i => i.state)).toEqual(['replaced', 'open']);

    const { invites } = await dana.service.refreshInvites();
    expect(invites).toHaveLength(1);
    await dana.service.accept({ ref: invites[0].ref, walletId: 2, auth: RIGHT, label: 'Dana' });
    const after = await adam.service.refreshSetup({ setupId: setup.setupId });
    expect(after.slots[0]).toMatchObject({ status: 'accepted', accept: { label: 'Dana', via: 'invite' } });
    expect(after.refused).toBe(0);
  });

  it('only asks gero-sync to push again when the directory did not change', async () => {
    const adam = device('adam', [1]);
    const dana = device('dana', [2]);
    await dana.register();
    const setup = await startSetup(adam);
    const invited = await adam.service.invite({ setupId: setup.setupId, n: 0, stakeCredential: credentialOf('Dana') });
    const reminded = await adam.service.remind({ setupId: setup.setupId, n: 0 });
    expect(reminded.slots[0].invite!.inviteId).toBe(invited.slots[0].invite!.inviteId);
    expect(reminded.slots[0].invite!.remindedAt).toBe(clock);
    expect(postsTo(/\/remind$/)).toHaveLength(1);
    expect(postsTo(/\/invites$/)).toHaveLength(1);
    // Every reminder looks the directory up again.
    expect(postsTo(/\/vault-invites\/recipients$/)).toHaveLength(2);
  });

  it('answers the same whether or not a device exists, and needs the vault key to seal again', async () => {
    const adam = device('adam', [1]);
    const dana = device('dana', [2]);
    const setup = await startSetup(adam, 3, 2);
    await adam.service.invite({ setupId: setup.setupId, n: 0, stakeCredential: credentialOf('Dana') });
    // Nobody holds this credential: the reminder still succeeds, and reads like any other.
    await adam.service.invite({ setupId: setup.setupId, n: 1, stakeCredential: credentialOf('Nobody') });
    const nobody = await adam.service.remind({ setupId: setup.setupId, n: 1 });
    expect(nobody.slots[1]).toMatchObject({ status: 'waiting' });
    expect(nobody.slots[1].invite!.remindedAt).toBe(clock);

    // The directory changed and the vault key has closed: the reminder says so instead of doing nothing.
    await dana.register();
    clock += 31 * 60_000;
    expect(await codeOf(adam.service.remind({ setupId: setup.setupId, n: 0 }))).toBe('LOCKED');
    await adam.service.unlockSetup({ setupId: setup.setupId, auth: RIGHT });
    await adam.service.remind({ setupId: setup.setupId, n: 0 });
    expect((await dana.service.refreshInvites()).invites).toHaveLength(1);
  });

  it('still opens an answer to the invitation a reminder replaced', async () => {
    const adam = device('adam', [1]);
    const dana = device('dana', [2]);
    const spare = device('dana-laptop', [2]);
    await dana.register();
    const setup = await startSetup(adam);
    await adam.service.invite({ setupId: setup.setupId, n: 0, stakeCredential: credentialOf('Dana') });
    const [invite] = (await dana.service.refreshInvites()).invites;
    // Dana accepts on her phone; before Adam reads it, her laptop registers and he reminds.
    await dana.service.accept({ ref: invite.ref, walletId: 2, auth: RIGHT, label: 'Dana' });
    await spare.register();
    await adam.service.remind({ setupId: setup.setupId, n: 0 });
    const after = await adam.service.refreshSetup({ setupId: setup.setupId });
    expect(after.slots[0]).toMatchObject({ status: 'accepted', accept: { label: 'Dana' } });
    expect(after.refused).toBe(0);
  });

  it('passes on the per-credential limit of gero-sync', async () => {
    const adam = device('adam', [1]);
    const dana = device('dana', [2]);
    const setup = await startSetup(adam);
    await adam.service.invite({ setupId: setup.setupId, n: 0, stakeCredential: credentialOf('Dana') });
    await dana.register();
    sync.failNext = { path: /\/invites$/, error: Object.assign(new Error('rate_limited'), { name: 'NotifyError' as const, status: 429, code: 'rate_limited', retryAfterMs: 3_600_000 }) as never };
    try {
      await adam.service.remind({ setupId: setup.setupId, n: 0 });
      expect.unreachable();
    } catch (error) {
      expect((error as InviteServiceError).code).toBe('RATE_LIMITED');
      expect((error as InviteServiceError).details).toEqual({ retryAfterMs: 3_600_000 });
    }
    // The open invitation is still the first one.
    expect((await adam.service.getSetup({ setupId: setup.setupId })).slots[0].status).toBe('waiting');
  });
});

describe('one wallet, one slot', () => {
  it('initiator: refuses a second ACCEPT from a wallet that already joined, keeps the first and says so', async () => {
    const adam = device('adam', [1]);
    const dana = device('dana', [2]);
    // Dana's second device holds the same wallet: its own records know nothing of the first join.
    const laptop = device('dana-laptop', [2]);
    const setup = await startSetup(adam, 3, 2);
    const link = await adam.service.link({ setupId: setup.setupId, kind: 'link' });
    const byLink = await dana.service.openLink({ text: link.url });
    await dana.service.accept({ ref: byLink.ref, walletId: 2, auth: RIGHT, label: 'Dana' });
    const first = await adam.service.refreshSetup({ setupId: setup.setupId });
    expect(first.slots.map(s => s.status)).toEqual(['accepted', 'empty']);
    const firstKeys = first.slots[0].accept!;

    const qr = await adam.service.link({ setupId: setup.setupId, kind: 'qr' });
    const byQr = await laptop.service.openLink({ text: qr.payload });
    const second = await laptop.service.accept({ ref: byQr.ref, walletId: 2, auth: RIGHT, label: 'Dana again' });
    expect(second.state).toBe('accepted');

    const after = await adam.service.refreshSetup({ setupId: setup.setupId });
    // In a 2-of-3 the wallet holds one slot, with the keys of its first answer.
    expect(after.slots.map(s => s.status)).toEqual(['accepted', 'empty']);
    expect(after.slots[0].accept).toEqual(firstKeys);
    expect(after.duplicates).toEqual([{ label: 'Dana again', via: 'qr' }]);
    expect(after.links.find(l => l.joinTokenHash === qr.joinTokenHash)?.state).toBe('used');
    // Reading again does not count it twice.
    expect((await adam.service.refreshSetup({ setupId: setup.setupId })).duplicates).toHaveLength(1);
  });

  it('initiator: a join by link from someone invited by name fills their own slot', async () => {
    const adam = device('adam', [1]);
    const dana = device('dana', [2]);
    await dana.register();
    const setup = await startSetup(adam, 3, 2);
    await adam.service.invite({ setupId: setup.setupId, n: 1, stakeCredential: credentialOf('Dana'), label: 'Dana' });
    const link = await adam.service.link({ setupId: setup.setupId, kind: 'link' });
    const laptop = device('dana-laptop', [2]);
    const opened = await laptop.service.openLink({ text: link.url });
    await laptop.service.accept({ ref: opened.ref, walletId: 2, auth: RIGHT, label: 'Dana' });
    const after = await adam.service.refreshSetup({ setupId: setup.setupId });
    expect(after.slots.map(s => s.status)).toEqual(['empty', 'accepted']);

    // Her invitation by name is answered afterwards: a duplicate, not a second slot.
    const [mailbox] = (await dana.service.refreshInvites()).invites;
    await dana.service.accept({ ref: mailbox.ref, walletId: 2, auth: RIGHT, label: 'Dana' });
    const last = await adam.service.refreshSetup({ setupId: setup.setupId });
    expect(last.slots.map(s => s.status)).toEqual(['empty', 'accepted']);
    expect(last.duplicates).toEqual([{ label: 'Dana', via: 'invite' }]);
  });

  it('initiator: never gives its own wallet a cosigner slot', async () => {
    const adam = device('adam', [1]);
    const other = device('adam-laptop', [1]);
    const setup = await startSetup(adam, 3, 2);
    const link = await adam.service.link({ setupId: setup.setupId, kind: 'link' });
    const opened = await other.service.openLink({ text: link.url });
    expect(await codeOf(other.service.accept({ ref: opened.ref, walletId: 1, auth: RIGHT }))).toBe('ALREADY_JOINED');
  });

  it('cosigner: refuses to join a setup this wallet already joined', async () => {
    const adam = device('adam', [1]);
    const dana = device('dana', [2]);
    const setup = await startSetup(adam, 3, 2);
    const link = await adam.service.link({ setupId: setup.setupId, kind: 'link' });
    const byLink = await dana.service.openLink({ text: link.url });
    await dana.service.accept({ ref: byLink.ref, walletId: 2, auth: RIGHT, label: 'Dana' });

    const qr = await adam.service.link({ setupId: setup.setupId, kind: 'qr' });
    const byQr = await dana.service.openLink({ text: qr.payload });
    expect(await codeOf(dana.service.accept({ ref: byQr.ref, walletId: 2, auth: RIGHT, label: 'Dana' }))).toBe('ALREADY_JOINED');
    // Nothing was sent and no second index is held.
    expect(sync.setups.get(setup.setupId)!.responses).toHaveLength(1);
    expect((await dana.service.holds({ walletId: 2 })).held).toHaveLength(1);
    // The unused code can still be declined, and another wallet of the device may join.
    dana.wallets[4] = { ...dana.wallets[2], id: 4, name: 'Dana spare' };
    dana.backedUp.add(4);
    expect((await dana.service.accept({ ref: byQr.ref, walletId: 4, auth: RIGHT })).state).toBe('accepted');
  });
});

describe('known cosigners', () => {
  it('files a later invitation from a cosigner this device verified under "for you", not Requests', async () => {
    // Adam has no contacts. Dana joins his vault and he reads the number with her.
    const adam = device('adam', [1]);
    const dana = device('dana', [2]);
    await adam.register();
    await dana.register();
    const setup = await startSetup(adam);
    await adam.service.invite({ setupId: setup.setupId, n: 0, stakeCredential: credentialOf('Dana') });
    const [invite] = (await dana.service.refreshInvites()).invites;
    await dana.service.accept({ ref: invite.ref, walletId: 2, auth: RIGHT, label: 'Dana' });
    await adam.service.refreshSetup({ setupId: setup.setupId });

    // Before the number is read she is a stranger to this device.
    const early = (await dana.service.startSetup({ walletId: 2, auth: RIGHT, name: 'Trip fund', owners: 2, threshold: 2 })).setup;
    await dana.service.invite({ setupId: early.setupId, n: 0, stakeCredential: credentialOf('Adam') });
    expect((await adam.service.refreshInvites()).invites.find(i => i.setupId === early.setupId)?.known).toBe(false);

    await adam.service.markVerified({ setupId: setup.setupId, n: 0 });
    // The one already here moves out of Requests, and a later one never lands there.
    expect((await adam.service.refreshInvites()).invites.find(i => i.setupId === early.setupId)?.known).toBe(true);
    const later = (await dana.service.startSetup({ walletId: 2, auth: RIGHT, name: 'Rent', owners: 2, threshold: 2 })).setup;
    await dana.service.invite({ setupId: later.setupId, n: 0, stakeCredential: credentialOf('Adam') });
    expect((await adam.service.refreshInvites()).invites.find(i => i.setupId === later.setupId)?.known).toBe(true);
    expect(await adam.service.forPush('vault_invite', later.setupId)).toMatchObject({ kind: 'invite', known: true });

    // It outlives the setup record: the vault was saved and the setup is long gone.
    await adam.service.completeSetup({ setupId: setup.setupId, vaultId: 'ab'.repeat(32) });
    clock += 31 * 86_400_000 - 8 * 86_400_000;
    await adam.records.removeSetup(setup.setupId);
    expect((await adam.service.refreshInvites()).invites.find(i => i.setupId === later.setupId)?.known).toBe(true);
  });

  it('keeps an accepted but unverified cosigner, and a stranger, under Requests', async () => {
    const adam = device('adam', [1]);
    const dana = device('dana', [2]);
    const yuval = device('yuval', [3]);
    await adam.register();
    await dana.register();
    const setup = await startSetup(adam);
    await adam.service.invite({ setupId: setup.setupId, n: 0, stakeCredential: credentialOf('Dana') });
    const [invite] = (await dana.service.refreshInvites()).invites;
    await dana.service.accept({ ref: invite.ref, walletId: 2, auth: RIGHT });
    await adam.service.refreshSetup({ setupId: setup.setupId });
    for (const [d, id, name] of [[dana, 2, 'Dana'], [yuval, 3, 'Yuval']] as const) {
      const s = (await d.service.startSetup({ walletId: id, auth: RIGHT, name: `${name} vault`, owners: 2, threshold: 2 })).setup;
      await d.service.invite({ setupId: s.setupId, n: 0, stakeCredential: credentialOf('Adam') });
    }
    const { invites } = await adam.service.refreshInvites();
    expect(invites).toHaveLength(2);
    expect(invites.every(i => i.known === false)).toBe(true);
  });
});

describe('B3: a rate limit is not "offline"', () => {
  /** A transport that answers 429 with Retry-After while `limited` is set, as the notify client throws it. */
  function limiter() {
    const state = { limited: false, retryAfterMs: 120_000 as number | undefined, sent: 0 };
    const wrap = (inner: InviteTransport): InviteTransport => ({
      send: async <T>(method: string, path: string, body?: unknown): Promise<T> => {
        state.sent++;
        if (state.limited && method === 'GET') {
          throw Object.assign(new Error('rate limited'), { name: 'NotifyError', status: 429, code: 'rate_limited', ...(state.retryAfterMs !== undefined ? { retryAfterMs: state.retryAfterMs } : {}) });
        }
        return inner.send<T>(method as never, path, body);
      },
    });
    return { state, wrap };
  }

  it('reads the answers as RATE_LIMITED with the wait, and does not ask gero-sync again until it is over', async () => {
    const { state, wrap } = limiter();
    const adam = device('adam', [1], { wrap });
    const dana = device('dana', [2]);
    await dana.register();
    const setup = await startSetup(adam);
    await adam.service.invite({ setupId: setup.setupId, n: 0, stakeCredential: credentialOf('Dana') });

    state.limited = true;
    const refresh = () => adam.service.refreshSetup({ setupId: setup.setupId });
    await expect(refresh()).rejects.toMatchObject({ code: 'RATE_LIMITED', details: { retryAfterMs: 120_000 } });
    const sent = state.sent;
    // Polls during the wait cost nothing, and say how long is left.
    clock += 30_000;
    await expect(refresh()).rejects.toMatchObject({ code: 'RATE_LIMITED', details: { retryAfterMs: 90_000 } });
    clock += 60_000;
    await expect(refresh()).rejects.toMatchObject({ code: 'RATE_LIMITED', details: { retryAfterMs: 30_000 } });
    expect(state.sent).toBe(sent);

    // Once Retry-After has passed the next read goes out again.
    state.limited = false;
    clock += 30_000;
    expect((await refresh()).slots[0].status).toBe('waiting');
    expect(state.sent).toBe(sent + 1);
  });

  it('the mailbox says it is busy and still shows the invitations this device holds', async () => {
    const { state, wrap } = limiter();
    const adam = device('adam', [1]);
    const dana = device('dana', [2], { wrap });
    await dana.register();
    const setup = await startSetup(adam);
    await adam.service.invite({ setupId: setup.setupId, n: 0, stakeCredential: credentialOf('Dana') });
    expect((await dana.service.refreshInvites()).busy).toBeUndefined();

    state.limited = true;
    const answer = await dana.service.refreshInvites();
    expect(answer.busy).toEqual({ retryAfterMs: 120_000 });
    expect(answer.invites).toHaveLength(1);
  });

  it('backs off further when gero-sync names no wait and keeps answering 429', async () => {
    const { state, wrap } = limiter();
    const dana = device('dana', [2], { wrap });
    await dana.register();
    state.limited = true;
    state.retryAfterMs = undefined;
    expect((await dana.service.refreshInvites()).busy).toEqual({ retryAfterMs: 60_000 });
    clock += 60_000;
    expect((await dana.service.refreshInvites()).busy).toEqual({ retryAfterMs: 120_000 });
    clock += 120_000;
    expect((await dana.service.refreshInvites()).busy).toEqual({ retryAfterMs: 240_000 });
  });
});

describe('harness', () => {
  it('derives the same vault keys as the service does', async () => {
    const adam = device('adam', [1]);
    const setup = await startSetup(adam);
    expect(setup.ownPayment).toBe((await material(1, 1)).payment);
    expect(NETWORK).toBe('cardano-preprod');
  });
});
