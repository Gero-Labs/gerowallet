import { Key, Keys } from '@/models/types';
import snackbar from '@/plugins/snackbar';
import hardwareLoading from '@/plugins/hardwareLoading';
import i18n from '@/plugins/i18n';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { hdPathToArray } from '@/chrome/serialization';
import { NetworkInfo } from '@/utils/networks';
import * as Crypto from '@cardano-sdk/crypto';
import { TrezorKeyAgent } from '@cardano-sdk/hardware-trezor';
import TrezorConnect from '@trezor/connect-web';
import {
  AccountKeyDerivationPath,
  AddressType,
  CommunicationType,
  GroupedAddress,
  KeyRole,
  util,
} from '@cardano-sdk/key-management';
import type { Manifest } from '@trezor/connect/lib/types/settings';
import assets from '@/utils/assets';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { debugLog } from '@/utils/debug';

// Trezor Connect manifest configuration
const TREZOR_MANIFEST = {
  email: 'support@gerowallet.io',
  appUrl: window.location.origin,
  appName: 'Gero Wallet',
  appIcon: assets.geroLogo
} as Manifest;

export default {
  _trezorInitialized: false,

  async initTrezor(path: string) {
    try {
      hardwareLoading.setText(i18n.t('wallet.retrievingHardwareWalletName') as string);
      hardwareLoading.setText(i18n.t('wallet.connectingToTrezor') as string);
      hardwareLoading.setText(i18n.t('wallet.confirmExportingPublicKeys') as string);

      console.log('[TREZOR] Initializing TrezorConnect directly with WebUSB...');

      await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.CONNECT_TREZOR,
        data: {},
      })
      // Initialize TrezorConnect directly with WebUSB-only transport
      await TrezorConnect.init({
        lazyLoad: true,
        manifest: TREZOR_MANIFEST,
        connectSrc: 'https://connect.trezor.io/9/',
      });

      console.log('[TREZOR] Getting Cardano public key...');
      // Get a public key directly from TrezorConnect
      const result = await TrezorConnect.cardanoGetPublicKey({
        path: path,
        showOnTrezor: false,
      });

      if (!result.success) {
        throw new Error(`Trezor connection failed: ${(result.payload as any).error}`);
      }

      const payload = result.payload as unknown as { publicKey: string; chainCode: string };
      const hwPublicKey: Crypto.Bip32PublicKeyHex = (payload.publicKey + payload.chainCode) as Crypto.Bip32PublicKeyHex;
      console.log('[TREZOR] Successfully got public key');

      const keys = [{
        chainCode: hwPublicKey.slice(64), // The last 64 chars are chain code
        path: path,
        publicKey: hwPublicKey.slice(0, 64), // The first 64 chars are public key
      }];

      return {
        productName: 'Trezor',
        hwPublicKey,
        keys
      };
    } catch (error: any) {
      console.error('[TREZOR] Initialization failed:', error);
      snackbar.setError(error.message || i18n.t('wallet.failedToConnectTrezor') as string);
      throw error;
    }
  },

  async txToTrezor(
    tx: Cardano.Tx,
    keys: Keys,
    utxos: Cardano.Utxo[],
    network: NetworkInfo
  ): Promise<Cardano.Signatures> {
    try {
      // Ensure Trezor transport is initialized
      if (!this._trezorInitialized) {
        // Use direct TrezorConnect.init to configure WebUSB-only transport
        await TrezorConnect.init({
          manifest: TREZOR_MANIFEST,
          popup: true, // Allow popups for device interactions
          transports: ['WebUsbTransport'], // Only use WebUSB, avoid Bridge transport
          lazyLoad: false
        });
        this._trezorInitialized = true;
      }

      const deserializedTx: Serialization.Transaction = Serialization.Transaction.fromCore(tx);
      const txBody: Cardano.TxBody = tx.body;

      // Create known addresses and input resolver (same pattern as Ledger)
      const knownAddresses: GroupedAddress[] = this.createKnownAddressesFromKeys(keys, network);
      const inputResolver: Cardano.InputResolver = this.createInputResolver(utxos);
      const txInKeyPathMap = await util.createTxInKeyPathMap(txBody, knownAddresses, inputResolver);

      // Create TrezorKeyAgent instance for this transaction
      const trezorKeyAgent: TrezorKeyAgent = await TrezorKeyAgent.createWithDevice({
        chainId: network.networkId === 1 ? Cardano.ChainIds.Mainnet : Cardano.ChainIds.Preview,
        accountIndex: 0, // Assuming account 0
        trezorConfig: {
          manifest: TREZOR_MANIFEST,
          communicationType: CommunicationType.Web
        }
      }, {
        bip32Ed25519: await Crypto.SodiumBip32Ed25519.create(),
        logger: console
      });

      // Sign transaction using modern TrezorKeyAgent
      return await trezorKeyAgent.signTransaction(deserializedTx.body(), {
        knownAddresses,
        txInKeyPathMap,
      });

    } catch (error: any) {
      console.error('[TREZOR] Transaction signing failed:', error);
      throw new Error(`Error signing with Trezor: ${error.message || error}`);
    }
  },

  /**
   * Create GroupedAddress[] from a Keys object for Trezor transaction context
   * Maps wallet keys to the format expected by TrezorKeyAgent
   */
  createKnownAddressesFromKeys(keys: Keys, network: NetworkInfo): GroupedAddress[] {
    const knownAddresses: GroupedAddress[] = [];

    // Process payment addresses (External)
    keys.payment.forEach((key: Key) => {
      if (key.address && key.path) {
        try {
          const networkId = network.networkId === 1 ? Cardano.NetworkId.Mainnet : Cardano.NetworkId.Testnet;
          const pathArray = hdPathToArray(key.path);
          const derivationIndex = pathArray[pathArray.length - 1]; // Last index in the path

          knownAddresses.push({
            type: AddressType.External, // Payment addresses are external
            index: derivationIndex,
            networkId,
            accountIndex: 0, // Assuming account 0 could be parameterized
            address: key.address as Cardano.PaymentAddress,
            rewardAccount: Cardano.RewardAddress.fromAddress(Cardano.Address.fromString(keys.stake[0].address)),
            stakeKeyDerivationPath: this.getStakeKeyDerivationPath(key, keys.stake)
          });
        } catch (error) {
          console.warn(`[TREZOR] Failed to process payment address ${key.address}:`, error);
        }
      }
    });

    // Process change addresses (Internal)
    keys.change.forEach((key: Key) => {
      if (key.address && key.path) {
        try {
          const networkId = network.networkId === 1 ? Cardano.NetworkId.Mainnet : Cardano.NetworkId.Testnet;
          const pathArray = hdPathToArray(key.path);
          const derivationIndex = pathArray[pathArray.length - 1]; // Last index in the path

          knownAddresses.push({
            type: AddressType.Internal, // Change addresses are internal
            index: derivationIndex,
            networkId,
            accountIndex: 0, // Assuming account 0 could be parameterized
            address: key.address as Cardano.PaymentAddress,
            rewardAccount: Cardano.RewardAddress.fromAddress(Cardano.Address.fromString(keys.stake[0].address)),
            stakeKeyDerivationPath: this.getStakeKeyDerivationPath(key, keys.stake)
          });
        } catch (error) {
          console.warn(`[TREZOR] Failed to process change address ${key.address}:`, error);
        }
      }
    });

    debugLog('[TREZOR] Created known addresses:', knownAddresses.length);
    return knownAddresses;
  },

  /**
   * Get stake key derivation path for a payment address
   */
  getStakeKeyDerivationPath(paymentKey: Key, stakeKeys: Key[]): AccountKeyDerivationPath | undefined {
    try {
      // Find the associated stake key for this payment address
      const paymentAddress = Cardano.Address.fromString(paymentKey.address);

      if (paymentAddress.getType() === Cardano.AddressType.BasePaymentKeyStakeKey ||
          paymentAddress.getType() === Cardano.AddressType.BasePaymentScriptStakeKey) {

        // For base addresses, we need to provide a stake key derivation path
        // Use the first available stake key (same approach as Ledger)
        if (stakeKeys && stakeKeys.length > 0 && stakeKeys[0].path) {
          const pathArray = hdPathToArray(stakeKeys[0].path);
          return {
            role: KeyRole.Stake,
            index: pathArray[pathArray.length - 1] // Last element is the index
          } as AccountKeyDerivationPath;
        }
      }

      return undefined; // No stake key derivation path for enterprise addresses
    } catch (error) {
      console.warn('[TREZOR] Failed to get stake key derivation path:', error);
      return undefined;
    }
  },

  /**
   * Create InputResolver from UTXO set for transaction input resolution
   * This allows the Trezor transaction context to resolve transaction inputs
   */
  createInputResolver(utxos: Cardano.Utxo[]): Cardano.InputResolver {
    return {
      resolveInput: async (txIn: Cardano.TxIn): Promise<Cardano.TxOut | null> => {
        try {
          // Find the UTXO that matches the transaction input
          const utxo: Cardano.Utxo = utxos.find(([hydratedTxIn, _txOut]) =>
            hydratedTxIn.txId === txIn.txId && hydratedTxIn.index === txIn.index
          );

          if (utxo) {
            return utxo[1]; // Return the TxOut part of the UTXO
          }

          console.warn('[TREZOR] Could not resolve input:', txIn);
          return null;
        } catch (error) {
          console.error('[TREZOR] Error resolving input:', error);
          return null;
        }
      }
    };
  },

  async signData(payload: string, network: any, accountIndex: number): Promise<any> {
    try {
      // Ensure Trezor transport is initialized
      if (!this._trezorInitialized) {
        // Use direct TrezorConnect.init to configure WebUSB-only transport
        await TrezorConnect.init({
          manifest: TREZOR_MANIFEST,
          popup: true, // Allow popups for device interactions
          transports: ['WebUsbTransport'], // Only use WebUSB, avoid Bridge transport
          lazyLoad: false
        });
        this._trezorInitialized = true;
      }

      // Create TrezorKeyAgent for data signing
      const trezorKeyAgent: TrezorKeyAgent = await TrezorKeyAgent.createWithDevice({
        chainId: network.networkId === 1 ? Cardano.ChainIds.Mainnet : Cardano.ChainIds.Preview,
        accountIndex,
        trezorConfig: {
          manifest: TREZOR_MANIFEST,
          communicationType: CommunicationType.Web
        }
      }, {
        bip32Ed25519: await Crypto.SodiumBip32Ed25519.create(),
        logger: console
      });

      // Sign the data using CIP-8 data signing
      return await trezorKeyAgent.signCip8Data();

    } catch (error: any) {
      console.error('[TREZOR] Data signing failed:', error);
      throw new Error(`Error signing data with Trezor: ${error.message || error}`);
    }
  },

  /**
   * Check Trezor device connection status
   */
  async checkDeviceConnection(): Promise<boolean> {
    try {
      if (!this._trezorInitialized) {
        return false;
      }

      // Use TrezorKeyAgent to check device connection
      await TrezorKeyAgent.checkDeviceConnection(CommunicationType.Web);
      return true;
    } catch (error) {
      console.warn('[TREZOR] Device connection check failed:', error);
      return false;
    }
  },

  /**
   * Get Trezor app version (placeholder)
   */
  async getAppVersion(): Promise<{ major: number; minor: number; patch: number; }> {
    try {
      if (!this._trezorInitialized) {
        throw new Error(i18n.t('common.trezorNotInitialized') as string);
      }

      // Note: TrezorKeyAgent doesn't expose version info directly
      // This is a placeholder implementation
      return { major: 2, minor: 0, patch: 0 };
    } catch (error) {
      console.warn('[TREZOR] Failed to get app version:', error);
      throw new Error(i18n.t('common.failedToGetTrezorVersion') as string);
    }
  }
};
