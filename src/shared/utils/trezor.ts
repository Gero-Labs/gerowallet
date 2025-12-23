import { coin_type, Key, Keys, purpose } from '@/models/types';
import { Cardano } from '@cardano-sdk/core';
import * as Crypto from '@cardano-sdk/crypto';
import { hdPathToArray, toStakeAddress } from '@/chrome/serialization';
import { NetworkInfo } from '@/utils/networks';
import TrezorConnect from '@trezor/connect-webextension';
import * as Trezor from '@trezor/connect';
import {
  AccountKeyDerivationPath,
  AddressType,
  GroupedAddress,
  KeyRole,
} from '@cardano-sdk/key-management';
import { debugLog } from '@/utils/debug';
import { bech32 } from 'bech32';

/**
 * Trezor Connect Wrapper
 * Clean wrapper around @trezor/connect-webextension for Cardano operations
 * Works in Chrome extension service worker context
 */

// Trezor Connect manifest configuration
const TREZOR_MANIFEST = {
  appName: 'Gero Dashboard',
  appIcon: 'https://raw.githubusercontent.com/Gero-Labs/staking-pool/refs/heads/main/logo-64.png',
  appUrl: 'chrome-extension://bgpipimickeadkjlklgciifhnalhdjhe',
  email: 'support@gerowallet.io',
};

export default {
  _initialized: false,

  /**
   * Initialize TrezorConnect (lazy initialization)
   * Safe to call multiple times - only initializes once
   */
  async init(): Promise<void> {
    if (this._initialized) {
      debugLog('[TREZOR] Already initialized');
      return;
    }

    try {
      await TrezorConnect.init({
        manifest: TREZOR_MANIFEST,
        transports: ['BridgeTransport', 'WebUsbTransport'],
        connectSrc: 'https://connect.trezor.io/9/',
        _extendWebextensionLifetime: true,
      });
      this._initialized = true;
      debugLog('[TREZOR] Initialized successfully');
    } catch (error) {
      console.error('[TREZOR] Initialization failed:', error);
      throw error;
    }
  },

  /**
   * Get device features including device name/label
   */
  async getDeviceInfo(): Promise<Trezor.Features> {
    await this.init();

    const result = await TrezorConnect.getFeatures();
    if (!result.success) {
      throw new Error(result.payload.error || 'Failed to get device features');
    }

    return result.payload;
  },

  /**
   * Get extended public key for an account
   * Returns in Bech32 format (xpub1...) compatible with Gero Wallet
   */
  async getXpub(path: string): Promise<{
    productName: string;
    hwPublicKey: string;
    keys: Array<{ chainCode: string; path: string; publicKey: string }>;
  }> {
    await this.init();

    try {
      console.log('[TREZOR] Getting Cardano public key for path:', path);

      // Extract account index from path (e.g., "m/1852'/1815'/0'" -> 0)
      const pathParts = path.split('/');
      const accountIndex = parseInt(pathParts[3].replace("'", ""));

      // Get device name
      const deviceInfo: Trezor.Features = await this.getDeviceInfo();
      const deviceName = deviceInfo['label'] || 'Trezor';

      // Get public key from Trezor
      const res = await TrezorConnect.cardanoGetPublicKey({
        path: `m/${purpose.hdwallet}'/${coin_type.cardano}'/${accountIndex}'`,
        showOnTrezor: false, // Don't show on device during pairing
      } as Trezor.CardanoGetPublicKey);

      if (!res.success) {
        // Type guard: when success is false, payload contains error
        const errorMessage = 'error' in res.payload ? res.payload.error : 'Failed to get Trezor public key';
        throw new Error(errorMessage);
      }

      // TypeScript now knows res.payload is CardanoPublicKey
      const chainCode = res.payload.node.chain_code;
      const publicKey = res.payload.node.public_key;
      console.log('[TREZOR] Got Cardano public key:', res);
      const bip32PublicKeyHex = res.payload.publicKey;
      const bip32PublicKeyBytes = Buffer.from(bip32PublicKeyHex, 'hex');
      const words = bech32.toWords(bip32PublicKeyBytes);
      const hwPublicKey = bech32.encode('xpub', words, 1023);

      return {
        productName: deviceName,
        hwPublicKey,
        keys: [{
          chainCode,
          path,
          publicKey,
        }]
      };
    } catch (error: any) {
      console.error('[TREZOR] Failed to get public key:', error);
      throw error;
    }
  },

  /**
   * Sign a Cardano transaction
   * @param tx - Transaction to sign
   * @param keys - Known wallet keys for address derivation
   * @param utxos - UTXOs for input resolution
   * @param network - Network information
   * @returns Transaction signatures
   */
  async signTransaction(
    tx: Cardano.Tx,
    keys: Keys,
    utxos: Cardano.Utxo[],
    network: NetworkInfo
  ): Promise<Cardano.Signatures> {
    await this.init();

    try {
      console.log('[TREZOR] Preparing transaction for signing...', { tx, keys, network });

      // Import the transaction transformer from @cardano-sdk/hardware-trezor
      const { txToTrezor } = await import('@cardano-sdk/hardware-trezor/dist/esm/transformers/tx.js');
      const { TrezorKeyAgent } = await import('@cardano-sdk/hardware-trezor/dist/esm/TrezorKeyAgent.js');
      const { TxInId } = await import('@cardano-sdk/key-management');

      // Create known addresses from wallet keys
      const knownAddresses = this.createKnownAddressesFromKeys(keys, network);

      // Build transaction input key path map using TxInId
      const txInKeyPathMap: Record<string, AccountKeyDerivationPath> = {};
      for (const input of tx.body.inputs) {
        // Find matching UTXO
        const utxo = utxos.find(([txIn]) =>
          txIn.txId === input.txId && txIn.index === input.index
        );

        if (utxo) {
          const [, txOut] = utxo;
          // Find matching key for this address
          const matchingKey = [...keys.payment, ...keys.change].find(
            key => key.address === txOut.address
          );

          if (matchingKey?.path) {
            const pathArray = hdPathToArray(matchingKey.path);
            const derivationIndex = pathArray[pathArray.length - 1];

            // Determine role based on whether it's a payment or change key
            const role = keys.payment.includes(matchingKey)
              ? KeyRole.External
              : KeyRole.Internal;

            // Use TxInId to create proper key
            const inputKey = TxInId(input);
            txInKeyPathMap[inputKey] = {
              role,
              index: derivationIndex
            } as AccountKeyDerivationPath;
          }
        }
      }

      // Assume account index 0 (most common case)
      const accountIndex = 0;
      const chainId = network.networkId === 1
        ? Cardano.ChainIds.Mainnet
        : Cardano.ChainIds.Preprod;

      // Determine output formats
      const outputsFormat = tx.body.outputs.map(() =>
        Trezor.PROTO.CardanoTxOutputSerializationFormat.MAP_BABBAGE
      );

      const collateralReturnFormat = tx.body.collateralReturn
        ? Trezor.PROTO.CardanoTxOutputSerializationFormat.MAP_BABBAGE
        : undefined;

      // Convert transaction to Trezor format
      const trezorTxData = await txToTrezor(tx.body, {
        accountIndex,
        chainId,
        knownAddresses,
        txInKeyPathMap,
        outputsFormat,
        collateralReturnFormat,
        tagCborSets: false, // Use default CBOR encoding
      });

      // Determine signing mode
      const signingMode = TrezorKeyAgent.matchSigningMode(trezorTxData);

      console.log('[TREZOR] Signing transaction with mode:', signingMode);

      // Sign with Trezor
      const result = await TrezorConnect.cardanoSignTransaction({
        ...trezorTxData,
        signingMode,
      });

      if (!result.success) {
        const errorMessage = 'error' in result.payload ? result.payload.error : 'Failed to sign transaction';
        throw new Error(errorMessage);
      }

      console.log('[TREZOR] Transaction signed successfully');

      // Convert witnesses to Cardano.Signatures format
      const signatures = new Map<Crypto.Ed25519PublicKeyHex, Crypto.Ed25519SignatureHex>();

      for (const witness of result.payload.witnesses) {
        signatures.set(
          Crypto.Ed25519PublicKeyHex(witness.pubKey),
          Crypto.Ed25519SignatureHex(witness.signature)
        );
      }

      return signatures;

    } catch (error: any) {
      console.error('[TREZOR] Transaction signing failed:', error);
      throw error;
    }
  },

  /**
   * Sign arbitrary data (CIP-8 / CIP-30)
   * @param address - Address to sign with
   * @param payload - Data to sign (hex)
   * @param network - Network information
   * @param accountIndex - Account index
   */
  async signData(
    address: string,
    payload: string,
    network: NetworkInfo,
    accountIndex: number
  ): Promise<{
    signatureHex: string;
    signingPublicKeyHex: string;
    addressFieldHex: string;
  }> {
    await this.init();

    try {
      console.log('[TREZOR] Preparing data signing...', { address, payload, accountIndex });

      // Construct derivation path for the address
      // For payment addresses, use m/1852'/1815'/0'/0/0 pattern
      const derivationPath = `m/${purpose.hdwallet}'/${coin_type.cardano}'/${accountIndex}'/0/0`;

      // Sign the message with Trezor
      const result = await TrezorConnect.cardanoSignMessage({
        path: derivationPath,
        message: payload,
        networkId: network.networkId,
        preferHexDisplay: true,
      });

      if (!result.success) {
        const errorMessage = 'error' in result.payload ? result.payload.error : 'Failed to sign data';
        throw new Error(errorMessage);
      }

      console.log('[TREZOR] Data signed successfully');

      // Convert response to expected format
      return {
        signatureHex: result.payload.signature,
        signingPublicKeyHex: result.payload.key,
        addressFieldHex: Buffer.from(address, 'utf-8').toString('hex'),
      };

    } catch (error: any) {
      console.error('[TREZOR] Data signing failed:', error);
      throw error;
    }
  },

  /**
   * Create GroupedAddress[] from wallet Keys
   * Maps wallet keys to the format expected by Cardano SDK utilities
   */
  createKnownAddressesFromKeys(keys: Keys, network: NetworkInfo): GroupedAddress[] {
    const knownAddresses: GroupedAddress[] = [];
    const networkId = network.networkId === 1 ? Cardano.NetworkId.Mainnet : Cardano.NetworkId.Testnet;

    // Process payment addresses (External)
    keys.payment.forEach((key: Key) => {
      if (key.address && key.path) {
        try {
          const pathArray = hdPathToArray(key.path);
          const derivationIndex = pathArray[pathArray.length - 1];

          knownAddresses.push({
            type: AddressType.External,
            index: derivationIndex,
            networkId,
            accountIndex: 0,
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
          const pathArray = hdPathToArray(key.path);
          const derivationIndex = pathArray[pathArray.length - 1];

          knownAddresses.push({
            type: AddressType.Internal,
            index: derivationIndex,
            networkId,
            accountIndex: 0,
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
      const paymentAddress = Cardano.Address.fromString(paymentKey.address);

      if (paymentAddress.getType() === Cardano.AddressType.BasePaymentKeyStakeKey ||
          paymentAddress.getType() === Cardano.AddressType.BasePaymentScriptStakeKey) {

        // For base addresses, provide stake key derivation path
        if (stakeKeys && stakeKeys.length > 0 && stakeKeys[0].path) {
          const pathArray = hdPathToArray(stakeKeys[0].path);
          return {
            role: KeyRole.Stake,
            index: pathArray[pathArray.length - 1]
          } as AccountKeyDerivationPath;
        }
      }

      return undefined; // No stake key for enterprise addresses
    } catch (error) {
      console.warn('[TREZOR] Failed to get stake key derivation path:', error);
      return undefined;
    }
  },

  /**
   * Create InputResolver from UTXO set for transaction input resolution
   */
  createInputResolver(utxos: Cardano.Utxo[]): Cardano.InputResolver {
    return {
      resolveInput: async (txIn: Cardano.TxIn): Promise<Cardano.TxOut | null> => {
        try {
          const utxo = utxos.find(([hydratedTxIn, _txOut]) =>
            hydratedTxIn.txId === txIn.txId && hydratedTxIn.index === txIn.index
          );

          if (utxo) {
            return utxo[1]; // Return the TxOut
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
};
