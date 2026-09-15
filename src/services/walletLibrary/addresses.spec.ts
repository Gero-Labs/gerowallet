import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Blockchain, WalletType } from '@/models/types';
import { walletSearchAddresses } from './addresses';
import { getAddress, getRewardAddress, toStakeAddress } from '@/chrome/serialization';
import { getReceiveAddress } from '@/chains/bitcoin/bitcoinKeyManager';

vi.mock('@/chrome/serialization', () => ({
  getAddress: vi.fn(() => ({ toBech32: () => 'addr1derived' })),
  getRewardAddress: vi.fn(() => ({ toBech32: () => 'stake1derived' })),
  toStakeAddress: vi.fn(() => 'stake1watch'),
}));
vi.mock('@/chains/bitcoin/bitcoinKeyManager', () => ({ getReceiveAddress: vi.fn(() => 'bc1derived') }));
vi.mock('@/utils/networks', () => ({ default: { resolveNetworkId: () => 1 } }));

const wallet = { id: 1, name: 'Treasury', chain: Blockchain.CARDANO, network: 'Mainnet', publicKey: 'public-xpub' };
beforeEach(() => vi.clearAllMocks());

describe('public wallet search addresses', () => {
  it('uses existing Cardano receive and reward address derivation with only the public key', async () => {
    expect(await walletSearchAddresses(wallet)).toEqual({ addresses: ['addr1derived'], stakeAddress: 'stake1derived' });
    expect(getAddress).toHaveBeenCalledWith('public-xpub', Blockchain.CARDANO, 'Mainnet');
    expect(getRewardAddress).toHaveBeenCalledWith('public-xpub', Blockchain.CARDANO, 'Mainnet');
  });
  it('derives the stake address for a watch-only wallet', async () => {
    expect(await walletSearchAddresses({ ...wallet, type: WalletType.Watch, publicKey: undefined, watchAddress: 'addr1watch' }))
      .toEqual({ addresses: ['addr1watch'], stakeAddress: 'stake1watch' });
    expect(toStakeAddress).toHaveBeenCalledWith('addr1watch', 1);
  });
  it('passes Bitcoin address type and network to the existing derivation', async () => {
    expect(await walletSearchAddresses({ ...wallet, chain: Blockchain.BITCOIN, addressType: 'taproot' }))
      .toEqual({ addresses: ['bc1derived'], stakeAddress: '' });
    expect(getReceiveAddress).toHaveBeenCalledWith('public-xpub', 'Mainnet', 'taproot');
    expect(getRewardAddress).not.toHaveBeenCalled();
  });
  it('indexes all Midnight public address forms and removes duplicates', async () => {
    expect(await walletSearchAddresses({ ...wallet, chain: Blockchain.MIDNIGHT, baseAddress: 'unshielded',
      publicKey: JSON.stringify({ shielded: 'shielded', unshielded: 'unshielded', dust: 'dust' }) }))
      .toEqual({ addresses: ['unshielded', 'shielded', 'dust'], stakeAddress: '' });
  });
  it('keeps stored addresses available when a legacy public key is malformed', async () => {
    expect(await walletSearchAddresses({ ...wallet, chain: Blockchain.MIDNIGHT, publicKey: 'invalid-json', baseAddress: 'stored' }))
      .toEqual({ addresses: ['stored'], stakeAddress: '' });
  });
});
