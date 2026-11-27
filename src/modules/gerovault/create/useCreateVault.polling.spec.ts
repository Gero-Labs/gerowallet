// The Cosigners screen and gero-sync's read limit (120 an hour): the poll is a slow fallback that
// stops when the page is left (keep-alive) or hidden, a `vault_response` push refreshes at once,
// and a 429 is "busy, retrying in N s", not a problem and not an empty screen.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeepAlive, defineComponent, effectScope, h, nextTick, ref, type EffectScope } from 'vue';
import { mount } from '@vue/test-utils';
import { InviteClientError, type SetupViewModel } from '@/modules/gerovault/invites/inviteClient';
import type { VaultPushEvent } from '@/modules/gerovault/invites/useVaultPush';
import type { VaultStore } from '@/modules/gerovault/contracts';
import { DEFAULT_POLL_MS, FAST_POLL_WINDOW_MS, useCreateVault, type CreateInviteDeps, type CreateVaultFlow } from './useCreateVault';

const SETUP = 'a1'.repeat(16);
const WALLET = 7;

function setupView(over: Partial<SetupViewModel> = {}): SetupViewModel {
  return {
    setupId: SETUP, walletId: WALLET, network: 'preprod', name: 'Ops petty cash', owners: 2, threshold: 2, ownIndex: 1, ownLabel: 'Adam',
    ownPayment: 'aa'.repeat(32), ownStake: 'bb'.repeat(32), createdAt: 0, expiresAt: 9e12, state: 'open', signerReady: true,
    slots: [{ n: 0, status: 'waiting', verified: false, label: 'Dana', invite: { inviteId: 'c3'.repeat(16), stakeCredential: '11'.repeat(28), sentAt: 0, expiresAt: 9e12 } }],
    links: [], refused: 0, ...over,
  };
}

function fakeDocument() {
  const listeners = new Set<() => void>();
  const doc = { hidden: false, addEventListener: (_: string, fn: () => void) => { listeners.add(fn); }, removeEventListener: (_: string, fn: () => void) => { listeners.delete(fn); } };
  return { doc: doc as unknown as Document, set: (hidden: boolean) => { doc.hidden = hidden; for (const fn of listeners) fn(); }, listeners };
}

function deps(extra: Partial<CreateInviteDeps> = {}, client: Partial<CreateInviteDeps['client']> = {}) {
  const refreshSetup = vi.fn(async () => setupView());
  const pushes: ((event: VaultPushEvent) => void)[] = [];
  const page = fakeDocument();
  const full = {
    status: vi.fn(async () => ({ inviteKey: 'ab'.repeat(32) })),
    getSetup: vi.fn(async () => setupView()),
    refreshSetup,
    remind: vi.fn(async () => setupView()),
    ...client,
  } as unknown as CreateInviteDeps['client'];
  const invites: CreateInviteDeps = {
    client: full, auth: async password => ({ password }), untitledName: 'Shared vault', resumeSetupId: SETUP,
    push: onPush => { pushes.push(onPush); }, document: page.doc, ...extra,
  };
  const options = { store: {} as VaultStore, walletId: WALLET, network: 'preprod' as const, unlockAccountKey: async () => { throw new Error('unused'); }, invites };
  return { options, refreshSetup: full.refreshSetup as typeof refreshSetup, client: full, push: (event: VaultPushEvent) => pushes.forEach(fn => fn(event)), page };
}

const scopes: EffectScope[] = [];
/** A resumed setup on the Cosigners step, after its first read. */
async function started(d: ReturnType<typeof deps>): Promise<CreateVaultFlow> {
  const scope = effectScope();
  scopes.push(scope);
  const flow = scope.run(() => useCreateVault(d.options))!;
  await vi.advanceTimersByTimeAsync(0);
  expect(flow.step.value).toBe('cosigners');
  expect(d.refreshSetup).toHaveBeenCalledTimes(1);
  d.refreshSetup.mockClear();
  return flow;
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  for (const s of scopes.splice(0)) s.stop();
  vi.useRealTimers();
});

describe('the Cosigners screen poll', () => {
  it('is a slow fallback: an hour on the screen is 60 reads, not 450', async () => {
    const d = deps();
    await started(d);
    expect(DEFAULT_POLL_MS).toBeGreaterThanOrEqual(30_000);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(d.refreshSetup).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3_600_000 - 8_000);
    expect(d.refreshSetup.mock.calls.length).toBeLessThanOrEqual(60);
    expect(d.refreshSetup.mock.calls.length).toBeGreaterThanOrEqual(58);
  });

  it('a vault_response push for this setup refreshes at once; other pushes do not', async () => {
    const d = deps();
    const flow = await started(d);
    d.refreshSetup.mockResolvedValueOnce(setupView({ slots: [{ n: 0, status: 'accepted', verified: false, label: 'Dana' }] }));
    d.push({ t: 'vault_response', setupId: SETUP });
    await vi.advanceTimersByTimeAsync(0);
    expect(d.refreshSetup).toHaveBeenCalledTimes(1);
    expect(flow.setup.value?.slots[0].status).toBe('accepted');
    d.push({ t: 'vault_response', setupId: 'ff'.repeat(16) });
    d.push({ t: 'vault_invite', setupId: SETUP });
    await vi.advanceTimersByTimeAsync(0);
    expect(d.refreshSetup).toHaveBeenCalledTimes(1);
  });

  it('stops while the document is hidden and reads when it shows again', async () => {
    const d = deps();
    await started(d);
    d.page.set(true);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(d.refreshSetup).not.toHaveBeenCalled();
    d.page.set(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(d.refreshSetup).toHaveBeenCalledTimes(1);
  });

  it('stops for good when the flow is disposed', async () => {
    const d = deps();
    await started(d);
    scopes.splice(0).forEach(s => s.stop());
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(d.refreshSetup).not.toHaveBeenCalled();
    expect(d.page.listeners.size).toBe(0);
  });

  it('reads faster only for a short while after the QR opens, and an hour with it open stays under the limit', async () => {
    const d = deps();
    const flow = await started(d);
    flow.setFastPoll(true);
    await vi.advanceTimersByTimeAsync(FAST_POLL_WINDOW_MS);
    const fast = d.refreshSetup.mock.calls.length;
    expect(fast).toBeGreaterThanOrEqual(10);
    expect(fast).toBeLessThanOrEqual(12);
    await vi.advanceTimersByTimeAsync(3_600_000 - FAST_POLL_WINDOW_MS);
    expect(d.refreshSetup.mock.calls.length).toBeLessThanOrEqual(72);
    // Closing the dialog goes back to the slow poll at once.
    d.refreshSetup.mockClear();
    flow.setFastPoll(true);
    flow.setFastPoll(false);
    await vi.advanceTimersByTimeAsync(50_000);
    expect(d.refreshSetup).not.toHaveBeenCalled();
  });
});

describe('a 429 on the Cosigners screen', () => {
  it('shows busy with the wait, keeps the cards, raises no problem and asks nothing until it is over', async () => {
    const d = deps();
    const flow = await started(d);
    const before = flow.setup.value;
    d.refreshSetup.mockRejectedValue(new InviteClientError('RATE_LIMITED', { retryAfterMs: 300_000 }));
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS);
    expect(d.refreshSetup).toHaveBeenCalledTimes(1);
    expect(flow.busyUntil.value).toBe(Date.now() + 300_000);
    expect(flow.inviteProblem.value).toBeNull();
    expect(flow.setup.value).toBe(before);

    // Neither the poll, a push nor a click reaches the worker during the wait.
    d.push({ t: 'vault_response', setupId: SETUP });
    void flow.refreshSetup();
    await vi.advanceTimersByTimeAsync(299_000);
    expect(d.refreshSetup).toHaveBeenCalledTimes(1);

    d.refreshSetup.mockReset();
    d.refreshSetup.mockResolvedValue(setupView());
    await vi.advanceTimersByTimeAsync(1_000);
    expect(d.refreshSetup).toHaveBeenCalledTimes(1);
    expect(flow.busyUntil.value).toBeNull();
  });

  it('still shows another failure as a problem, and stays quiet offline', async () => {
    const d = deps();
    const flow = await started(d);
    d.refreshSetup.mockRejectedValueOnce(new InviteClientError('NETWORK'));
    await flow.refreshSetup();
    expect(flow.inviteProblem.value).toBeNull();
    expect(flow.busyUntil.value).toBeNull();
    d.refreshSetup.mockRejectedValueOnce(new InviteClientError('BROKEN_SERVER'));
    await flow.refreshSetup();
    expect(flow.inviteProblem.value).toMatchObject({ code: 'BROKEN_SERVER' });
  });
});

describe('Remind', () => {
  it('says the reminder was sent, and only when it was', async () => {
    const d = deps();
    const flow = await started(d);
    expect(await flow.remindCosigner(0)).toBe(true);
    expect(flow.reminded.value).toMatchObject({ n: 0 });
    (d.client.remind as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new InviteClientError('RATE_LIMITED', { retryAfterMs: 1000 }));
    expect(await flow.remindCosigner(0)).toBe(false);
    expect(flow.reminded.value).toBeNull();
    expect(flow.inviteProblem.value).toMatchObject({ code: 'RATE_LIMITED', n: 0 });
  });
});

describe('inside keep-alive', () => {
  it('stops polling when the page is left and starts again when it is come back to', async () => {
    const d = deps();
    const Page = defineComponent({
      name: 'CreatePage',
      setup() {
        useCreateVault(d.options);
        return () => h('div', 'create');
      },
    });
    const Other = defineComponent({ name: 'OtherPage', render: () => h('div', 'other') });
    const onCreate = ref(true);
    const Host = defineComponent({ setup: () => () => h(KeepAlive, null, { default: () => h(onCreate.value ? Page : Other) }) });
    const w = mount(Host);
    await vi.advanceTimersByTimeAsync(0);
    d.refreshSetup.mockClear();

    onCreate.value = false;
    await nextTick();
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(d.refreshSetup).not.toHaveBeenCalled();

    onCreate.value = true;
    await nextTick();
    await vi.advanceTimersByTimeAsync(0);
    expect(d.refreshSetup).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(DEFAULT_POLL_MS);
    expect(d.refreshSetup).toHaveBeenCalledTimes(2);

    w.unmount();
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(d.refreshSetup).toHaveBeenCalledTimes(2);
  });
});
