import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Blockchain, Network, WalletType } from '@/models/types';

vi.mock('@/stores/geroStore', async () => ({
  geroStore: (await import('vue')).reactive({ wallets: {} as Record<number, unknown> }),
}));

import { geroStore } from '@/stores/geroStore';
import { useAvailableWallets } from './useAvailableWallets';

const store = geroStore as unknown as { wallets: Record<number, unknown> };

const CARDANO = { id: 1, name: 'Main', chain: Blockchain.CARDANO, network: Network.MAINNET, type: WalletType.Normal };
// Left in gero-db by a chain the build has since dropped.
const RETIRED = { id: 9, name: 'Old', chain: 'Apex Fusion Prime', network: 'Mainnet', type: WalletType.Normal };

describe('useAvailableWallets', () => {
  beforeEach(() => { store.wallets = {}; });

  it('lists the wallets of the chains the build has', () => {
    store.wallets = { 1: CARDANO };
    const { availableWallets, hasWallets } = useAvailableWallets();
    expect(availableWallets.value.map((wallet) => wallet.id)).toEqual([1]);
    expect(hasWallets.value).toBe(true);
  });

  it('hides a stored wallet whose chain left the build', () => {
    store.wallets = { 1: CARDANO, 9: RETIRED };
    expect(useAvailableWallets().availableWallets.value.map((wallet) => wallet.id)).toEqual([1]);
  });

  it('counts no wallet when only hidden ones are stored, so first-run surfaces agree', () => {
    store.wallets = { 9: RETIRED };
    const { availableWallets, hasWallets } = useAvailableWallets();
    expect(availableWallets.value).toEqual([]);
    expect(hasWallets.value).toBe(false);
  });

  it('keeps a Google sign-in wallet and leaves the legacy Google kind to its own flow', () => {
    store.wallets = {
      2: { ...CARDANO, id: 2, type: WalletType.Google, encryptionMethod: 'mpc' },
      3: { ...CARDANO, id: 3, type: WalletType.Google },
    };
    expect(useAvailableWallets().availableWallets.value.map((wallet) => wallet.id)).toEqual([2]);
  });
});
