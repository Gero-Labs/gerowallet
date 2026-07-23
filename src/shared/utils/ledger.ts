import TransportWebUSB from '@ledgerhq/hw-transport-webusb';
import BluetoothTransport from '@ledgerhq/hw-transport-web-ble';
import {
  Ada,
  DeviceStatusError,
  GetExtendedPublicKeysResponse,
  GetVersionResponse,
  TxOutputFormat,
} from '@cardano-foundation/ledgerjs-hw-app-cardano';
import AppBtc from '@ledgerhq/hw-app-btc';
import { getAppAndVersion as getBtcAppAndVersion } from '@ledgerhq/hw-app-btc/lib/getAppAndVersion';
import { Key, Keys } from '@/models/types';
import snackbar from '@/plugins/snackbar';
import hardwareLoading from '@/plugins/hardwareLoading';
import i18n from '@/plugins/i18n';
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
import { DeviceModel } from '@ledgerhq/devices';

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
  async initLedger(isBluetooth: boolean, path: string): Promise<{
    productName: string;
    version: GetVersionResponse;
    hwPublicKey: string;
    keys: {
      chainCode: string;
      path: string;
      publicKey: string;
    }[],
    btSupported: boolean;
  }> {
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
        return undefined;
      }
      hardwareLoading.setText('Retrieving Hardware Wallet Name ...');
      const deviceModel: DeviceModel = ledger.transport.deviceModel;
      const btSupported: boolean = !!deviceModel.bluetoothSpec
      console.log('[LEDGER] Device Model:', deviceModel);
      const productName: string = deviceModel.productName;
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
      return { productName, version, hwPublicKey, keys, btSupported };
    } catch (error: unknown) {
      console.log('[LEDGER] Error initializing Ledger:', error);
      snackbar.setError(error instanceof Error ? error.message : String(error));
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
      throw new Error(i18n.t('wallet.ledgerAppVersionFailed') as string);
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
        throw new Error(i18n.t('wallet.ledgerWebUSBNotSupported') as string);
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
        throw new Error(i18n.t('wallet.ledgerBluetoothNotSupported') as string);
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
    network: NetworkInfo,
    originalTxCbor?: string
  ): Promise<Cardano.Signatures> {
    hardwareLoading.setText(i18n.t('wallet.ledgerPreparingTransaction') as string);
    // Use original CBOR if provided (for multisig) to preserve exact byte representation
    // This is critical for multisig transactions where another party has already signed the original bytes
    const deserializedTx: Serialization.Transaction = originalTxCbor
      ? Serialization.Transaction.fromCbor(Serialization.TxCBOR(originalTxCbor))
      : Serialization.Transaction.fromCore(tx);
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

    hardwareLoading.setText(i18n.t('wallet.ledgerConnectingDevice') as string);
    const transport: Transport = isUsb ? await this.connectViaUSB() : await this.connectViaBT();
    const ledger: Ada = new Ada(transport);

    hardwareLoading.setText(i18n.t('wallet.ledgerVerifyingApp') as string);
    await this.ensureLedgerVersion(ledger);

    hardwareLoading.setText(i18n.t('wallet.ledgerInitializingSigning') as string);
    // `deviceConnection` is what makes the agent adopt the transport opened
    // above. Without it, createWithDevice falls through to
    // establishDeviceConnection, which opens its OWN WebUSB transport for
    // CommunicationType.Web — there is no BLE communication type. Over
    // Bluetooth that discarded the connected device and then died on
    // "SecurityError: ... requestDevice ... permission request" for want of a
    // user gesture; over USB it merely prompted the user with a second chooser.
    const ledgerKeyAgent: LedgerKeyAgent = await LedgerKeyAgent.createWithDevice({
      chainId: ledgerTxTransformerContext.chainId,
      accountIndex: ledgerTxTransformerContext.accountIndex,
      communicationType: CommunicationType.Web,
      deviceConnection: await LedgerKeyAgent.createDeviceConnection(transport),
    }, {
      bip32Ed25519: await Crypto.SodiumBip32Ed25519.create(),
      logger: console
    });

    hardwareLoading.setText(i18n.t('wallet.ledgerPleaseConfirmDevice') as string);
    const res: Cardano.Signatures = await ledgerKeyAgent.signTransaction(deserializedTx.body(), {
      knownAddresses,
      txInKeyPathMap,
    })
    hardwareLoading.setLoading(false);
    return res;
  },
  /**
   * Produce the pool-OWNER witness on the Ledger (POOL_REGISTRATION_AS_OWNER).
   * The tx's fee input/change belong to a software hot key (third-party from the
   * device), so the device is asked to witness ONLY its stake (owner) key — it
   * refuses payment inputs in this mode by protocol. knownAddresses includes the
   * stake path (via createKnownAddressesFromKeys) so the owner reward account
   * resolves to DEVICE_OWNED; the hot-key input is intentionally absent from
   * txInKeyPathMap so its path stays null (owner-mode requirement).
   *
   * TODO(device-e2e): confirmed against a real device in Task 7. If the SDK
   * rejects an input with no path entry at all (rather than a null path) for
   * owner mode, `txInKeyPathMap` may need the hot input present with an
   * explicit third-party/no-path marker instead of being omitted — adjust here.
   */
  async poolOwnerWitness(
    tx: Cardano.Tx, keys: Keys, utxos: Cardano.Utxo[], isUsb: boolean, network: NetworkInfo,
  ): Promise<Cardano.Signatures> {
    const deserializedTx: Serialization.Transaction = Serialization.Transaction.fromCore(tx);
    const knownAddresses: GroupedAddress[] = this.createKnownAddressesFromKeys(keys, network);
    // Owner mode: do NOT map the hot-key inputs to device paths.
    const txInKeyPathMap = {};

    hardwareLoading.setText(i18n.t('wallet.ledgerConnectingDevice') as string);
    const transport: Transport = isUsb ? await this.connectViaUSB() : await this.connectViaBT();
    const ledger: Ada = new Ada(transport);

    hardwareLoading.setText(i18n.t('wallet.ledgerVerifyingApp') as string);
    await this.ensureLedgerVersion(ledger);

    hardwareLoading.setText(i18n.t('wallet.ledgerInitializingSigning') as string);
    const ledgerKeyAgent: LedgerKeyAgent = await LedgerKeyAgent.createWithDevice(
      {
        chainId: Cardano.ChainIds.Mainnet,
        accountIndex: 0,
        communicationType: CommunicationType.Web,
        deviceConnection: await LedgerKeyAgent.createDeviceConnection(transport),
      },
      { bip32Ed25519: await Crypto.SodiumBip32Ed25519.create(), logger: console },
    );

    hardwareLoading.setText(i18n.t('wallet.ledgerPleaseConfirmDevice') as string);
    const res: Cardano.Signatures = await ledgerKeyAgent.signTransaction(deserializedTx.body(), {
      knownAddresses,
      txInKeyPathMap,
    });
    hardwareLoading.setLoading(false);
    return res;
  },
  async ensureLedgerVersion(ledger: Ada) {
    const version: GetVersionResponse = await ledger.getVersion();
    if (!version) throw new Error(i18n.t('wallet.ledgerAppClosed') as string);
  },
  async signData(address: string, payload: string, network: NetworkInfo, accountIndex: number, isUsb: boolean, knownAddresses?: GroupedAddress[]): Promise<{signatureHex: string; signingPublicKeyHex: string; addressFieldHex: string}> {
    const transport: Transport = isUsb ? await this.connectViaUSB() : await this.connectViaBT();
    const ledger: Ada = new Ada(transport);
    await this.ensureLedgerVersion(ledger);

    // Create LedgerKeyAgent instance for proper CIP-8/CIP-30 signing
    const chainId = network.networkId === 1 ? Cardano.ChainIds.Mainnet : Cardano.ChainIds.Preprod;
    const ledgerKeyAgent: LedgerKeyAgent = await LedgerKeyAgent.createWithDevice({
      chainId: chainId,
      accountIndex: accountIndex,
      communicationType: CommunicationType.Web,
      deviceConnection: await LedgerKeyAgent.createDeviceConnection(transport),
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
  /**
   * Map a Ledger failure to the message a user can act on.
   *
   * `recognized` says whether the mapping actually identified the failure.
   * Callers rendering into a page should fall back to their own copy when it is
   * false: the unrecognized branch is where raw transport errors live, and those
   * carry bundle paths and line numbers that must not reach the UI.
   */
  classifyLedgerError(e: unknown): { message: string; recognized: boolean } {
    const rawMessage = (e as { message?: unknown } | null | undefined)?.message;
    const message = typeof rawMessage === 'string' ? rawMessage : undefined;
    const t = (key: string) => i18n.t(key) as string;

    if (e instanceof DeviceStatusError) {
      switch (e.code) {
        case 0x5515:
        case 0x6E11:
          return { message: t('wallet.ledgerDeviceLockedError'), recognized: true };
        case 0x6E01:
          return { message: t('wallet.ledgerOpenCardanoApp'), recognized: true };
        case 0x6E00:
          return { message: t('wallet.ledgerInvalidState'), recognized: true };
        case 0x6E04:
          return { message: t('wallet.ledgerAppVersionNotSupported'), recognized: true };
        case 0x6E10:
          return { message: t('wallet.ledgerInvalidStateRestart'), recognized: true };
        case 0x6982:
          return { message: t('wallet.ledgerSecurityNotSatisfied'), recognized: true };
        case 0x6985:
          return { message: t('wallet.ledgerTransactionRejected'), recognized: true };
        case 0x6A80:
          return { message: t('wallet.ledgerInvalidData'), recognized: true };
        default: {
          // Keep the status code for debugging while providing user-friendly copy
          const errorCode = e.code ? ` (Error code: 0x${e.code.toString(16).toUpperCase()})` : '';
          return { message: `${t('common.error')}${errorCode}. ${t('wallet.ledgerConnectionError')}`, recognized: true };
        }
      }
    }
    if (message?.includes('NetworkError') || message?.includes('Unable to reset the device')) {
      return { message: t('wallet.ledgerConnectionError'), recognized: true };
    }
    if (message?.includes('No device selected') || message?.includes('device not found')) {
      return { message: t('wallet.ledgerNoDevice'), recognized: true };
    }
    if (message?.includes('Failed to Retrieve Cardano App Version')) {
      return { message: t('wallet.ledgerCannotConnectApp'), recognized: true };
    }
    // txToLedger also throws already-localized strings of its own — an app that
    // is closed, a version that could not be read. Pass those through; the
    // caller decides whether an unrecognized message is safe to render.
    return { message: message || t('wallet.ledgerSigningFailed'), recognized: false };
  },

  ledgerErrorHandling(e: unknown) {
    const { message, recognized } = this.classifyLedgerError(e);
    if (recognized) {
      snackbar.setError(message);
      return;
    }
    console.error('Error signing with Ledger:', e);
    snackbar.setError(`${message}. ${i18n.t('common.pleaseTryAgain')}`);
  },

  // ============================================================================
  // BITCOIN LEDGER INTEGRATION
  // ============================================================================

  /**
   * Initialize Bitcoin Ledger connection and get extended public key (xpub)
   * @param isBluetooth - Use Bluetooth or USB connection
   * @param addressType - Bitcoin address type ('legacy', 'segwit', 'taproot')
   * @param accountIndex - Account index (default 0)
   * @param network - 'Mainnet' or 'Testnet' (determines BIP44 coin type)
   * @returns Bitcoin xpub, version, and device info
   */
  async initBitcoinLedger(isBluetooth: boolean, addressType: string = 'segwit', accountIndex: number = 0, network: string = 'Mainnet'): Promise<{
    productName: string;
    version: string;
    xpub: string;
    btSupported: boolean;
  }> {
    try {
      let transport: Transport;
      if (!isBluetooth) {
        transport = await this.connectViaUSB();
      } else {
        transport = await this.connectViaBT();
      }

      const btc = new AppBtc({ transport });

      hardwareLoading.setText('Retrieving Hardware Wallet Name ...');
      const deviceModel: DeviceModel = transport.deviceModel;
      const btSupported: boolean = !!deviceModel.bluetoothSpec;
      const productName: string = deviceModel.productName;

      hardwareLoading.setText('Retrieving Bitcoin App Version ...');
      let version = 'unknown';
      try {
        const appConfig = await getBtcAppAndVersion(transport);
        version = appConfig.version;
      } catch (e) {
        // Non-fatal: some app versions or states don't support getAppAndVersion
        console.warn('[LEDGER] Could not get Bitcoin app version (is Bitcoin app open?):', e);
      }

      hardwareLoading.setText('Please Confirm Exporting Hardware Wallet Public Key on Your Ledger Device.');

      // Determine derivation path based on address type
      let purpose: number;
      switch (addressType) {
        case 'legacy':
          purpose = 44; // BIP44
          break;
        case 'taproot':
          purpose = 86; // BIP86
          break;
        case 'segwit':
        default:
          purpose = 84; // BIP84
          break;
      }

      // BIP44 coin type: 0 = mainnet, 1 = testnet
      const coinType = network === 'Mainnet' ? 0 : 1;
      const path = `m/${purpose}'/${coinType}'/${accountIndex}'`;

      // Get extended public key from Ledger
      // getWalletXpub returns a base58-encoded xpub string directly (not an object)
      const xpub = await btc.getWalletXpub({ path, xpubVersion: 0x0488B21E });

      return { productName, version, xpub, btSupported };
    } catch (error: unknown) {
      console.log('[LEDGER] Error initializing Bitcoin Ledger:', error);
      snackbar.setError(error instanceof Error ? error.message : String(error));
      this.usbDevice = undefined;
      throw error;
    }
  },

  /**
   * Get Bitcoin address from Ledger with optional verification on device screen
   * @param addressType - Bitcoin address type
   * @param accountIndex - Account index
   * @param addressIndex - Address index
   * @param isChange - Internal (change) address or external (receive)
   * @param verify - Display address on device for verification
   * @param isUsb - Use USB or Bluetooth
   * @returns Bitcoin address
   */
  async getBitcoinAddress(
    addressType: string = 'segwit',
    accountIndex: number = 0,
    addressIndex: number = 0,
    isChange: boolean = false,
    verify: boolean = false,
    isUsb: boolean = true,
    network: string = 'Mainnet'
  ): Promise<string> {
    try {
      const transport: Transport = isUsb ? await this.connectViaUSB() : await this.connectViaBT();
      const btc = new AppBtc({ transport });

      // Determine derivation path
      let purpose: number;
      switch (addressType) {
        case 'legacy':
          purpose = 44;
          break;
        case 'taproot':
          purpose = 86;
          break;
        case 'segwit':
        default:
          purpose = 84;
          break;
      }

      // BIP44 coin type: 0 = mainnet, 1 = testnet
      const coinType = network === 'Mainnet' ? 0 : 1;
      const path = `m/${purpose}'/${coinType}'/${accountIndex}'/${isChange ? 1 : 0}/${addressIndex}`;

      if (verify) {
        hardwareLoading.setText('Please Verify Address on Your Ledger Device.');
      }

      // Get address from Ledger
      const result = await btc.getWalletPublicKey(path, {
        format: addressType === 'legacy' ? 'legacy' : (addressType === 'taproot' ? 'bech32m' : 'bech32'),
        verify,
      });

      return result.bitcoinAddress;
    } catch (error: unknown) {
      console.error('[LEDGER] Error getting Bitcoin address:', error);
      throw error;
    }
  },

  /**
   * Sign Bitcoin transaction (PSBT) with Ledger
   * @param psbtHex - Unsigned PSBT in hex format
   * @param _addressType - Bitcoin address type (unused: PSBT already encodes the paths to sign)
   * @param _accountIndex - Account index (unused: PSBT already encodes the paths to sign)
   * @param isUsb - Use USB or Bluetooth
   * @returns Signed PSBT in hex format
   */
  async signBitcoinTransaction(
    psbtHex: string,
    _addressType: string = 'segwit',
    _accountIndex: number = 0,
    isUsb: boolean = true
  ): Promise<string> {
    try {
      const transport: Transport = isUsb ? await this.connectViaUSB() : await this.connectViaBT();
      const btc = new AppBtc({ transport });

      hardwareLoading.setText('Please Confirm Transaction on Your Ledger Device.');

      // Sign the PSBT
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const signedPsbt = await (btc as any).signPsbt(psbtHex);

      hardwareLoading.setLoading(false);
      return signedPsbt;
    } catch (error: unknown) {
      console.error('[LEDGER] Error signing Bitcoin transaction:', error);
      hardwareLoading.setLoading(false);
      throw error;
    }
  },

  /**
   * Verify Bitcoin address on Ledger device screen
   * @param addressType - Bitcoin address type
   * @param accountIndex - Account index
   * @param addressIndex - Address index
   * @param isChange - Internal or external address
   * @param isUsb - Use USB or Bluetooth
   */
  async verifyBitcoinAddress(
    addressType: string = 'segwit',
    accountIndex: number = 0,
    addressIndex: number = 0,
    isChange: boolean = false,
    isUsb: boolean = true
  ): Promise<void> {
    hardwareLoading.setLoading(true);
    try {
      await this.getBitcoinAddress(addressType, accountIndex, addressIndex, isChange, true, isUsb);
      hardwareLoading.setLoading(false);
      snackbar.fireSuccess(i18n.t('wallet.ledgerAddressVerified') as string);
    } catch (error: unknown) {
      hardwareLoading.setLoading(false);
      throw error;
    }
  }
};
