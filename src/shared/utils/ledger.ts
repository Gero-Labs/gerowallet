import TransportWebUSB from '@ledgerhq/hw-transport-webusb';
import BluetoothTransport from '@ledgerhq/hw-transport-web-ble';
import Ada from '@cardano-foundation/ledgerjs-hw-app-cardano';
import { HARDENED, WalletTypePurpose, CoinTypes } from '@/models/types';
import snackbar from '@/plugins/snackbar';
import hardwareLoading from '@/plugins/hardwareLoading';
import { AuxiliaryData, Bip32PublicKey, TransactionBody } from '@emurgo/cardano-serialization-lib-browser';

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
  async initLedger(isBluetooth, signingMode) {
    try {
      let transport;
      if (!isBluetooth) {
        transport = await this.connectViaUSB();
        console.log(transport);
      } else {
        transport = await this.connectViaBT();
      }
      const ledger = new Ada(transport);
      if (!ledger) {
        return false;
      }
      hardwareLoading.setText('Retrieving Hardware Wallet Name ...');
      const productName = ledger.transport.deviceModel.productName;

      hardwareLoading.setText('Retrieving Cardano App Version ...');
      const version = await this.retrieveCardanoAppVersion(ledger);

      hardwareLoading.setText('Please Confirm Exporting Hardware Wallet Public Keys on Your Ledger Device.');
      const ledgerKeys = await ledger.getExtendedPublicKeys({
        paths: [[WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED]],
      });
      const hwPublicKey = Bip32PublicKey.from_hex(ledgerKeys[0].publicKeyHex + ledgerKeys[0].chainCodeHex).to_bech32();
      console.log(ledgerKeys);
      console.log(ledger);
      return { productName, version, hwPublicKey };
    } catch (error: any) {
      snackbar.setError(error.message);
      console.log('catch error', error.message);
      this.usbDevice = undefined;
    }
    return this.usbDevice;
  },
  async retrieveCardanoAppVersion(ledger) {
    try {
      let version;

      await Promise.race([
        timeout(10000, null), // 3000 = the maximum time to wait
        (async () => {
          // ...do the real work, modelled here as `wait`...
          version = await ledger.getVersion();
        })(),
      ]);

      return version;
    } catch (e) {
      throw new Error('Failed to Retrieve Cardano App Version. Is the Cardano App Opened on Your Ledger?');
    }
  },
  async connectViaUSB() {
    const isSupported = await TransportWebUSB.isSupported();
    if (isSupported) {
      if (this._transportClose) {
        await this._transportClose;
      }
      if (this._transport && this._transportType === 'WebUSB') {
        return this._transport;
      }
      let transport;
      try {
        transport = await TransportWebUSB.create();
      } catch (e) {
        console.log(e);
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
  async connectViaBT() {
    console.log('test');
    const isSupported = await BluetoothTransport.isSupported();
    if (isSupported) {
      if (this._transportClose) {
        await this._transportClose;
      }
      if (this._transport && this._transportType === 'WebBLE') {
        return this._transport;
      }
      const transport = await BluetoothTransport.create(12e3);
      transport.on('disconnect', () => {
        this.setActiveTransport(null, null);
      });
      this.setActiveTransport(transport, 'WebBLE');
      return transport;
    } else {
      throw new Error(
        'Bluetooth not supported by Ledger device or platform. Please check bluetooth connection and/or choose another connection method in wallet settings.'
      );
    }
  },
  setActiveTransport(transport, type) {
    this._transportClose = null;
    this._transport = transport;
    this._transportType = type;
    if (!this._transport && this._ledger) {
      this._ledger = null;
    }
  },
  async txToLedger(txBody: TransactionBody, address: string, index: number = 0, txAuxiliaryData: AuxiliaryData, isDapp?: boolean, usedUtxos?: any[]) {

    return undefined;
  },
};
