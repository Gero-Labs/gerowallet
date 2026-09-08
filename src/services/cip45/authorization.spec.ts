import { beforeEach, describe, expect, it } from 'vitest';
import { Cip45AuthorizationRegistry } from './authorization';
import { EXTENSION_PAGE_ONLY_METHODS } from '@/chrome/senderTrust';

const walletA = { walletId: 'A', chain: 'Cardano', network: 'Mainnet' };
let registry: Cip45AuthorizationRegistry;
beforeEach(() => {
  registry = new Cip45AuthorizationRegistry();
  registry.setWallet(walletA);
});

describe('background CIP-45 authorization', () => {
  it('requires activation and the actual owning dashboard document', () => {
    const grant = registry.begin('dashboard', walletA, 'peer');
    expect(() => registry.assert(grant, 'dashboard')).toThrow();
    expect(() => registry.activate('another-tab', grant)).toThrow();
    registry.activate('dashboard', grant);
    expect(() => registry.assert(grant, 'dashboard')).not.toThrow();
    expect(() => registry.assert(grant, 'another-tab')).toThrow();
    expect(() => registry.assert(undefined)).toThrow();
    expect(() => registry.assert({ ...grant, dappPeerId: 'another-peer' })).toThrow();
    expect(() => registry.assert({ ...grant, network: 'Preprod' })).toThrow();
  });

  it.each([
    { ...walletA, walletId: 'B' },
    { ...walletA, network: 'Preprod' },
    { ...walletA, chain: 'Apex Prime' },
    null, // Logout or lock.
  ])('permanently revokes pending and active grants on a context change: %j', context => {
    const active = registry.begin('dashboard-1', walletA, 'peer');
    const pending = registry.begin('dashboard-2', walletA, 'peer');
    registry.activate('dashboard-1', active);
    registry.setWallet(context);
    registry.setWallet(walletA);
    expect(() => registry.assert(active)).toThrow();
    expect(() => registry.activate('dashboard-2', pending)).toThrow();
  });

  it('rejects pairing for a wallet other than the authoritative current wallet', () => {
    expect(() => registry.begin('dashboard', { ...walletA, walletId: 'B' }, 'peer')).toThrow();
  });

  it('preserves a valid grant across updates of the same wallet', () => {
    const grant = registry.begin('dashboard', walletA, 'peer');
    registry.activate('dashboard', grant);
    registry.setWallet({ ...walletA });
    expect(() => registry.assert(grant)).not.toThrow();
  });

  it('an old callback cannot activate or revoke a replacement grant', () => {
    const oldGrant = registry.begin('dashboard', walletA, 'peer');
    const replacement = registry.begin('dashboard', walletA, 'peer');
    expect(() => registry.activate('dashboard', oldGrant)).toThrow();
    registry.revoke('dashboard', oldGrant);
    registry.activate('dashboard', replacement);
    registry.revoke('another-tab', replacement);
    expect(() => registry.assert(replacement)).not.toThrow();
    registry.revoke('dashboard', replacement);
    expect(() => registry.assert(replacement)).toThrow();
  });

  it('restricts every authorization message and RPC to extension pages', () => {
    for (const method of ['CIP45_BEGIN_SESSION', 'CIP45_UPDATE_SESSION', 'CIP45_END_SESSION', 'CIP45_VALIDATE_SESSION', 'CIP45_INVOKE']) {
      expect(EXTENSION_PAGE_ONLY_METHODS.has(method)).toBe(true);
    }
  });
});
