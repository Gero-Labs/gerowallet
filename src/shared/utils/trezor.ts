import { Key, Keys } from '@/models/types';
import snackbar from '@/plugins/snackbar';
import hardwareLoading from '@/plugins/hardwareLoading';
import i18n from '@/plugins/i18n';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { hdPathToArray, toStakeAddress } from '@/chrome/serialization';
import { NetworkInfo } from '@/utils/networks';
import { HexBlob } from '@cardano-sdk/util';
import * as Crypto from '@cardano-sdk/crypto';
import { TrezorKeyAgent } from '@cardano-sdk/hardware-trezor';
import {
  AccountKeyDerivationPath,
  AddressType,
  CommunicationType,
  GroupedAddress,
  KeyRole,
  KeyPurpose,
  util,
  cip8,
} from '@cardano-sdk/key-management';
import { debugLog } from '@/utils/debug';
import { bech32 } from 'bech32';
import { MessageTypes } from '@/models/MessageTypes';
import { Messaging } from '@/chrome/messaging';

// Trezor Connect manifest configuration
const TREZOR_MANIFEST = {
  email: 'support@gerowallet.io',
  appUrl: window.location.origin,
};

export default {
  _trezorInitialized: false,

  async initTrezor(path: string) {
    try {
      hardwareLoading.setText(i18n.t('wallet.retrievingHardwareWalletName') as string);
      hardwareLoading.setText(i18n.t('wallet.connectingToTrezor') as string);
      hardwareLoading.setText(i18n.t('wallet.confirmExportingPublicKeys') as string);

      console.log('[TREZOR] Initializing Trezor transport...');

      await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.CONNECT_TREZOR,
        data: {},
      })

      console.log('[TREZOR] Getting Cardano public key...');

      // Extract account index from path (e.g., "m/1852'/1815'/0'" -> 0)
      const pathParts = path.split('/');
      const accountIndex = parseInt(pathParts[3].replace("'", ""));

      // Get extended public key using TrezorKeyAgent (exactly like Lace)
      const hwPublicKeyHex: Crypto.Bip32PublicKeyHex = await TrezorKeyAgent.getXpub({
        accountIndex,
        communicationType: CommunicationType.Web,
        purpose: KeyPurpose.STANDARD,
      });
      console.log('[TREZOR] Got Cardano public key (hex):', hwPublicKeyHex);

      // Convert hex public key to Bech32 format (xpub1...) - same pattern as Ledger
      const bip32PublicKey: Crypto.Bip32PublicKey = Crypto.Bip32PublicKey.fromHex(hwPublicKeyHex);
      const words = bech32.toWords(bip32PublicKey.bytes());
      const hwPublicKey = bech32.encode('xpub', words, 1023);
      console.log('[TREZOR] Converted to Bech32 format:', hwPublicKey);

      const keys = [{
        chainCode: hwPublicKeyHex.slice(64), // The last 64 chars are chain code
        path: path,
        publicKey: hwPublicKeyHex.slice(0, 64), // The first 64 chars are public key
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
    network: NetworkInfo,
    originalTxCbor?: string
  ): Promise<Cardano.Signatures> {
    try {
      // Ensure Trezor transport is initialized
      if (!this._trezorInitialized) {
        await TrezorKeyAgent.initializeTrezorTransport({
          manifest: TREZOR_MANIFEST,
          communicationType: CommunicationType.Web
        });
        this._trezorInitialized = true;
      }

      // Use original CBOR if provided (for multisig) to preserve exact byte representation
      // This is critical for multisig transactions where another party has already signed the original bytes
      const deserializedTx: Serialization.Transaction = originalTxCbor
        ? Serialization.Transaction.fromCbor(Serialization.TxCBOR(originalTxCbor))
        : Serialization.Transaction.fromCore(tx);
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
      this.trezorErrorHandling(error);
      throw error;
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
            rewardAccount: toStakeAddress(key.address, networkId) as Cardano.RewardAccount,
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
            rewardAccount: toStakeAddress(key.address, networkId) as Cardano.RewardAccount,
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

  async signData(
    address: string,
    payload: string,
    network: any,
    accountIndex: number,
    knownAddresses?: GroupedAddress[]
  ): Promise<{signatureHex: string; signingPublicKeyHex: string; addressFieldHex: string}> {
    try {
      // Ensure Trezor transport is initialized
      if (!this._trezorInitialized) {
        await TrezorKeyAgent.initializeTrezorTransport({
          manifest: TREZOR_MANIFEST,
          communicationType: CommunicationType.Web
        });
        this._trezorInitialized = true;
      }

      // Create TrezorKeyAgent for CIP-8/CIP-30 signing
      const chainId = network.networkId === 1 ? Cardano.ChainIds.Mainnet : Cardano.ChainIds.Preprod;
      const trezorKeyAgent: TrezorKeyAgent = await TrezorKeyAgent.createWithDevice({
        chainId,
        accountIndex,
        trezorConfig: {
          manifest: TREZOR_MANIFEST,
          communicationType: CommunicationType.Web
        }
      }, {
        bip32Ed25519: await Crypto.SodiumBip32Ed25519.create(),
        logger: console
      });

      // Convert address from hex to bech32 if needed
      let cardanoAddress: Cardano.Address;
      let addressBech32: string;

      if (address.startsWith('addr') || address.startsWith('stake')) {
        // Already in bech32 format
        cardanoAddress = Cardano.Address.fromString(address);
        addressBech32 = address;
      } else {
        // Hex format - convert to Address object and then to bech32
        const addressBytes = Buffer.from(address, 'hex');
        cardanoAddress = Cardano.Address.fromBytes(addressBytes);
        addressBech32 = cardanoAddress.toBech32();
      }

      // Determine if signing with a payment address or reward account
      const isRewardAccount = cardanoAddress.getType() === Cardano.AddressType.RewardKey ||
                              cardanoAddress.getType() === Cardano.AddressType.RewardScript;

      const signWith = isRewardAccount
        ? (addressBech32 as Cardano.RewardAccount)
        : (addressBech32 as Cardano.PaymentAddress);

      // Use SDK's cip30signData function with TrezorKeyAgent
      // Note: TrezorKeyAgent.signCip8Data() is not implemented in v0.7.30,
      // so we use cip8.cip30signData() directly (same pattern as walletBg.ts for software wallets)
      const signature = await cip8.cip30signData(trezorKeyAgent as any, {
        knownAddresses: knownAddresses || [],
        signWith,
        payload: payload as HexBlob
      });

      // Convert to the expected response format
      // addressFieldHex must be hex bytes for COSE structure
      return {
        signatureHex: signature.signature,
        signingPublicKeyHex: signature.key,
        addressFieldHex: Buffer.from(Cardano.Address.fromBech32(addressBech32).toBytes()).toString('hex')
      };
    } catch (error: any) {
      console.error('[TREZOR] Data signing failed:', error);
      this.trezorErrorHandling(error);
      throw error;
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
  },

  /**
   * Handle Trezor-specific errors and show user-friendly messages
   * Similar pattern to Ledger error handling
   */
  trezorErrorHandling(e: any) {
    // Trezor Connect popup/permission errors
    if (e?.message?.includes('Popup closed') || e?.message?.includes('popup failure')) {
      snackbar.setError(i18n.t('wallet.trezorPopupClosed') as string);
    } else if (e?.message?.includes('Permissions not granted')) {
      snackbar.setError(i18n.t('wallet.trezorPermissionDenied') as string);
    } else if (e?.message?.includes('device not found') || e?.message?.includes('Device disconnected')) {
      snackbar.setError(i18n.t('wallet.trezorNoDevice') as string);
    }
    // Trezor device/firmware errors
    else if (e?.message?.includes('Action cancelled by user')) {
      snackbar.setError(i18n.t('wallet.trezorTransactionRejected') as string);
    } else if (e?.message?.includes('Initialize') || e?.message?.includes('acquire session')) {
      snackbar.setError(i18n.t('wallet.trezorConnectionError') as string);
    } else if (e?.message?.includes('Cardano not supported')) {
      snackbar.setError(i18n.t('wallet.trezorCardanoNotSupported') as string);
    } else if (e?.message?.includes('outdated firmware') || e?.message?.includes('Firmware')) {
      snackbar.setError(i18n.t('wallet.trezorFirmwareOutdated') as string);
    }
    // Network/communication errors
    else if (e?.message?.includes('NetworkError') || e?.message?.includes('Failed to fetch')) {
      snackbar.setError(i18n.t('wallet.trezorNetworkError') as string);
    } else if (e?.message?.includes('timeout') || e?.message?.includes('Timeout')) {
      snackbar.setError(i18n.t('wallet.trezorTimeout') as string);
    }
    // Generic error with details for debugging
    else {
      console.error('Error with Trezor:', e);
      const errorMessage = e instanceof Error ? e.message : i18n.t('wallet.trezorSigningFailed') as string;
      snackbar.setError(`${errorMessage}. ${i18n.t('common.pleaseTryAgain')}`);
    }
  }
};
