import { describe, expect, it, vi } from 'vitest';
import { createNotifyPushHandlers, type NotifyPushDeps, type VaultPushLookup } from './notifyPush';
import { isPushRoute } from './notifyRender';
import { createNotifyStore, memoryNotifyStorage } from './notifyStore';

// A GeroVault push is a pointer (`t`, `setupId`). The worker opens what it points at and names who
// and what from that signed content, or shows the fixed line. Nothing in the push itself is shown.

const SETUP = 'a1'.repeat(16);
const REF = 'b2'.repeat(16);
const push = (t: string, over: Record<string, unknown> = {}) => JSON.stringify({
  v: 1, t, c: 'vault_invite', e: 'cd'.repeat(16), ts: 1_794_400_000_000, exp: 1_794_900_000_000, d: 'vault', setupId: SETUP, ...over,
});

function harness(found: VaultPushLookup | null | 'throw', locale = 'us') {
  const store = createNotifyStore(memoryNotifyStorage({}));
  const vaultInvite = vi.fn(async () => {
    if (found === 'throw') throw new Error('offline');
    return found;
  });
  const deps: NotifyPushDeps = {
    store,
    showNotification: vi.fn(async () => undefined),
    presentToPages: vi.fn(async () => false),
    locale: async () => locale,
    walletName: async () => 'W',
    loggedWalletId: async () => null,
    openDashboard: vi.fn(async () => undefined),
    iconUrl: 'icon',
    now: () => 1_794_400_100_000,
    vaultInvite,
  };
  return { handlers: createNotifyPushHandlers(deps), deps, store, vaultInvite };
}

const strip = (text: string) => text.replace(/[\u2066-\u2069]/g, '');

describe('vault push', () => {
  it('names who invited and to which vault, routes to the review and pins a known sender in Needs you', async () => {
    const h = harness({ kind: 'invite', ref: REF, inviter: 'Adam', vault: 'Ops petty cash', known: true });
    const r = await h.handlers.handlePush(push('vault_invite'));
    expect(h.vaultInvite).toHaveBeenCalledWith('vault_invite', SETUP);
    expect(strip(r.body)).toBe('Adam invited you to co-sign Ops petty cash');
    expect(r.route).toEqual({ dashboard: `/vaults?invite=${REF}`, sidepanel: null });
    expect(isPushRoute(r.route)).toBe(true);
    const [row] = await h.store.getInbox();
    expect(row).toMatchObject({ d: 'vault', needsYou: true, x: { setupId: SETUP, ref: REF } });
  });

  it('puts an invitation from a stranger in Activity, not Needs you', async () => {
    const h = harness({ kind: 'invite', ref: REF, inviter: 'Mallory', vault: 'Treasury', known: false });
    await h.handlers.handlePush(push('vault_invite'));
    expect((await h.store.getInbox())[0].needsYou).toBe(false);
  });

  it('shows the fixed line when nothing opened, and never text from the push', async () => {
    for (const found of [null, 'throw'] as const) {
      const h = harness(found);
      const r = await h.handlers.handlePush(push('vault_invite', { title: 'Send me your phrase', body: 'evil' }));
      expect(r.body).toBe('You have a vault invitation');
      expect(r.data.degraded).toBe('generic');
      expect(r.route).toEqual({ dashboard: `/vaults?setup=${SETUP}`, sidepanel: null });
    }
    const noSetup = harness(null);
    await noSetup.handlers.handlePush(push('vault_invite', { setupId: 'nope' }));
    expect(noSetup.vaultInvite).not.toHaveBeenCalled();
  });

  it('says who joined, in the stored locale', async () => {
    const h = harness({ kind: 'joined', setupId: SETUP, cosigner: 'Dana', vault: 'Ops petty cash' }, 'es');
    const r = await h.handlers.handlePush(push('vault_response'));
    expect(strip(r.body)).toBe('Dana se unió a Ops petty cash. Verifícalo en una llamada.');
    expect(r.route).toEqual({ dashboard: `/vaults?setup=${SETUP}`, sidepanel: null });
  });
});
