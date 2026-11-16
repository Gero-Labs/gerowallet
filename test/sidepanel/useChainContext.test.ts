import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Blockchain } from '@/models/types';

// Mock the walletStore module — it imports Chrome APIs not available in test env.
// Use vi.hoisted so the mock object is available inside the hoisted vi.mock factory.
interface MockLoggedWallet {
  chain: string;
  network?: string;
}
const { mockWalletStore } = vi.hoisted(() => ({
  mockWalletStore: { loggedWallet: null as MockLoggedWallet | null },
}));
vi.mock('@/stores/walletStore', () => ({
  walletStore: mockWalletStore,
}));

import { useChainContext } from '@/sidepanel/composables/useChainContext';

describe('useChainContext', () => {
  beforeEach(() => {
    mockWalletStore.loggedWallet = null;
  });

  it('matches no chain when no wallet is logged in', () => {
    const { isCardano, isBitcoin } = useChainContext();
    expect(isCardano.value).toBe(false);
    expect(isBitcoin.value).toBe(false);
  });

  it('returns isCardano=true for Cardano wallet', () => {
    mockWalletStore.loggedWallet = { chain: Blockchain.CARDANO };
    const { isCardano, isBitcoin } = useChainContext();
    expect(isCardano.value).toBe(true);
    expect(isBitcoin.value).toBe(false);
  });

  it('returns isBitcoin=true for Bitcoin wallet', () => {
    mockWalletStore.loggedWallet = { chain: Blockchain.BITCOIN };
    const { isBitcoin, isCardano } = useChainContext();
    expect(isBitcoin.value).toBe(true);
    expect(isCardano.value).toBe(false);
  });

  // themeColors.primary maps to chainAccents[chain].accent (see src/config/themes.ts).
  // These assert the current accent-system palette, not the pre-migration hexes.
  it('returns the Cardano theme palette when Cardano wallet is active', () => {
    mockWalletStore.loggedWallet = { chain: Blockchain.CARDANO };
    const { themeColors } = useChainContext();
    expect(themeColors.value.primary).toBe('#33C7DD');
  });

  it('exposes networkInfo from networks.ts for the active wallet', () => {
    mockWalletStore.loggedWallet = { chain: Blockchain.CARDANO, network: 'Mainnet' };
    const { networkInfo } = useChainContext();
    expect(networkInfo.value).toBeTruthy();
    expect(networkInfo.value?.currencyTicker).toBe('ADA');
    expect(networkInfo.value?.buySupport).toBe(true);
    expect(networkInfo.value?.stakingSupport).toBe(true);
    expect(networkInfo.value?.geroCardSupport).toBe(true);
  });
});
