import TransportWebUSB from '@ledgerhq/hw-transport-webusb';
import BluetoothTransport from '@ledgerhq/hw-transport-web-ble';
import Ada, {
  AddressType,
  bigint_like,
  BIP32Path,
  CertificateType,
  CredentialParamsType, GetExtendedPublicKeysResponse, GetVersionResponse,
  PoolKeyType,
  PoolOwnerType,
  PoolRewardAccountType,
  RelayType,
  RequiredSigner, SignedTransactionData, SignMessageResponse,
  SignTransactionRequest,
  Transaction,
  TransactionSigningMode,
  TxAuxiliaryData,
  TxAuxiliaryDataType,
  TxInput,
  TxOutput,
  TxOutputDestination,
  TxOutputDestinationType,
  TxOutputFormat,
  TxRequiredSignerType,
} from '@cardano-foundation/ledgerjs-hw-app-cardano';
import { CoinTypes, HARDENED, WalletTypePurpose } from '@/models/types';
import snackbar from '@/plugins/snackbar';
import hardwareLoading from '@/plugins/hardwareLoading';
import {
  Address,
  AuxiliaryData,
  BaseAddress,
  Bip32PublicKey,
  Ed25519Signature,
  MintAssets,
  MintsAssets,
  RewardAddress,
  ScriptHash,
  Transaction as Trans,
  TransactionBody, TransactionInput, TransactionInputs,
  TransactionOutput,
  TransactionWitnessSet,
  Vkey,
  Vkeywitness,
  Vkeywitnesses,
} from '@emurgo/cardano-serialization-lib-browser';
import { TransactionOutputs } from '@emurgo/cardano-serialization-lib-browser/cardano_serialization_lib';
import { bytesToIp } from '@/shared/utils/converter';
import { Wallet } from '@/models/wallet';
import networks from '@/shared/utils/networks';
import { appWallet } from '@/store';
import { Buffer } from 'buffer';
import { MessageAddressFieldType, MessageData } from '@cardano-foundation/ledgerjs-hw-app-cardano/dist/types/public';
import Transport from '@ledgerhq/hw-transport'

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
  async initLedger(isBluetooth) {
    try {
      let transport: Transport;
      if (!isBluetooth) {
        transport = await this.connectViaUSB();
        console.log(transport);
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
      const version = await this.retrieveCardanoAppVersion(ledger);
      hardwareLoading.setText('Please Confirm Exporting Hardware Wallet Public Keys on Your Ledger Device.');
      const ledgerKeys: GetExtendedPublicKeysResponse = await ledger.getExtendedPublicKeys({
        paths: [[WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED]],
      });
      const hwPublicKey: string = Bip32PublicKey.from_hex(ledgerKeys[0].publicKeyHex + ledgerKeys[0].chainCodeHex).to_bech32();
      return { productName, version, hwPublicKey };
    } catch (error: any) {
      snackbar.setError(error.message);
      console.log('catch error', error.message);
      this.usbDevice = undefined;
    }
    return this.usbDevice;
  },
  async retrieveCardanoAppVersion(ledger: Ada): Promise<GetVersionResponse> {
    try {
      let version: GetVersionResponse;
      await Promise.race([
        timeout(10000, null), // 10000 = the maximum time to wait
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
  async connectViaBT(): Promise<Transport> {
    const isSupported = await BluetoothTransport.isSupported();
    if (isSupported) {
      if (this._transportClose) {
        await this._transportClose;
      }
      if (this._transport && this._transportType === 'WebBLE') {
        return this._transport;
      }
      const transport: Transport = await BluetoothTransport.create(12e3);
      transport.on('disconnect', () => {
        this.setActiveTransport(null, null);
      });
      this.setActiveTransport(transport, 'WebBLE');
      return transport;
    } else {
      throw new Error('Bluetooth not supported by Ledger device or platform. Please check bluetooth connection and/or choose another connection method in wallet settings.',);
    }
  },
  setActiveTransport(transport: Transport, type) {
    this._transportClose = null;
    this._transport = transport;
    this._transportType = type;
    if (!this._transport && this._ledger) {
      this._ledger = null;
    }
  },
  async txToLedger(txBody: TransactionBody, wallet: Wallet, index: number = 0, txAuxiliaryData: AuxiliaryData, isDapp?: boolean, usedUtxos?: any[], isUsb?: boolean) {
    const address: Address = wallet.baseAddress().to_address();
    const stakeAddress: Address = wallet.stakeAddress().to_address();
    const network = networks.resolveNetwork(appWallet.chain, appWallet.network)
    const keys = {
      payment: {
        hash: BaseAddress.from_address(address).payment_cred().to_keyhash(),
        path: [WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED + index, 0, 0],
      },
      stake: {
        hash: RewardAddress.from_address(stakeAddress).payment_cred().to_keyhash(),
        path: [WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED + index, 2, 0],
      },
    };

    let signingMode: TransactionSigningMode = TransactionSigningMode.ORDINARY_TRANSACTION;
    const inputs: TransactionInputs = txBody.inputs();
    const ledgerInputs: TxInput[] = [];
    for (let i: number = 0; i < inputs.len(); i++) {
      const input: TransactionInput = inputs.get(i);

      const foundUtxo = usedUtxos.find(utxo => utxo.tx_hash === input.transaction_id().to_hex() && utxo.tx_index === input.index());
      if (foundUtxo) {
        ledgerInputs.push({
          txHashHex: Buffer.from(input.transaction_id().to_bytes()).toString('hex'),
          outputIndex: input.index(),
          path: [
            WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED + index, foundUtxo.addressing ? foundUtxo.addressing.type : 0, foundUtxo.addressing ? foundUtxo.addressing.path : 0,
          ], // needed to include payment key witness if available
        });
      }
    }
    const outputs = txBody.outputs();
    const ledgerOutputs: TxOutput[] = this.outputsToLedger(outputs, address, index, false);
    let ledgerCertificates = null;
    const certificates = txBody.certs();
    if (certificates) {
      ledgerCertificates = [];
      for (let i = 0; i < certificates.len(); i++) {
        const cert = certificates.get(i);
        const certificate = { type: null, params: null };
        if (cert.kind() === 0) {
          const credential = cert.as_stake_registration().stake_credential();
          certificate.type = CertificateType.STAKE_REGISTRATION;
          if (credential.kind() === 0) {
            certificate.params = {
              stakeCredential: {
                type: CredentialParamsType.KEY_PATH,
                keyPath: keys.stake.path,
              },
            };
          } else {
            const scriptHash = Buffer.from(
              credential.to_scripthash().to_bytes(),
            ).toString('hex');
            certificate.params = {
              stakeCredential: {
                type: CredentialParamsType.SCRIPT_HASH,
                scriptHash,
              },
            };
          }
        } else if (cert.kind() === 1) {
          const credential = cert.as_stake_deregistration().stake_credential();
          certificate.type = CertificateType.STAKE_DEREGISTRATION;
          if (credential.kind() === 0) {
            certificate.params = {
              stakeCredential: {
                type: CredentialParamsType.KEY_PATH,
                keyPath: keys.stake.path,
              },
            };
          } else {
            const scriptHash = Buffer.from(
              credential.to_scripthash().to_bytes(),
            ).toString('hex');
            certificate.params = {
              stakeCredential: {
                type: CredentialParamsType.SCRIPT_HASH,
                scriptHash,
              },
            };
          }
        } else if (cert.kind() === 2) {
          const delegation = cert.as_stake_delegation();
          const credential = delegation.stake_credential();
          const poolKeyHashHex = Buffer.from(
            delegation.pool_keyhash().to_bytes(),
          ).toString('hex');
          certificate.type = CertificateType.STAKE_DELEGATION;
          if (credential.kind() === 0) {
            certificate.params = {
              stakeCredential: {
                type: CredentialParamsType.KEY_PATH,
                keyPath: keys.stake.path,
              },
            };
          } else {
            const scriptHash = Buffer.from(
              credential.to_scripthash().to_bytes(),
            ).toString('hex');
            certificate.params = {
              stakeCredential: {
                type: CredentialParamsType.SCRIPT_HASH,
                scriptHash,
              },
            };
          }
          certificate.params.poolKeyHashHex = poolKeyHashHex;
        } else if (cert.kind() === 3) {
          const params = cert.as_pool_registration().pool_params();
          certificate.type = CertificateType.STAKE_POOL_REGISTRATION;
          const owners = params.pool_owners();
          const poolOwners = [];
          for (let i = 0; i < owners.len(); i++) {
            const keyHash = Buffer.from(owners.get(i).to_bytes()).toString('hex');
            if (keyHash == keys.stake.hash.to_hex()) {
              signingMode = TransactionSigningMode.POOL_REGISTRATION_AS_OWNER;
              poolOwners.push({
                type: PoolOwnerType.DEVICE_OWNED,
                stakingPath: keys.stake.path,
              });
            } else {
              poolOwners.push({
                type: PoolOwnerType.THIRD_PARTY,
                stakingKeyHashHex: keyHash,
              });
            }
          }
          const relays = params.relays();
          const ledgerRelays = [];
          for (let i = 0; i < relays.len(); i++) {
            const relay = relays.get(i);
            if (relay.kind() === 0) {
              const singleHostAddr = relay.as_single_host_addr();
              const type = RelayType.SINGLE_HOST_IP_ADDR;
              const portNumber = singleHostAddr.port();
              const ipv4 = singleHostAddr.ipv4() ? bytesToIp(singleHostAddr.ipv4().ip()) : null;
              const ipv6 = singleHostAddr.ipv6() ? bytesToIp(singleHostAddr.ipv6().ip()) : null;
              ledgerRelays.push({ type, params: { portNumber, ipv4, ipv6 } });
            } else if (relay.kind() === 1) {
              const type = RelayType.SINGLE_HOST_HOSTNAME;
              const singleHostName = relay.as_single_host_name();
              const portNumber = singleHostName.port();
              const dnsName = singleHostName.dns_name().record();
              ledgerRelays.push({
                type,
                params: { portNumber, dnsName },
              });
            } else if (relay.kind() === 2) {
              const type = RelayType.MULTI_HOST;
              const multiHostName = relay.as_multi_host_name();
              const dnsName = multiHostName.dns_name();
              ledgerRelays.push({
                type,
                params: { dnsName },
              });
            }
          }
          const cost = params.cost().to_str();
          const margin = params.margin();
          const pledge = params.pledge().to_str();
          const operator = Buffer.from(params.operator().to_bytes()).toString('hex',);
          let poolKey;
          if (operator == keys.stake.hash.to_hex()) {
            signingMode = TransactionSigningMode.POOL_REGISTRATION_AS_OPERATOR;
            poolKey = {
              type: PoolKeyType.DEVICE_OWNED,
              params: { path: keys.stake.path },
            };
          } else {
            poolKey = {
              type: PoolKeyType.THIRD_PARTY,
              params: { keyHashHex: operator },
            };
          }
          const metadata = params.pool_metadata()
            ? {
              metadataUrl: params.pool_metadata().url().url(),
              metadataHashHex: Buffer.from(
                params.pool_metadata().pool_metadata_hash().to_bytes(),
              ).toString('hex'),
            }
            : null;
          const rewardAccountHex = Buffer.from(params.reward_account().to_address().to_bytes()).toString('hex');
          let rewardAccount;
          if (rewardAccountHex == address.to_bech32()) {
            rewardAccount = {
              type: PoolRewardAccountType.DEVICE_OWNED,
              params: { path: keys.stake.path },
            };
          } else {
            rewardAccount = {
              type: PoolRewardAccountType.THIRD_PARTY,
              params: { rewardAccountHex },
            };
          }
          const vrfKeyHashHex = Buffer.from(
            params.vrf_keyhash().to_bytes(),
          ).toString('hex');

          certificate.params = {
            poolKey,
            vrfKeyHashHex,
            pledge,
            cost,
            margin: {
              numerator: margin.numerator().to_str(),
              denominator: margin.denominator().to_str(),
            },
            rewardAccount,
            poolOwners,
            relays: ledgerRelays,
            metadata,
          };
        }
        ledgerCertificates.push(certificate);
      }
    }
    const fee = txBody.fee().to_str();
    const ttl = txBody.ttl();
    const withdrawals = txBody.withdrawals();

    let ledgerWithdrawals = null;
    if (withdrawals) {
      ledgerWithdrawals = [];
      for (let i = 0; i < withdrawals.keys().len(); i++) {
        const withdrawal = { stakeCredential: { type: null, keyPath: null, scriptHash: null }, amount: '' };
        const rewardAddress = withdrawals.keys().get(i);
        if (rewardAddress.payment_cred().kind() === 0) {
          withdrawal.stakeCredential.type = CredentialParamsType.KEY_PATH;
          withdrawal.stakeCredential.keyPath = keys.stake.path;
        } else {
          withdrawal.stakeCredential.type = CredentialParamsType.SCRIPT_HASH;
          withdrawal.stakeCredential.scriptHash = Buffer.from(
            rewardAddress.payment_cred().to_scripthash().to_bytes(),
          ).toString('hex');
        }
        withdrawal.amount = withdrawals.get(rewardAddress).to_str();
        ledgerWithdrawals.push(withdrawal);
      }
    }

    const auxiliaryData: TxAuxiliaryData = txBody.auxiliary_data_hash()
      ? {
        type: TxAuxiliaryDataType.ARBITRARY_HASH,
        params: {
          hashHex: Buffer.from(
            txBody.auxiliary_data_hash().to_bytes(),
          ).toString('hex'),
        },
      }
      : null;

    const validityStartInterval: bigint_like = txBody.validity_start_interval();

    const mint = txBody.mint();
    let additionalWitnessPaths: BIP32Path[] = null;
    let mintBundle = null;
    if (mint) {
      mintBundle = [];
      for (let j = 0; j < mint.keys().len(); j++) {
        const policy: ScriptHash = mint.keys().get(j);
        const assets: MintsAssets = mint.get(policy);
        const tokens = [];
        for (let h = 0 ; h < assets.len() ; h++) {
          const assets2: MintAssets = assets.get(h);
          for (let k = 0; k < assets2.keys().len(); k++) {
            const assetName = assets2.keys().get(k);
            const amount = assets2.get(assetName);
            tokens.push({
              assetNameHex: Buffer.from(assetName.name()).toString('hex'),
              amount: amount.is_positive()
                ? amount.as_positive().to_str()
                : amount.as_negative().to_str(),
            });
          }
        }
        // sort canonical
        tokens.sort((a, b) => {
          if (a.assetNameHex.length == b.assetNameHex.length) {
            return a.assetNameHex > b.assetNameHex ? 1 : -1;
          } else if (a.assetNameHex.length > b.assetNameHex.length) return 1;
          else return -1;
        });
        mintBundle.push({
          policyIdHex: Buffer.from(policy.to_bytes()).toString('hex'),
          tokens,
        });
      }
      additionalWitnessPaths = [];
      if (keys.payment.path) additionalWitnessPaths.push(keys.payment.path);
      if (keys.stake.path) additionalWitnessPaths.push(keys.stake.path);
    }

    // Plutus
    const scriptDataHashHex = txBody.script_data_hash()
      ? Buffer.from(txBody.script_data_hash().to_bytes()).toString('hex')
      : null;

    let collateralInputs = null;
    if (txBody.collateral()) {
      collateralInputs = [];
      const coll = txBody.collateral();
      for (let i = 0; i < coll.len(); i++) {
        const input = coll.get(i);
        if (keys.payment.path) {
          collateralInputs.push({
            txHashHex: Buffer.from(input.transaction_id().to_bytes()).toString(
              'hex',
            ),
            outputIndex: parseInt(input.index().toString()),
            path: keys.payment.path, // needed to include payment key witness if available
          });
        } else {
          collateralInputs.push({
            txHashHex: Buffer.from(input.transaction_id().to_bytes()).toString(
              'hex',
            ),
            outputIndex: parseInt(input.index().toString()),
          });
        }
        signingMode = TransactionSigningMode.PLUTUS_TRANSACTION;
      }
    }

    const collateralOutput = (() => {
      if (txBody.collateral_return()) {
        const outputs = TransactionOutputs.new();
        outputs.add(txBody.collateral_return());
        const [out] = this.outputsToLedger(outputs, address, index);
        return out;
      }
      return null;
    })();

    const totalCollateral = txBody.total_collateral()
      ? txBody.total_collateral().to_str()
      : null;

    let referenceInputs = null;
    if (txBody.reference_inputs()) {
      referenceInputs = [];
      const refInputs: TransactionInputs = txBody.reference_inputs();
      for (let i: number = 0; i < refInputs.len(); i++) {
        const input: TransactionInput = refInputs.get(i);
        referenceInputs.push({
          txHashHex: input.transaction_id().to_hex(),
          outputIndex: parseInt(input.index().toString()),
          path: null,
        });
      }
    }

    let requiredSigners: RequiredSigner[] = null;
    if (txBody.required_signers()) {
      requiredSigners = [];
      const r = txBody.required_signers();
      for (let i = 0; i < r.len(); i++) {
        const signer = Buffer.from(r.get(i).to_bytes()).toString('hex');
        if (signer === keys.payment.hash.to_hex()) {
          requiredSigners.push({
            type: TxRequiredSignerType.PATH,
            path: keys.payment.path,
          });
        } else {
          requiredSigners.push({
            type: TxRequiredSignerType.HASH,
            hashHex: signer,
          });
        }
      }
      signingMode = TransactionSigningMode.PLUTUS_TRANSACTION;
    }

    const ledgerTx: Transaction = {
      network: {
        protocolMagic: network.networkParams?.networkMagic,
        networkId: 1,
      },
      inputs: ledgerInputs,
      outputs: ledgerOutputs,
      fee,
      ttl,
      certificates: ledgerCertificates,
      withdrawals: ledgerWithdrawals,
      auxiliaryData,
      validityIntervalStart: validityStartInterval,
      mint: mintBundle,
      scriptDataHashHex,
      requiredSigners,
      collateralInputs,
      collateralOutput,
      totalCollateral,
      referenceInputs,
      includeNetworkId: !!txBody.network_id(),
    };

    Object.keys(ledgerTx).forEach(
      (key: string) => !ledgerTx[key] && ledgerTx[key] != 0 && delete ledgerTx[key],
    );

    const fullTx: SignTransactionRequest = {
      signingMode,
      tx: ledgerTx,
      additionalWitnessPaths,
    };
    console.log(fullTx)
    Object.keys(fullTx).forEach(
      (key) => !fullTx[key] && fullTx[key] != 0 && delete fullTx[key],
    );
    let transport: Transport;
    console.log(isUsb)
    if (isUsb) {
      transport = await this.connectViaUSB();
      console.log(transport);
    } else {
      transport = await this.connectViaBT();
    }
    const ledger: Ada = new Ada(transport);
    if (!ledger) {
      return false;
    }
    const version: GetVersionResponse = await ledger.getVersion(); // check if Ledger has Cardano app opened
    if (!version) {
      throw new Error('Cardano app is closed');
    }
    const result: SignedTransactionData = await ledger.signTransaction(fullTx);

    const ledgerKeys = await ledger.getExtendedPublicKeys({
      paths: [[WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED + index]],
    });

    // getting public keys
    const witnessSet = TransactionWitnessSet.new();
    const vkeys = Vkeywitnesses.new();

    result.witnesses.forEach((witness) => {
      const vkey = Vkey.new(
        Bip32PublicKey.from_bytes(Buffer.from(ledgerKeys[0].publicKeyHex + ledgerKeys[0].chainCodeHex, 'hex'))
          .derive(witness.path[3])
          .derive(witness.path[4])
          .to_raw_key(),
      );
      const signature = Ed25519Signature.from_hex(
        witness.witnessSignatureHex,
      );
      vkeys.add(Vkeywitness.new(vkey, signature));
    });
    witnessSet.set_vkeys(vkeys);
    if (isDapp) {
      return witnessSet;
    } else {
      return Trans.new(txBody, witnessSet, txAuxiliaryData).to_bytes();
    }
  },
  outputsToLedger(outputs: TransactionOutputs, address, index, checkDatum = true): TxOutput[] {
    const ledgerOutputs = [];
    for (let i = 0; i < outputs.len(); i++) {
      const output: TransactionOutput = outputs.get(i);
      const multiAsset = output.amount().multiasset();
      let tokenBundle = null;

      if (multiAsset) {
        tokenBundle = [];
        for (let j = 0; j < multiAsset.keys().len(); j++) {
          const policy = multiAsset.keys().get(j);
          const assets = multiAsset.get(policy);
          const tokens = [];
          for (let k = 0; k < assets.keys().len(); k++) {
            const assetName = assets.keys().get(k);
            const amount = assets.get(assetName).to_str();
            tokens.push({
              assetNameHex: Buffer.from(assetName.name()).toString('hex'),
              amount,
            });
          }
          // sort canonical
          tokens.sort((a, b): number => {
            if (a.assetNameHex.length == b.assetNameHex.length) {
              return a.assetNameHex > b.assetNameHex ? 1 : -1;
            } else if (a.assetNameHex.length > b.assetNameHex.length) return 1;
            else return -1;
          });
          tokenBundle.push({
            policyIdHex: Buffer.from(policy.to_bytes()).toString('hex'),
            tokens,
          });
        }
      }

      const outputAddress: string = Buffer.from(output.address().to_bytes()).toString('hex',);
      const destination: TxOutputDestination =
        output.address().to_bech32() !== address
          ? {
            type: TxOutputDestinationType.DEVICE_OWNED,
            params: {
              type: AddressType.BASE_PAYMENT_KEY_STAKE_KEY,
              params: {
                spendingPath: [WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED + index, 0, 0],
                stakingPath: [WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED + index, 2, 0],
              },
            },
          }
          : {
            type: TxOutputDestinationType.THIRD_PARTY,
            params: {
              addressHex: outputAddress,
            },
          };
      const datum = checkDatum ? output?.plutus_data() : null;
      const outputRes: TxOutput = {
        amount: output.amount().coin().to_str(),
        tokenBundle,
        destination,
        datumHashHex:
          datum && datum.kind() === 0
            ? datum.to_hex()
            : null,
      };
      //that is deleting the format property, that's why we add it in the next line
      Object.keys(outputRes).forEach((key: string) => {
        if (!outputRes[key]) delete outputRes[key];
      });
      //TODO: this is hardcoded until we implement babbage utxos
      outputRes.format = TxOutputFormat.ARRAY_LEGACY;
      ledgerOutputs.push(outputRes);
    }
    return ledgerOutputs;
  },
  async signData(address: string, payload: string, network: any, accountIndex: number, isUsb: boolean): Promise<SignMessageResponse> {
    const messageData: MessageData = {
      messageHex: payload,
      signingPath: [WalletTypePurpose.CIP1852, CoinTypes.CARDANO, accountIndex + HARDENED, 2, 0],
      hashPayload: false,
      preferHexDisplay: false,
      addressFieldType: MessageAddressFieldType.ADDRESS,
      address: {
        type: AddressType.REWARD_KEY,
        params: {
          stakingPath: [WalletTypePurpose.CIP1852, CoinTypes.CARDANO, accountIndex + HARDENED, 2, 0],
        },
      },
      network: { protocolMagic: network.networkParams.networkMagic, networkId: network.networkId },
    }
    let transport: Transport;
    console.log(isUsb)
    if (isUsb) {
      transport = await this.connectViaUSB();
      console.log(transport);
    } else {
      transport = await this.connectViaBT();
    }
    const ledger: Ada = new Ada(transport);
    const version: GetVersionResponse = await ledger.getVersion(); // check if Ledger has Cardano app opened
    if (!version) {
      throw new Error('Cardano app is closed');
    }
    return await ledger.signMessage(messageData)
  },
};
