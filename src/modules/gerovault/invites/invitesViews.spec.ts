// The invitation screens through their controls: the number read in turns (Confirm only after
// four ticks, "Doesn't match" stops), the review sheet (backup gate, one approval to join,
// Decline, ended states) and the invitation card of the create screen.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { ref, shallowRef } from 'vue';
import { createTestVuetify } from '@test/helpers/vuetify';
import { mockGlobalProperties } from '@test/helpers/globalProperties';

vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key, tc: (key: string) => key }) }));
vi.mock('@/modules/navigation/dialogs/BackupWalletDialog.vue', () => ({ default: { template: '<div data-test="backup-dialog" />' } }));

import VerifyTogether from './VerifyTogether.vue';
import InviteReviewDialog from './InviteReviewDialog.vue';
import InviteCosigner from './InviteCosigner.vue';
import type { ReceivedView, SetupViewModel } from './inviteClient';

enableAutoUnmount(afterEach);

const $t = (key: string, values?: Record<string, unknown>): string => (values ? `${key} ${JSON.stringify(values)}` : key);
const global = () => ({ plugins: [createTestVuetify()], config: { globalProperties: mockGlobalProperties({ $t }) } });
const GROUPS = ['48213', '90577', '13064', '72859', '06431', '58920', '31746', '84105'];

describe('VerifyTogether', () => {
  it('lets the initiator read 1 to 4 and confirm only after ticking 5 to 8', async () => {
    const w = mount(VerifyTogether, { props: { groups: GROUPS, role: 'initiator', peer: 'Dana' }, global: global() });
    expect(w.text()).toContain('48213');
    const confirm = () => w.get('[data-test="create-number-yes"]');
    expect(confirm().attributes('disabled')).toBeDefined();
    for (const n of [5, 6, 7]) await w.get(`[data-test="verify-tick-${n}"]`).trigger('click');
    expect(confirm().attributes('disabled')).toBeDefined();
    await w.get('[data-test="verify-tick-8"]').trigger('click');
    expect(w.get('[data-test="verify-tick-8"]').attributes('aria-pressed')).toBe('true');
    await confirm().trigger('click');
    expect(w.emitted('confirm')).toHaveLength(1);
  });

  it('has the cosigner tick 1 to 4, and stops on a mismatch', async () => {
    const w = mount(VerifyTogether, { props: { groups: GROUPS, role: 'cosigner', peer: 'Adam', canCancel: true }, global: global() });
    expect(w.find('[data-test="verify-tick-1"]').exists()).toBe(true);
    expect(w.find('[data-test="verify-tick-5"]').exists()).toBe(false);
    await w.get('[data-test="verify-mismatch"]').trigger('click');
    expect(w.find('[data-test="verify-stop"]').exists()).toBe(true);
    expect(w.emitted('mismatch')).toHaveLength(1);
    await w.get('[data-test="verify-cancel-setup"]').trigger('click');
    expect(w.emitted('cancelSetup')).toHaveLength(1);
    await w.get('[data-test="verify-again"]').trigger('click');
    expect(w.get('[data-test="create-number-yes"]').attributes('disabled')).toBeDefined();
  });
});

function invite(over: Partial<ReceivedView> = {}): ReceivedView {
  return {
    ref: 'b2'.repeat(16), source: 'mailbox', setupId: 'a1'.repeat(16), network: 'preprod', state: 'open', known: true, receivedAt: 1, expiresAt: Date.now() + 5 * 86_400_000,
    revokedByInviter: false, digest: 'cd'.repeat(32), vault: { name: 'Treasury reserve', threshold: 3, owners: 5 },
    inviter: { label: 'Lena', credential: '11'.repeat(28), handle: '$lena', payment: '22'.repeat(32), stake: '33'.repeat(32) },
    participants: [{ label: 'Omar', status: 'accepted' }], wallets: [{ walletId: 7, name: 'Main wallet', addressed: true, backedUp: true }],
    ...over,
  };
}

function mountReview(view: ReceivedView, client: Record<string, unknown> = {}) {
  const c = {
    accept: vi.fn(async () => ({ ...view, state: 'accepted', join: { walletId: 7, ownIndex: 4, label: 'Me', payment: 'aa', stake: 'bb', acceptedAt: 1, verified: false } })),
    decline: vi.fn(async () => ({ ...view, state: 'declined' })),
    block: vi.fn(),
    getInvite: vi.fn(async () => view),
    holds: vi.fn(async () => ({ held: [], released: [] })),
    ...client,
  };
  const auth = vi.fn(async (password: string) => ({ password }));
  const w = mount(InviteReviewDialog, {
    props: { isOpen: true, invite: view, loggedWalletId: 7, keySource: 'password', client: c as never, auth, store: { list: async () => [] } },
    global: global(),
    attachTo: document.body,
  });
  return { w, c, auth };
}

describe('InviteReviewDialog', () => {
  it('leads with the cost and joins with one approval', async () => {
    const { c, auth } = mountReview(invite());
    await flushPromises();
    const text = document.body.textContent ?? '';
    expect(text).toContain('gerovault.invite.review.costFunds');
    expect(text).toContain('gerovault.invite.review.costTime');
    const join = document.querySelector('[data-test="invite-join"]') as HTMLButtonElement;
    expect(join.disabled).toBe(true);
    const password = document.querySelector('[data-test="invite-password"] input') as HTMLInputElement;
    password.value = 'secret';
    password.dispatchEvent(new Event('input'));
    await flushPromises();
    join.click();
    await flushPromises();
    expect(auth).toHaveBeenCalledWith('secret');
    expect(c.accept).toHaveBeenCalledWith({ ref: 'b2'.repeat(16), walletId: 7 }, { password: 'secret' });
  });

  it('holds Join behind the backup and opens the backup', async () => {
    mountReview(invite({ wallets: [{ walletId: 7, name: 'Main wallet', addressed: true, backedUp: false }] }));
    await flushPromises();
    expect(document.querySelector('[data-test="invite-backup-gate"]')).not.toBeNull();
    expect((document.querySelector('[data-test="invite-join"]') as HTMLButtonElement).disabled).toBe(true);
    (document.querySelector('[data-test="invite-backup-now"]') as HTMLButtonElement).click();
    await flushPromises();
    expect(document.querySelector('[data-test="backup-dialog"]')).not.toBeNull();
  });

  it('offers a switch or a new wallet instead of a dead end', async () => {
    mountReview(invite({ wallets: [] }));
    await flushPromises();
    expect(document.querySelector('[data-test="invite-no-wallet"]')).not.toBeNull();
  });

  it('declines, and says who revoked an invitation', async () => {
    const { c } = mountReview(invite());
    await flushPromises();
    (document.querySelector('[data-test="invite-decline"]') as HTMLButtonElement).click();
    await flushPromises();
    expect(c.decline).toHaveBeenCalledWith('b2'.repeat(16));
  });

  it('shows the ended state with no Join', async () => {
    mountReview(invite({ state: 'revoked', revokedByInviter: true, endedAt: 1 }));
    await flushPromises();
    expect(document.querySelector('[data-test="invite-ended"]')?.textContent).toContain('gerovault.invite.review.ended.revokedBy');
    expect(document.querySelector('[data-test="invite-join"]')).toBeNull();
  });
});

describe('InviteCosigner', () => {
  function flowWith(setup: SetupViewModel | null) {
    return {
      setup: shallowRef(setup),
      inviteProblem: shallowRef(null),
      inviteBusy: ref(null),
      inviteCosigner: vi.fn(async () => true),
      remindCosigner: vi.fn(),
      revokeCosigner: vi.fn(),
      makeLink: vi.fn(async () => ({ url: 'https://gerowallet.io/vault-invite#gvi1x', expiresAt: Date.now() + 1000 })),
      updateDraft: vi.fn(),
    };
  }
  const base = (slots: SetupViewModel['slots']): SetupViewModel => ({
    setupId: 'a1'.repeat(16), walletId: 1, network: 'preprod', name: 'Ops', owners: 2, threshold: 2, ownIndex: 1, ownLabel: 'Adam', ownPayment: 'aa', ownStake: 'bb',
    createdAt: 0, expiresAt: 9e12, state: 'open', signerReady: true, slots, links: [], refused: 0,
  });

  it('resolves a contact and sends the invitation to its stake credential', async () => {
    const flow = flowWith(base([{ n: 0, status: 'empty', verified: false }]));
    const resolve = vi.fn(async () => ({ ok: true as const, value: { stakeCredential: '44'.repeat(28), kind: 'address' as const, address: 'addr_test1xyz' } }));
    const w = mount(InviteCosigner, {
      props: { flow: flow as never, draft: { id: 1, mode: 'invite', source: 'gero', label: '', keys: '', index: '' }, n: 0, details: false, walletId: 1, contacts: [{ name: 'Yuval', address: 'addr_test1xyz' }], resolve, now: Date.now() },
      global: global(),
    });
    await w.get('[data-test="invite-entry"] input').setValue('Yu');
    await w.get('[data-test="invite-contact"]').trigger('click');
    await flushPromises();
    expect(resolve).toHaveBeenCalledWith(1, 'addr_test1xyz');
    await w.get('[data-test="invite-send"]').trigger('click');
    await flushPromises();
    expect(flow.inviteCosigner).toHaveBeenCalledWith(0, { stakeCredential: '44'.repeat(28), label: 'Yuval' });
  });

  it('shows Waiting with Remind and Revoke, and Accepted as Unverified', async () => {
    const now = Date.now();
    const waiting = mount(InviteCosigner, {
      props: { flow: flowWith(base([{ n: 0, status: 'waiting', verified: false, label: 'Yuval', invite: { inviteId: 'x', stakeCredential: '44'.repeat(28), sentAt: now, expiresAt: now + 7 * 86_400_000 } }])) as never, draft: { id: 1, mode: 'invite', source: 'gero', label: '', keys: '', index: '' }, n: 0, details: false, walletId: 1, contacts: [], resolve: vi.fn(), now },
      global: global(),
    });
    expect(waiting.text()).toContain('gerovault.invite.status.waiting');
    expect(waiting.text()).toContain('gerovault.invite.time.inDays');
    expect(waiting.find('[data-test="invite-remind"]').exists()).toBe(true);
    expect(waiting.find('[data-test="invite-revoke"]').exists()).toBe(true);

    const joined = mount(InviteCosigner, {
      props: { flow: flowWith(base([{ n: 0, status: 'accepted', verified: false, accept: { label: 'Dana', stakeCredential: '55'.repeat(28), payment: 'aa', stake: 'bb', via: 'qr', acceptedAt: now } }])) as never, draft: { id: 1, mode: 'invite', source: 'gero', label: '', keys: '', index: '' }, n: 0, details: false, walletId: 1, contacts: [], resolve: vi.fn(), now },
      global: global(),
    });
    expect(joined.text()).toContain('gerovault.invite.status.accepted');
    expect(joined.text()).toContain('gerovault.invite.status.unverified');
  });

  it('opens the external path from "They use another wallet"', async () => {
    const flow = flowWith(base([{ n: 0, status: 'empty', verified: false }]));
    const w = mount(InviteCosigner, {
      props: { flow: flow as never, draft: { id: 9, mode: 'invite', source: 'gero', label: '', keys: '', index: '' }, n: 0, details: false, walletId: 1, contacts: [], resolve: vi.fn(), now: Date.now() },
      global: global(),
    });
    await w.get('[data-test="create-source-external"]').trigger('click');
    expect(flow.updateDraft).toHaveBeenCalledWith(9, { mode: 'paste', source: 'external' });
  });
});
