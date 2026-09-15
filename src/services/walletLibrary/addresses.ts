import { Blockchain, WalletType } from '@/models/types';
import type { Wallet } from '@/models/types';
import type { WalletSearchAddresses } from './model';

// Reuse the public address derivation already used by WalletBg. No unlock,
// private-key access, network request, or per-keystroke derivation is needed.
export async function walletSearchAddresses(wallet: Wallet): Promise<WalletSearchAddresses> {
  const addresses = new Set<string>();
  for (const address of [wallet.baseAddress, wallet.watchAddress]) if (address) addresses.add(address);
  let stakeAddress = wallet.stakeAddress || '';
  try {
    if (wallet.chain === Blockchain.MIDNIGHT) {
      const data: unknown = JSON.parse(wallet.publicKey || '{}');
      if (data && typeof data === 'object') {
        for (const key of ['shielded', 'unshielded', 'dust']) {
          const value = (data as Record<string, unknown>)[key];
          if (typeof value === 'string' && value) addresses.add(value);
        }
      }
    } else if (wallet.chain === Blockchain.BITCOIN && wallet.publicKey) {
      const { getReceiveAddress } = await import('@/chains/bitcoin/bitcoinKeyManager');
      addresses.add(getReceiveAddress(wallet.publicKey, wallet.network, wallet.addressType || 'segwit'));
    } else if (wallet.type === WalletType.Watch && wallet.watchAddress) {
      const { toStakeAddress } = await import('@/chrome/serialization');
      const { default: networks } = await import('@/utils/networks');
      stakeAddress ||= toStakeAddress(wallet.watchAddress, networks.resolveNetworkId(wallet.chain, wallet.network));
    } else if (wallet.publicKey) {
      const { getAddress, getRewardAddress } = await import('@/chrome/serialization');
      addresses.add(getAddress(wallet.publicKey, wallet.chain, wallet.network).toBech32());
      stakeAddress ||= getRewardAddress(wallet.publicKey, wallet.chain, wallet.network).toBech32();
    }
  } catch {
    // A malformed or legacy record must remain selectable and searchable by name.
  }
  return { addresses: [...addresses], stakeAddress };
}
