/* eslint-disable @typescript-eslint/no-explicit-any -- page-world provider shim: implements external untyped interfaces (CIP-30 enable, Sats Connect / Wallet Standard PSBT providers, WBIP-004 registry) against window globals */
import {
  enable,
  getAccountPub,
  getAddress,
  getBalance,
  getCollateral,
  getNetworkId,
  getPubDRepKey,
  getRegisteredPubStakeKeys,
  getRewardAddresses,
  getUnregisteredPubStakeKeys, getUnusedAddresses,
  getUsedAddresses,
  getUtxos,
  isEnabled,
  signData,
  signTx,
  submitTx,
  getNetworkMagic
} from './webpage';
import {
  btcRequestAccounts,
  btcGetAccounts,
  btcGetPublicKey,
  btcGetNetwork,
  btcGetBalance,
  btcSignPsbt,
  btcSignPsbts,
  btcSignMessage,
  btcPushTx,
  btcPushPsbt,
} from './webpage';
import { Cardano, CollateralParams, Extensions, Paginate } from '@/models/types';
import { Cardano as CardanoCore } from '@cardano-sdk/core';
import { GERO_CARDANO_ICON } from './injectIcon';
// Installs window.midnight[uuid] as a side effect of import (see file).
import './injectMidnight';

declare global {
  interface Window {
    cardano: Cardano;
    gero_btc: any;
  }
}

// Bitcoin dApp surface hard-gated off for 2.7 (HIDE+GATE). When false, Gero
// does not advertise window.gero_btc, the Wallet-Standard wallet, or
// window.btc_providers to web pages. Background BITCOIN_METHOD.* handlers
// already reject on non-Bitcoin wallets; this stops capability leakage.
const BITCOIN_DAPP_ENABLED = false;

// CIP-30
window.cardano = {
  ...(window.cardano||{}),
  gerowallet: {
    async enable(extensions: Extensions): Promise<any> {
      const enabled = await enable();
      if (enabled) {
        const cip30 = {
          getCollateral: (params?: CollateralParams) => getCollateral(params),
          getBalance: () => getBalance(),
          getChangeAddress: () => getAddress(),
          getExtensions: () => [{ cip: 30 },{ cip: 95 }, { cip: 104 }],
          getNetworkId: () => getNetworkId(),
          getRewardAddresses: () => getRewardAddresses(),
          getUnusedAddresses: () => getUnusedAddresses(),
          getUsedAddresses: (paginate?: Paginate) => getUsedAddresses(paginate),
          getUtxos: (amount?: string, paginate?: Paginate) => getUtxos(amount, paginate),
          signData: (address: CardanoCore.PaymentAddress | CardanoCore.RewardAccount | string, payload: string) => signData(address, payload),
          signTx: (tx: string, partialSign: boolean) => signTx(tx, partialSign),
          submitTx: (tx: string) => submitTx(tx),
        }
        if (extensions?.extensions?.find(e => e.cip == 95)) {
          cip30['cip95'] = {
            getPubDRepKey: () => getPubDRepKey(),
            getRegisteredPubStakeKeys: () => getRegisteredPubStakeKeys(),
            getUnregisteredPubStakeKeys: () => getUnregisteredPubStakeKeys(),
            signTx: (tx: string, partialSign: boolean) => signTx(tx, partialSign),
            signData: (address: CardanoCore.PaymentAddress | CardanoCore.RewardAccount | string, payload: string) => signData(address, payload),
          }
        }
        if (extensions?.extensions?.find(e => e.cip == 104)) {
          cip30['cip104'] = {
            getAccountPub: () => getAccountPub()
          }
        }
        if (extensions?.extensions?.find(e => e.cip == 142)) {
          cip30['cip142'] = {
            getNetworkMagic: () => getNetworkMagic()
          }
        }
        return cip30
      }
      return null;
    },
    async isEnabled(): Promise<boolean> {
      return isEnabled()
    },
    apiVersion: '2.0.0',
    name: 'GeroWallet',
    supportedExtensions: [
      { cip: 30 },
      { cip: 95 },
      { cip: 104 },
      { cip: 142 }
    ],
    icon: GERO_CARDANO_ICON,
  },
};

// ====== Bitcoin Event System ======
const _btcEventListeners: Record<string, Set<Function>> = {};

function _btcEmit(event: string, data: any) {
  _btcEventListeners[event]?.forEach(cb => { try { cb(data); } catch {} });
}

// ====== Tomo Connect Provider (window.gero_btc) ======
// Detected by GeroBTCWallet class in @tomo-inc/tomo-wallet-provider.
// This makes Gero visible in Babylon staking dashboard and all Tomo-powered dApps.
// Interface: TomoBitcoinInjected from @tomo-inc/tomo-wallet-provider
if (BITCOIN_DAPP_ENABLED) {
  window.gero_btc = {
    requestAccounts: () => btcRequestAccounts(),
    getAccounts: () => btcGetAccounts(),
    getPublicKey: () => btcGetPublicKey(),
    signPsbt: (psbtHex: string, options?: any) => btcSignPsbt(psbtHex, options),
    signPsbts: (psbtsHexes: string[], options?: any) => btcSignPsbts(psbtsHexes, options),
    getNetwork: () => btcGetNetwork(),
    signMessage: (message: string, type?: 'ecdsa' | 'bip322-simple') => btcSignMessage(message, type),
    switchNetwork: async (_network: string) => { throw new Error('switchNetwork not supported'); },
    sendBitcoin: async (_to: string, _amount: number) => { throw new Error('Use signPsbt for sending'); },
    pushTx: (txHex: string) => btcPushTx({ rawtx: txHex }),
    getBalance: () => btcGetBalance().then((b: any) => typeof b === 'object' ? b.total : b),
    on: (event: string, cb: Function) => {
      if (!_btcEventListeners[event]) _btcEventListeners[event] = new Set();
      _btcEventListeners[event].add(cb);
    },
    off: (event: string, cb: Function) => {
      _btcEventListeners[event]?.delete(cb);
    },
  };
}

// Forward GeroWallet account/network change events (broadcast by the content
// script proxy when the background emits them) into Bitcoin provider listeners.
window.addEventListener('gerowalletaccountChange', (e: any) => {
  _btcEmit('accountsChanged', e.detail ?? []);
});
window.addEventListener('gerowalletnetworkChange', (e: any) => {
  _btcEmit('networkChanged', e.detail ?? 'mainnet');
});

// ====== Bitcoin Wallet Standard Registration ======
// Exposes GeroWallet via the Wallet Standard protocol so dapps using
// @wallet-standard/core (getWallets()) can discover and use this wallet.

function _wsHexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2)
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return bytes;
}

function _wsBytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

let _wsAccounts: any[] = [];
const _wsEventListeners = new Map<string, Set<Function>>();

function _wsDispatchChange(props: object) {
  _wsEventListeners.get('change')?.forEach(cb => cb(props));
}

async function _buildWsAccount(knownAddresses?: string[]): Promise<any | null> {
  const addresses = knownAddresses?.length ? knownAddresses : await btcGetAccounts();
  if (!addresses.length) return null;
  const pubKeyHex = await btcGetPublicKey();
  const network = await btcGetNetwork();
  const chain = network === 'testnet' ? 'bitcoin:testnet' : 'bitcoin:mainnet';
  return {
    address: addresses[0],
    publicKey: _wsHexToBytes(pubKeyHex),
    chains: [chain],
    features: [
      'bitcoin:connect',
      'bitcoin:disconnect',
      'bitcoin:signTransaction',
      'bitcoin:signAndSendTransaction',
      'bitcoin:signMessage',
      'bitcoin:events',
    ],
  };
}

const _geroWalletStandard: any = {
  version: '1.0.0',
  name: 'Gero',
  icon: (() => {
    // Reuse the same brand icon as window.cardano (CIP-30), converting from
    // URL-encoded format to base64 as required by the Wallet Standard spec.
    try {
      const svgStr = decodeURIComponent(GERO_CARDANO_ICON.slice('data:image/svg+xml,'.length));
      return ('data:image/svg+xml;base64,' + btoa(svgStr)) as `data:image/svg+xml;base64,${string}`;
    } catch {
      return 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI1MCIgZmlsbD0iIzFBNTZEQiIvPjx0ZXh0IHg9IjUwIiB5PSI2NyIgZm9udC1mYW1pbHk9IkFyaWFsLHNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iNTUiIGZvbnQtd2VpZ2h0PSJib2xkIiBmaWxsPSJ3aGl0ZSIgdGV4dC1hbmNob3I9Im1pZGRsZSI+RzwvdGV4dD48L3N2Zz4=' as `data:image/svg+xml;base64,${string}`;
    }
  })(),
  chains: ['bitcoin:mainnet', 'bitcoin:testnet'],
  get accounts() { return _wsAccounts; },
  features: {
    'bitcoin:connect': {
      version: '1.0.0',
      connect: async ({ purposes: _purposes }: { purposes: string[] }) => {
        try {
          console.log('[GeroWallet] bitcoin:connect called');
          const addresses = await btcRequestAccounts();
          console.log('[GeroWallet] btcRequestAccounts ->', addresses);
          if (!addresses?.length) {
            console.warn('[GeroWallet] No addresses returned from btcRequestAccounts');
            return { accounts: [] };
          }
          const pubKeyHex = await btcGetPublicKey();
          console.log('[GeroWallet] btcGetPublicKey ->', pubKeyHex?.slice(0, 16) + '...');
          const network = await btcGetNetwork();
          console.log('[GeroWallet] btcGetNetwork ->', network);
          const chain = network === 'testnet' ? 'bitcoin:testnet' : 'bitcoin:mainnet';
          const account = {
            address: addresses[0],
            publicKey: _wsHexToBytes(pubKeyHex),
            chains: [chain],
            features: [
              'bitcoin:connect', 'bitcoin:disconnect', 'bitcoin:signTransaction',
              'bitcoin:signAndSendTransaction', 'bitcoin:signMessage', 'bitcoin:events',
            ],
          };
          _wsAccounts = [account];
          _wsDispatchChange({ accounts: _wsAccounts });
          console.log('[GeroWallet] bitcoin:connect success ->', addresses[0]);
          return { accounts: _wsAccounts };
        } catch (err) {
          console.error('[GeroWallet] bitcoin:connect error:', err);
          throw err;
        }
      },
    },
    'bitcoin:disconnect': {
      version: '1.0.0',
      disconnect: async () => {
        _wsAccounts = [];
        _wsDispatchChange({ accounts: [] });
      },
    },
    'bitcoin:signTransaction': {
      version: '1.0.0',
      signTransaction: async (...inputs: any[]) => {
        const results: any[] = [];
        for (const input of inputs) {
          const psbtHex = _wsBytesToHex(input.psbt);
          const toSignInputs = input.inputsToSign?.map((i: any) => ({
            index: i.signingIndexes?.[0],
            address: i.account?.address,
            sighashTypes: i.sigHash ? [i.sigHash] : undefined,
          }));
          const signedHex = await btcSignPsbt(psbtHex, { autoFinalized: false, toSignInputs });
          results.push({ signedPsbt: _wsHexToBytes(signedHex) });
        }
        return results;
      },
    },
    'bitcoin:signAndSendTransaction': {
      version: '1.0.0',
      signAndSendTransaction: async (...inputs: any[]) => {
        const results: any[] = [];
        for (const input of inputs) {
          const psbtHex = _wsBytesToHex(input.psbt);
          const toSignInputs = input.inputsToSign?.map((i: any) => ({
            index: i.signingIndexes?.[0],
            address: i.account?.address,
            sighashTypes: i.sigHash ? [i.sigHash] : undefined,
          }));
          const signedHex = await btcSignPsbt(psbtHex, { autoFinalized: true, toSignInputs });
          const txId = await btcPushPsbt(signedHex);
          results.push({ txId });
        }
        return results;
      },
    },
    'bitcoin:signMessage': {
      version: '1.0.0',
      signMessage: async (...inputs: any[]) => {
        const results: any[] = [];
        for (const input of inputs) {
          const message = new TextDecoder().decode(input.message);
          const signatureHex = await btcSignMessage(message, 'ecdsa');
          results.push({
            signedMessage: input.message,
            signature: _wsHexToBytes(signatureHex),
          });
        }
        return results;
      },
    },
    'bitcoin:events': {
      version: '1.0.0',
      on: (event: string, listener: Function) => {
        if (!_wsEventListeners.has(event)) _wsEventListeners.set(event, new Set());
        _wsEventListeners.get(event)!.add(listener);
        return () => _wsEventListeners.get(event)?.delete(listener);
      },
    },
  },
};

// Register with the Wallet Standard registry
if (BITCOIN_DAPP_ENABLED) (function _registerGeroWalletStandard() {
  try {
    window.dispatchEvent(
      new CustomEvent('wallet-standard:register-wallet', {
        bubbles: false,
        cancelable: false,
        composed: false,
        detail: { register: (cb: Function) => cb(_geroWalletStandard) },
      })
    );
  } catch (e) {
    console.error('[Gero] wallet-standard:register-wallet', e);
  }
  // Handle apps that fire app-ready after the wallet script loads
  window.addEventListener('wallet-standard:app-ready', (e: any) => {
    try {
      e.detail.register(_geroWalletStandard);
    } catch (err) {
      console.error('[Gero] wallet-standard:app-ready', err);
    }
  });
})();

// ====== WBIP-004 / Sats Connect Provider Registration ======
// Injects Gero into window.btc_providers so dapps using Sats Connect
// (Xverse, Leather, etc.) can discover this wallet in their selector UI.
// See: https://wbips.netlify.app/wbips/WBIP004
if (BITCOIN_DAPP_ENABLED) (function _registerBtcProvider() {
  const provider = {
    id: 'GeroWallet',
    name: 'Gero Wallet',
    icon: _geroWalletStandard.icon,
    webUrl: 'https://gerowallet.io',
    chromeWebStoreUrl: 'https://chromewebstore.google.com/detail/gero-dashboard/iifeegfcfhlhhnilnggaopkpegobafdn',
    mozillaAddOnsUrl: null,
  };
  if (!Array.isArray((window as any).btc_providers)) {
    (window as any).btc_providers = [];
  }
  (window as any).btc_providers.push(provider);
})();

// ====== WalletConnect Deep Link Interception ======
// Handled by the content script (content.ts) in its isolated world with an
// isTrusted gesture check — a page-world postMessage bridge here would let any
// site script initiate a pairing without a user gesture (spoofed proposals).
