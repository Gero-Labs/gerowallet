import TransportWebUSB from '@ledgerhq/hw-transport-webusb';
import BluetoothTransport from '@ledgerhq/hw-transport-web-ble';
import {
  Ada,
  DeviceStatusError,
  GetExtendedPublicKeysResponse,
  GetVersionResponse,
  TxOutputFormat,
} from '@cardano-foundation/ledgerjs-hw-app-cardano';
import { Key, Keys } from '@/models/types';
import snackbar from '@/plugins/snackbar';
import hardwareLoading from '@/plugins/hardwareLoading';
import Transport from '@ledgerhq/hw-transport';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { hdPathToArray, toStakeAddress } from '@/chrome/serialization';
import { NetworkInfo } from '@/utils/networks';
import * as Crypto from '@cardano-sdk/crypto';
import { LedgerTxTransformerContext, LedgerKeyAgent } from '@cardano-sdk/hardware-ledger';
import { util } from '@cardano-sdk/key-management';
import { GroupedAddress, AddressType, KeyRole, AccountKeyDerivationPath, CommunicationType } from '@cardano-sdk/key-management';
import { Bip32PublicKey } from '@cardano-sdk/crypto';
import { bech32 } from 'bech32';
import { HexBlob } from '@cardano-sdk/util';
import { debugLog } from '@/utils/debug';

const timeout = (ms: number, message: string) => {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(message));
    }, ms);
  });
};

export default {
  _transport: null,
  _transportType: null,
  _transportClose: null,
  _ledger: null,
  usbDevice: undefined,
  async initLedger(isBluetooth: boolean, path: string) {
    const pathArray = hdPathToArray(path);
    try {
      let transport: Transport;
      if (!isBluetooth) {
        transport = await this.connectViaUSB();
      } else {
        transport = await this.connectViaBT();
      }
      const ledger: Ada = new Ada(transport);
      if (!ledger) {
        return false;
      }
      hardwareLoading.setText('Retrieving Hardware Wallet Name ...');
      const productName: string = ledger.transport.deviceModel.productName;
      hardwareLoading.setText('Retrieving Cardano App Version ...');
      const version: GetVersionResponse = await this.retrieveCardanoAppVersion(ledger);
      hardwareLoading.setText('Please Confirm Exporting Hardware Wallet Public Keys on Your Ledger Device.');
      const ledgerKeys: GetExtendedPublicKeysResponse = await ledger.getExtendedPublicKeys({
        paths: [pathArray],
      });
      const bip32PublicKey: Bip32PublicKey = Bip32PublicKey.fromHex(ledgerKeys[0].publicKeyHex + ledgerKeys[0].chainCodeHex);
      const words = bech32.toWords(bip32PublicKey.bytes());
      const hwPublicKey = bech32.encode('xpub', words, 1023);
      const keys = [{
        chainCode: ledgerKeys[0].chainCodeHex,
        path: path,
        publicKey: ledgerKeys[0].publicKeyHex,
      }];
      return { productName, version, hwPublicKey, keys };
    } catch (error: any) {
      console.log('[LEDGER] Error initializing Ledger:', error);
      snackbar.setError(error.message);
      this.usbDevice = undefined;
    }
    return this.usbDevice;
  },
  async retrieveCardanoAppVersion(ledger: Ada): Promise<GetVersionResponse> {
    try {
      let version: GetVersionResponse;
      await Promise.race([
        timeout(10000, null), // 10,000 = the maximum time to wait
        (async (): Promise<void> => {
          version = await ledger.getVersion();
        })(),
      ]);
      return version;
    } catch (e) {
      throw new Error('Failed to Retrieve Cardano App Version. Is the Cardano App Opened on Your Ledger?');
    }
  },
  async connectViaUSB(): Promise<Transport> {
    const isSupported: boolean = await TransportWebUSB.isSupported();
    if (isSupported) {
      if (this._transportClose) {
        await this._transportClose;
      }
      if (this._transport && this._transportType === 'WebUSB') {
        return this._transport;
      }
      let transport: Transport;
      try {
        transport = await TransportWebUSB.create();
      } catch (e) {
        const usbDevice = await navigator.usb.requestDevice({
          filters: [{ vendorId: 11415 }],
        });
        transport = await TransportWebUSB.open(usbDevice);
        throw e;
      }
      transport.on('disconnect', () => {
        this.setActiveTransport(null, null);
      });
      this.setActiveTransport(transport, 'WebUSB');
      return transport;
    } else {
      throw new Error('WebUSB not supported. Please check USB connection and/or choose another connection method.');
    }
  },
  async connectViaBT(): Promise<Transport> {
    console.log('[LEDGER-BT] Starting Bluetooth connection process...');

    const isSupported = await BluetoothTransport.isSupported();
    console.log('[LEDGER-BT] Bluetooth support check:', isSupported);

    if (isSupported) {
      if (this._transportClose) {
        console.log('[LEDGER-BT] Closing existing transport...');
        await this._transportClose;
      }
      if (this._transport && this._transportType === 'WebBLE') {
        console.log('[LEDGER-BT] Reusing existing Bluetooth transport');
        return this._transport;
      }

      console.log('[LEDGER-BT] Creating new Bluetooth transport...');
      try {
        const transport: Transport = await BluetoothTransport.create(12e3);
        console.log('[LEDGER-BT] Bluetooth transport created successfully:', transport);

        transport.on('disconnect', () => {
          console.log('[LEDGER-BT] Bluetooth transport disconnected');
          this.setActiveTransport(null, null);
        });

        this.setActiveTransport(transport, 'WebBLE');
        return transport;
      } catch (error) {
        console.error('[LEDGER-BT] Bluetooth transport creation failed:', error);
        throw error;
      }
    } else {
      throw new Error('Bluetooth not supported by Ledger device or platform. Please check bluetooth connection and/or choose another connection method in wallet settings.');
    }
  },
  setActiveTransport(transport: Transport, type: string) {
    this._transportClose = null;
    this._transport = transport;
    this._transportType = type;
    if (!this._transport && this._ledger) {
      this._ledger = null;
    }
  },

  async txToLedger(
    tx: Cardano.Tx,
    keys: Keys,
    utxos: Cardano.Utxo[],
    isUsb: boolean,
    network: NetworkInfo
  ): Promise<Cardano.Signatures> {
    const deserializedTx: Serialization.Transaction = Serialization.Transaction.fromCore(tx)
    const txBody: Cardano.TxBody = tx.body;
    const knownAddresses: GroupedAddress[] = this.createKnownAddressesFromKeys(keys, network);
    const inputResolver: Cardano.InputResolver = this.createInputResolver(utxos);
    const txInKeyPathMap = await util.createTxInKeyPathMap(txBody, knownAddresses, inputResolver);
    const ledgerTxTransformerContext: LedgerTxTransformerContext = {
      chainId: Cardano.ChainIds.Mainnet,
      accountIndex: 0,
      outputsFormat: tx.body.outputs.map(_out => TxOutputFormat.MAP_BABBAGE),
      collateralReturnFormat: TxOutputFormat.MAP_BABBAGE,
      txInKeyPathMap,
      knownAddresses,
    }
    const transport: Transport = isUsb ? await this.connectViaUSB() : await this.connectViaBT();
    const ledger: Ada = new Ada(transport);
    await this.ensureLedgerVersion(ledger);

    const ledgerKeyAgent: LedgerKeyAgent = await LedgerKeyAgent.createWithDevice({
      chainId: ledgerTxTransformerContext.chainId,
      accountIndex: ledgerTxTransformerContext.accountIndex,
      communicationType: CommunicationType.Web
    }, {
      bip32Ed25519: await Crypto.SodiumBip32Ed25519.create(),
      logger: console
    });
    return await ledgerKeyAgent.signTransaction(deserializedTx.body(), {
      knownAddresses,
      txInKeyPathMap,
    })
  },
  async ensureLedgerVersion(ledger: Ada) {
    const version: GetVersionResponse = await ledger.getVersion();
    if (!version) throw new Error('Cardano app is closed');
  },
  async signData(address: string, payload: string, network: any, accountIndex: number, isUsb: boolean, knownAddresses?: GroupedAddress[]): Promise<{signatureHex: string; signingPublicKeyHex: string; addressFieldHex: string}> {
    const transport: Transport = isUsb ? await this.connectViaUSB() : await this.connectViaBT();
    const ledger: Ada = new Ada(transport);
    await this.ensureLedgerVersion(ledger);

    // Create LedgerKeyAgent instance for proper CIP-8/CIP-30 signing
    const chainId = network.networkId === 1 ? Cardano.ChainIds.Mainnet : Cardano.ChainIds.Preprod;
    const ledgerKeyAgent: LedgerKeyAgent = await LedgerKeyAgent.createWithDevice({
      chainId: chainId,
      accountIndex: accountIndex,
      communicationType: CommunicationType.Web
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

    // Sign using CIP-8 data signing
    const signature = await ledgerKeyAgent.signCip8Data({
      knownAddresses: knownAddresses || [],
      signWith,
      payload: HexBlob(payload)
    });

    // Convert to the expected response format
    // addressFieldHex must be hex bytes for COSE structure
    return {
      signatureHex: signature.signature,
      signingPublicKeyHex: signature.key,
      addressFieldHex: Cardano.Address.fromBech32(addressBech32).toBytes()
    };
  },

  /**
   * Create GroupedAddress[] from a Keys object for Ledger transaction context
   * Maps wallet keys to the format expected by LedgerTxTransformerContext
   */
  createKnownAddressesFromKeys(keys: Keys, network: NetworkInfo): GroupedAddress[] {
    const knownAddresses: GroupedAddress[] = [];

    // Process payment addresses (External)
    keys.payment.forEach((key: Key, _arrayIndex: number) => {
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
          console.warn(`[LEDGER] Failed to process payment address ${key.address}:`, error);
        }
      }
    });

    // Process change addresses (Internal)
    keys.change.forEach((key: Key, _arrayIndex: number) => {
      if (key.address && key.path) {
        try {
          const networkId = network.networkId === 1 ? Cardano.NetworkId.Mainnet : Cardano.NetworkId.Testnet;
          const pathArray = hdPathToArray(key.path);
          const derivationIndex = pathArray[pathArray.length - 1]; // Last index in the path
          console.log('[LEDGER] Processing change address:', Cardano.Address.fromString(keys.stake[0].address).toBech32());
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
          console.warn(`[LEDGER] Failed to process change address ${key.address}:`, error);
        }
      }
    });

    // Process stake/reward addresses
    if (keys.stake && keys.stake.length > 0) {
      keys.stake.forEach((key: Key, _arrayIndex: number) => {
        if (key.address && key.path) {
          try {
            const networkId = network.networkId === 1 ? Cardano.NetworkId.Mainnet : Cardano.NetworkId.Testnet;
            const pathArray = hdPathToArray(key.path);
            const derivationIndex = pathArray[pathArray.length - 1]; // Last index in the path
            console.log('[LEDGER] Processing stake address:', key.address);

            // For stake addresses, we add them as reward accounts
            knownAddresses.push({
              type: AddressType.External, // Stake addresses use External type
              index: derivationIndex,
              networkId,
              accountIndex: 0,
              address: key.address as Cardano.PaymentAddress, // The stake address itself
              rewardAccount: key.address as Cardano.RewardAccount, // Same as address for stake keys
              stakeKeyDerivationPath: {
                role: KeyRole.Stake,
                index: derivationIndex
              } as AccountKeyDerivationPath
            });
          } catch (error) {
            console.warn(`[LEDGER] Failed to process stake address ${key.address}:`, error);
          }
        }
      });
    }

    debugLog('[LEDGER] Created known addresses:', knownAddresses.length);
    return knownAddresses;
  },

  /**
   * Get a stake key derivation path for a payment address
   */
  getStakeKeyDerivationPath(paymentKey: Key, stakeKeys: Key[]): AccountKeyDerivationPath | undefined {
    try {
      // Find the associated stake key for this payment address
      const paymentAddress: Cardano.Address = Cardano.Address.fromString(paymentKey.address);

      if (paymentAddress.getType() === Cardano.AddressType.BasePaymentKeyStakeKey ||
          paymentAddress.getType() === Cardano.AddressType.BasePaymentScriptStakeKey) {

        // For base addresses, we need to provide a stake key derivation path
        // Since asReward() is returning undefined, let's use the first available stake key
        if (stakeKeys && stakeKeys.length > 0 && stakeKeys[0].path) {
          const pathArray = hdPathToArray(stakeKeys[0].path);
          return {
            role: KeyRole.Stake,
            index: pathArray[pathArray.length - 1] // The last element is the index
          } as AccountKeyDerivationPath;
        }
      }

      return undefined; // No stake key derivation path for enterprise addresses
    } catch (error) {
      console.warn('[LEDGER] Failed to get stake key derivation path:', error);
      return undefined;
    }
  },

  /**
   * Create InputResolver from UTXO set for transaction input resolution
   * This allows the Ledger transaction context to resolve transaction inputs
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

          console.warn('[LEDGER] Could not resolve input:', txIn);
          return null;
        } catch (error) {
          console.error('[LEDGER] Error resolving input:', error);
          return null;
        }
      }
    };
  },
  ledgerErrorHandling(e: any) {
    if (e instanceof DeviceStatusError) {
      const error: DeviceStatusError = e;
      switch (error.code) {
        case 0x5515:
        case 0x6E11:
          snackbar.setError('Ledger device is locked. Please unlock it and try again.');
          break;
        case 0x6E01:
          snackbar.setError('Please open the Cardano app on your Ledger device and try again.');
          break;
        case 0x6E00:
          snackbar.setError('Invalid Ledger state. Please reconnect your Ledger device.');
          break;
        case 0x6E04:
          snackbar.setError('The Cardano app version on your Ledger is not supported. Please update the Cardano app.');
          break;
        case 0x6E10:
          snackbar.setError('Ledger device is in an invalid state. Please restart the Cardano app.');
          break;
        case 0x6982:
          snackbar.setError('Ledger device: Security status not satisfied. Please check your device.');
          break;
        case 0x6985:
          snackbar.setError('Transaction rejected on Ledger device.');
          break;
        case 0x6A80:
          snackbar.setError('Invalid data sent to Ledger device. Please try again.');
          break;
        default:
          snackbar.setError('Ledger device error. Please ensure the Cardano app is open and try again.');
      }
    } else if (e?.message?.includes('NetworkError') || e?.message?.includes('Unable to reset the device')) {
      snackbar.setError('Connection error with Ledger device. Please ensure the Cardano app is open and try again.');
    } else if (e?.message?.includes('No device selected') || e?.message?.includes('device not found')) {
      snackbar.setError('No Ledger device found. Please connect your Ledger device and try again.');
    } else if (e?.message?.includes('Failed to Retrieve Cardano App Version')) {
      snackbar.setError('Cannot connect to Cardano app. Please ensure the Cardano app is open on your Ledger device.');
    } else {
      console.error('Error signing with Ledger:', e);
      snackbar.setError(e instanceof Error ? e.message : 'Ledger signing failed. Please try again.');
    }
  }
};
