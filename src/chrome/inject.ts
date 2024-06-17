import {
  enable,
  getAddress,
  getBalance,
  getCollateral,
  getNetworkId,
  getRewardAddresses,
  getUtxos,
  isEnabled,
  signData,
  signTx,
  submitTx,
} from './webpage';
import { Cardano } from '@/models/types';

declare global {
  interface Window {
    cardano: Cardano;
  }
}

// CIP-30
window.cardano = {
  gero: {
    async enable(): Promise<any> {
      const enabled = await enable();
      if (enabled) {
        return {
          experimental: {
            getCollateral: () => getCollateral(),
          },
          getBalance: () => getBalance(),
          getChangeAddress: () => getAddress(),
          getNetworkId: () => getNetworkId(),
          getRewardAddresses: () => getRewardAddresses(),
          getUnusedAddresses: () => [],
          getUsedAddresses: () => getAddress(),
          getUtxos: (amount?: number, paginate?: boolean) => getUtxos(amount, paginate),
          signData: (address: string, payload: string) => signData(address, payload),
          signTx: (tx: string, partialSign: boolean) => signTx(tx, partialSign),
          submitTx: (tx: string) => submitTx(tx),
        };
      }
      return null;
    },
    async isEnabled(): Promise<boolean> {
      return isEnabled()
    },
    apiVersion: '2.0.0',
    name: 'GeroWallet',
    supportedExtensions: [
      { cip: 30 }
    ],
    icon: '',
  },
};
