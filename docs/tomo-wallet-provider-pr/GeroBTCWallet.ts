/**
 * Gero Wallet - Bitcoin Provider for Tomo Connect
 *
 * This file is intended to be submitted as a PR to:
 * https://github.com/tomo-inc/tomo-wallet-provider
 *
 * Place this file at: src/providers/btc/GeroBTCWallet.ts
 * Then register it in src/providers/btc/list.ts
 */

import { BTCProvider } from './BTCProvider';
import type { ProviderOption } from '../../WalletProvider';
import type { TomoWallet } from '../../types';

const GERO_BTC_PROVIDER_KEY = 'gero_btc';

export const geroWalletOption: TomoWallet = {
  id: 'bitcoin_gero',
  img: 'https://gerowallet.io/images/logo.svg',
  name: 'Gero',
  chainType: 'bitcoin',
  connectProvider: GeroBTCWallet,
  type: 'extension',
};

export class GeroBTCWallet extends BTCProvider {
  constructor(option: ProviderOption) {
    const w = option?.getWindow ? option.getWindow() : window;
    const provider = (w as any)[GERO_BTC_PROVIDER_KEY];
    if (!provider) {
      throw new Error('Gero Wallet extension not found');
    }
    super(option, provider);
  }

  async connectWallet(): Promise<this> {
    const accounts = await this.bitcoinNetworkProvider.requestAccounts();
    if (!accounts?.length) {
      throw new Error('Failed to connect to Gero Wallet');
    }
    return this;
  }

  async getWalletProviderName(): Promise<string> {
    return 'Gero Wallet';
  }

  async getWalletProviderIcon(): Promise<string> {
    return geroWalletOption.img;
  }
}
