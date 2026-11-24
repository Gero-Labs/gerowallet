import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Blockchain, Network } from '@/models/types';

const { mockSetWalletConfiguration } = vi.hoisted(() => ({
  mockSetWalletConfiguration: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/db/wallet-db', () => ({
  setWalletConfiguration: mockSetWalletConfiguration,
  addConnectedDapp: vi.fn(),
  removeDapp: vi.fn(),
}));

import { walletStore } from '@/stores/walletStore';
import { useExplorer } from '@/shared/composables/useExplorer';

const TX = '7ecfdae7a4a2b8ea1bd2b4cb6b3d1b4ec5e9e5e3c5f4b0c7f6c3e9d2a1b0c9d8';

function logIn(chain: string, network: string, config: Record<string, unknown> = {}) {
  walletStore.loggedWallet = { id: 7, chain, network } as typeof walletStore.loggedWallet;
  walletStore.config = config;
}

beforeEach(() => {
  mockSetWalletConfiguration.mockClear();
});

describe('useExplorer', () => {
  it('links with the logged wallet\'s chain, network and saved explorer', () => {
    logIn(Blockchain.CARDANO, Network.PREPROD, { explorer: 'adastat' });
    const { explorerUrl, explorerId } = useExplorer();
    expect(explorerId.value).toBe('adastat');
    expect(explorerUrl('tx', TX)).toBe(`https://preprod.adastat.net/transactions/${TX}`);
  });

  it('defaults to Cexplorer when the wallet has no saved choice', () => {
    logIn(Blockchain.CARDANO, Network.MAINNET);
    expect(useExplorer().explorerUrl('tx', TX)).toBe(`https://cexplorer.io/tx/${TX}`);
  });

  it('lets a Cardano-only flow override the wallet chain', () => {
    logIn(Blockchain.BITCOIN, Network.MAINNET);
    const { explorerUrl, explorerOptions } = useExplorer();
    expect(explorerOptions.value).toEqual([]);
    expect(explorerUrl('tx', TX)).toBe(`https://mempool.space/tx/${TX}`);
    expect(explorerUrl('tx', TX, { chain: Blockchain.CARDANO })).toBe(`https://cexplorer.io/tx/${TX}`);
  });

  it('lets a flow override the network too (a Midnight Preview wallet registers DUST on Cardano preview)', () => {
    logIn(Blockchain.MIDNIGHT, Network.PREVIEW);
    const { explorerUrl } = useExplorer();
    // Preview names a Cardano network too, so the chain alone lands on its twin.
    expect(explorerUrl('tx', TX, { chain: Blockchain.CARDANO })).toBe(`https://preview.cexplorer.io/tx/${TX}`);
    expect(explorerUrl('tx', TX, { chain: Blockchain.CARDANO, network: Network.PREPROD }))
      .toBe(`https://preprod.cexplorer.io/tx/${TX}`);
  });

  it('returns nothing for a missing id', () => {
    logIn(Blockchain.CARDANO, Network.MAINNET);
    expect(useExplorer().explorerUrl('tx', undefined)).toBe('');
  });

  it('saves a choice to the wallet config and picks it up reactively', async () => {
    logIn(Blockchain.CARDANO, Network.PREVIEW);
    const { explorerId, explorerUrl, setExplorer } = useExplorer();
    expect(explorerId.value).toBe('cexplorer');

    await setExplorer('cardanoscan');

    expect(mockSetWalletConfiguration).toHaveBeenCalledWith(7, 'explorer', 'cardanoscan');
    expect(explorerId.value).toBe('cardanoscan');
    expect(explorerUrl('tx', TX)).toBe(`https://preview.cardanoscan.io/transaction/${TX}`);
  });

  it('refuses an explorer the wallet is not offered', async () => {
    logIn(Blockchain.CARDANO, Network.MAINNET);
    await useExplorer().setExplorer('etherscan');
    logIn(Blockchain.BITCOIN, Network.MAINNET);
    await useExplorer().setExplorer('cardanoscan');
    expect(mockSetWalletConfiguration).not.toHaveBeenCalled();
  });
});
