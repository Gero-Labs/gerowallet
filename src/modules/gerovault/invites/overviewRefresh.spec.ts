// The Vaults overview under keep-alive: the invitation lists are read again when the page is come
// back to and when a vault push arrives, a 429 shows "busy, retrying in N s" with the lists this
// device holds (not an empty page, not "not reachable"), and a reminder says it was sent.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { KeepAlive, defineComponent, h, ref } from 'vue';
import { createTestVuetify } from '@test/helpers/vuetify';
import { mockGlobalProperties } from '@test/helpers/globalProperties';

const pushHandlers: (() => void)[] = [];
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key, tc: (key: string) => key }) }));
vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }), useRouter: () => ({ replace: async () => undefined }) }));
vi.mock('./useVaultPush', () => ({ useVaultPush: (onPush: () => void) => { pushHandlers.push(onPush); } }));

import VaultInvitationsPanel from './VaultInvitationsPanel.vue';
import SetupCard from './SetupCard.vue';
import { InviteClientError, type ReceivedView, type SetupViewModel } from './inviteClient';
import { busyMessage } from './messages';
import { useVaultInvitations } from './useVaultInvitations';

enableAutoUnmount(afterEach);
afterEach(() => { pushHandlers.length = 0; });

const $t = (key: string, values?: Record<string, unknown>): string => (values ? `${key} ${JSON.stringify(values)}` : key);
const global = () => ({ plugins: [createTestVuetify()], config: { globalProperties: mockGlobalProperties({ $t }) } });

const SETUP = 'a1'.repeat(16);
function setup(over: Partial<SetupViewModel> = {}): SetupViewModel {
  return {
    setupId: SETUP, walletId: 1, network: 'preprod', name: 'Ops', owners: 2, threshold: 2, ownIndex: 1, ownLabel: 'Adam', ownPayment: 'aa', ownStake: 'bb',
    createdAt: 0, expiresAt: 9e12, state: 'open', signerReady: false,
    slots: [{ n: 0, status: 'waiting', verified: false, label: 'Dana', invite: { inviteId: 'x', stakeCredential: '44'.repeat(28), sentAt: Date.now(), expiresAt: Date.now() + 86_400_000 } }],
    links: [], refused: 0, ...over,
  };
}
function invite(over: Partial<ReceivedView> = {}): ReceivedView {
  return {
    ref: 'b2'.repeat(16), source: 'mailbox', setupId: 'c3'.repeat(16), network: 'preprod', state: 'open', known: true, receivedAt: 1, expiresAt: Date.now() + 5 * 86_400_000,
    revokedByInviter: false, digest: 'cd'.repeat(32), vault: { name: 'Treasury reserve', threshold: 3, owners: 5 },
    inviter: { label: 'Lena', credential: '11'.repeat(28), payment: '22'.repeat(32), stake: '33'.repeat(32) },
    participants: [], wallets: [], ...over,
  };
}

function client(over: Record<string, unknown> = {}) {
  return {
    listSetups: vi.fn(async () => [setup()]),
    refreshSetup: vi.fn(async () => setup()),
    listInvites: vi.fn(async (): Promise<{ invites: ReceivedView[]; refused: number; busy?: { retryAfterMs: number } }> => ({ invites: [invite()], refused: 0 })),
    remind: vi.fn(async () => setup()),
    cancelSetup: vi.fn(), decline: vi.fn(), block: vi.fn(), openLink: vi.fn(), getInvite: vi.fn(),
    ...over,
  };
}

describe('useVaultInvitations and a rate limit', () => {
  it('a busy mailbox keeps the invitations this device holds and says when it reads again', async () => {
    const now = 1_000_000;
    const c = client({ listInvites: vi.fn(async () => ({ invites: [invite()], refused: 0, busy: { retryAfterMs: 90_000 } })) });
    const inv = useVaultInvitations({ client: c, walletId: () => 1, now: () => now });
    await inv.reload();
    expect(inv.state.value).toBe('ready');
    expect(inv.forYou.value).toHaveLength(1);
    expect(inv.busyUntil.value).toBe(now + 90_000);
    expect(inv.problem.value).toBeNull();
  });

  it('a rate-limited setup read keeps the setup card, is not a problem, and is not repeated during the wait', async () => {
    let now = 1_000_000;
    const c = client({ refreshSetup: vi.fn(async () => { throw new InviteClientError('RATE_LIMITED', { retryAfterMs: 120_000 }); }) });
    const inv = useVaultInvitations({ client: c, walletId: () => 1, now: () => now });
    await inv.reload();
    expect(inv.openSetups.value.map(s => s.setupId)).toEqual([SETUP]);
    expect(inv.busyUntil.value).toBe(now + 120_000);
    expect(inv.problem.value).toBeNull();

    now += 60_000;
    await inv.reload({ quiet: true });
    expect(c.refreshSetup).toHaveBeenCalledTimes(1);
    expect(inv.busyUntil.value).toBe(1_000_000 + 120_000);

    // Over: the next read goes out and the busy line goes.
    now += 61_000;
    c.refreshSetup.mockImplementation(async () => setup());
    await inv.reload({ quiet: true });
    expect(c.refreshSetup).toHaveBeenCalledTimes(2);
    expect(inv.busyUntil.value).toBeNull();
  });

  it('a quiet reload keeps the lists on screen, and two at once are one read', async () => {
    const c = client();
    const inv = useVaultInvitations({ client: c, walletId: () => 1 });
    await inv.reload();
    const states: string[] = [];
    const both = Promise.all([inv.reload({ quiet: true }), inv.reload({ quiet: true })]);
    states.push(inv.state.value);
    await both;
    expect(states).toEqual(['ready']);
    expect(c.listInvites).toHaveBeenCalledTimes(2);
  });

  it('says a reminder was sent, for that setup only, and not when it failed', async () => {
    const c = client();
    const inv = useVaultInvitations({ client: c, walletId: () => 1 });
    await inv.reload();
    expect(await inv.remind(SETUP, 0)).toBe(true);
    expect(inv.reminded.value).toEqual({ setupId: SETUP, n: 0 });
    c.remind.mockRejectedValueOnce(new InviteClientError('LOCKED'));
    expect(await inv.remind(SETUP, 0)).toBe(false);
    expect(inv.reminded.value).toBeNull();
    expect(inv.problem.value).toBe('LOCKED');
  });
});

describe('busyMessage', () => {
  it('counts seconds for a short wait and minutes for a long one', () => {
    expect(busyMessage(45_000, 0)).toEqual({ key: 'gerovault.invite.busy.seconds', n: 45 });
    expect(busyMessage(100, 0)).toEqual({ key: 'gerovault.invite.busy.seconds', n: 1 });
    expect(busyMessage(0, 5_000)).toEqual({ key: 'gerovault.invite.busy.seconds', n: 1 });
    expect(busyMessage(3_600_000, 0)).toEqual({ key: 'gerovault.invite.busy.minutes', n: 60 });
  });
});

describe('VaultInvitationsPanel inside keep-alive', () => {
  function host(c: ReturnType<typeof client>) {
    const onOverview = ref(true);
    const Other = defineComponent({ name: 'OtherPage', render: () => h('div', 'other') });
    const Host = defineComponent({
      setup: () => () => h(KeepAlive, null, {
        default: () => (onOverview.value
          ? h(VaultInvitationsPanel, { walletId: 1, keySource: 'password', client: c as never, auth: async () => ({}), unlockAccountKey: async () => { throw new Error('unused'); }, store: { list: async () => [] } as never })
          : h(Other)),
      }),
    });
    const w = mount(Host, { global: global() });
    return { w, onOverview };
  }

  it('reads the lists again when the page is come back to, without blanking them', async () => {
    const c = client();
    const { w, onOverview } = host(c);
    await flushPromises();
    expect(c.listInvites).toHaveBeenCalledTimes(1);
    expect(w.find(`[data-test="overview-invite-${'b2'.repeat(16)}"]`).exists()).toBe(true);

    onOverview.value = false;
    await flushPromises();
    // A second invitation arrived meanwhile.
    c.listInvites.mockResolvedValue({ invites: [invite(), invite({ ref: 'b3'.repeat(16) })], refused: 0 });
    onOverview.value = true;
    await flushPromises();
    expect(c.listInvites).toHaveBeenCalledTimes(2);
    expect(w.find(`[data-test="overview-invite-${'b3'.repeat(16)}"]`).exists()).toBe(true);
  });

  it('reads again when a vault push arrives while it is open, and not while another page is shown', async () => {
    const c = client();
    const { w, onOverview } = host(c);
    await flushPromises();
    expect(pushHandlers).toHaveLength(1);
    c.listInvites.mockResolvedValue({ invites: [invite(), invite({ ref: 'b4'.repeat(16) })], refused: 0 });
    pushHandlers[0]();
    await flushPromises();
    expect(c.listInvites).toHaveBeenCalledTimes(2);
    expect(w.find(`[data-test="overview-invite-${'b4'.repeat(16)}"]`).exists()).toBe(true);

    onOverview.value = false;
    await flushPromises();
    pushHandlers[0]();
    await flushPromises();
    expect(c.listInvites).toHaveBeenCalledTimes(2);
  });

  it('shows the busy line with the stored lists instead of an empty page', async () => {
    const c = client({ listInvites: vi.fn(async () => ({ invites: [invite()], refused: 0, busy: { retryAfterMs: 45_000 } })) });
    const { w } = host(c);
    await flushPromises();
    expect(w.get('[data-test="invite-busy"]').text()).toContain('gerovault.invite.busy.seconds');
    expect(w.find(`[data-test="overview-invite-${'b2'.repeat(16)}"]`).exists()).toBe(true);
    expect(w.find('[role="alert"]').exists()).toBe(false);
  });

  it('says the reminder was sent on the setup card', async () => {
    const c = client();
    const { w } = host(c);
    await flushPromises();
    expect(w.find('[data-test="overview-reminded"]').exists()).toBe(false);
    await w.get('[data-test="overview-remind"]').trigger('click');
    await flushPromises();
    expect(c.remind).toHaveBeenCalledWith(SETUP, 0);
    expect(w.get('[data-test="overview-reminded"]').text()).toContain('gerovault.invite.card.reminded');
  });
});

describe('SetupCard', () => {
  it('tells the initiator that someone answered twice', () => {
    const w = mount(SetupCard, { props: { setup: setup({ duplicates: [{ label: 'Dana', via: 'qr' }] }), now: Date.now() }, global: global() });
    expect(w.get('[data-test="overview-duplicate-join"]').text()).toContain('gerovault.invite.setup.duplicate');
    expect(mount(SetupCard, { props: { setup: setup(), now: Date.now() }, global: global() }).find('[data-test="overview-duplicate-join"]').exists()).toBe(false);
  });
});
