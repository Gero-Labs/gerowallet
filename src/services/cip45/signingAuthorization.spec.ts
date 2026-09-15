import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Cip45AuthorizationRegistry } from './authorization';

const send = vi.fn();
vi.mock('@/chrome/messaging', () => ({ Messaging: {
  sendToBackgroundFromOptions: (...args: unknown[]) => send(...args),
} }));
vi.mock('@/stores/walletStore', () => ({ walletStore: {
  loggedWallet: { id: 'A', chain: 'Cardano', network: 'Mainnet' }, isLocked: false,
} }));

import { validateCip45Signing } from './signingAuthorization';
import { walletStore } from '@/stores/walletStore';
const context = { walletId: 'A', chain: 'Cardano', network: 'Mainnet' };

describe('CIP-45 approval validation', () => {
  beforeEach(() => {
    send.mockReset();
    walletStore.isLocked = false;
    Object.assign(walletStore.loggedWallet, { id: 'A', chain: 'Cardano', network: 'Mainnet' });
  });

  it('leaves non-CIP-45 signing requests unchanged', async () => {
    await validateCip45Signing({});
    expect(send).not.toHaveBeenCalled();
  });

  it('accepts a live grant but refuses it after switching away and back during approval', async () => {
    const registry = new Cip45AuthorizationRegistry();
    registry.setWallet(context);
    const authorization = registry.begin('dashboard', context, 'peer');
    registry.activate('dashboard', authorization);
    send.mockImplementation(async ({ data }) => {
      try { registry.assert(data.authorization); return { data: { success: true } }; }
      catch { return { data: { success: false } }; }
    });
    const payload = { cip45Authorization: authorization };
    await expect(validateCip45Signing(payload)).resolves.toBeUndefined();
    registry.setWallet(null);
    registry.setWallet(context);
    await expect(validateCip45Signing(payload)).rejects.toThrow('expired');
  });

  it('rejects a wallet switch while validation itself is in flight', async () => {
    let finish!: (result: object) => void;
    send.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const result = validateCip45Signing({ cip45Authorization: { ...context, sessionId: 'session', dappPeerId: 'peer' } });
    Object.assign(walletStore.loggedWallet, { id: 'B' });
    finish({ data: { success: true } });
    await expect(result).rejects.toThrow('expired');
  });
});
