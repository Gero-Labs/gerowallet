import TransportWebUSB from '@ledgerhq/hw-transport-webusb';
import BluetoothTransport from '@ledgerhq/hw-transport-web-ble';
import {
  Ada,
  AddressType,
  CertificateType,
  CredentialParamsType, DatumType, DRepParamsType,
  GetExtendedPublicKeysResponse,
  GetVersionResponse,
  SignedTransactionData,
  SignMessageResponse,
  TransactionSigningMode,
  TxInput,
  TxOutput,
  TxOutputDestinationType,
  TxOutputFormat, TxRequiredSignerType, VoteOption, VoterType,
} from '@cardano-foundation/ledgerjs-hw-app-cardano';
import { ChainDerivations, CoinTypes, HARDENED, purpose, WalletTypePurpose } from '@/models/types';
import snackbar from '@/plugins/snackbar';
import hardwareLoading from '@/plugins/hardwareLoading';
import {
  Address,
  AssetName,
  Assets,
  BaseAddress,
  Bip32PublicKey,
  CborContainerType,
  CertificateKind,
  Certificates, CommitteeColdResign, CommitteeHotAuth,
  DRepDeregistration, DRepKind, DRepRegistration, DRepUpdate,
  Ed25519KeyHashes,
  FixedTransaction,
  MultiAsset,
  ScriptHash, StakeDelegation, StakeDeregistration, StakeRegistration,
  TransactionInputs,
  TransactionOutputs, VoteDelegation, VotingProcedures,
  Withdrawals,
} from '@emurgo/cardano-serialization-lib-browser';
import { Wallet } from '@/models/wallet';
import networks from '@/utils/networks';
import { appWallet } from '@/stores';
import { Buffer } from 'buffer';
import { MessageAddressFieldType, MessageData } from '@cardano-foundation/ledgerjs-hw-app-cardano/dist/types/public';
import Transport from '@ledgerhq/hw-transport';
import {
  assembleWitnesses,
  generateLedgerMetadata,
  generateLedgerMetadataFromHash,
  generateLedgerMintBundle, generateLedgerOwnedAddress,
  getAddressCredentials, getDecodedCbor, getOwnedCred,
  getPlutusHVB, getRewardAddressFromCred,
  hasConwaySetTag,
  hdPathToArray,
  isCatalystVotingRegistrationMetadata,
  isSameArray, isScriptStakeAddress,
  toHexString,
} from '@/shared/utils/converter';
Object.values(CertificateKind).filter((v2) => isNaN(Number(v2)));
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
      const version: GetVersionResponse = await this.retrieveCardanoAppVersion(ledger);
      hardwareLoading.setText('Please Confirm Exporting Hardware Wallet Public Keys on Your Ledger Device.');
      const ledgerKeys: GetExtendedPublicKeysResponse = await ledger.getExtendedPublicKeys({
        paths: [pathArray],
      });
      const hwPublicKey: string = Bip32PublicKey.from_hex(ledgerKeys[0].publicKeyHex + ledgerKeys[0].chainCodeHex).to_bech32();
      const keys = [{
        chainCode: ledgerKeys[0].chainCodeHex,
        path: path,
        publicKey: ledgerKeys[0].publicKeyHex,
      }];
      return { productName, version, hwPublicKey, keys };
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
      throw new Error('Bluetooth not supported by Ledger device or platform. Please check bluetooth connection and/or choose another connection method in wallet settings.');
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

  async txToLedger(
    tx: FixedTransaction,
    wallet: Wallet,
    creds: Set<any>,
    index: number = 0,
    addresses: any,
    usedUtxos?: any[],
    isUsb?: boolean,
  ): Promise<string> {
    const txBody = tx.body();
    console.log(txBody.to_json());
    const address: Address = Address.from_bech32(wallet.baseAddress().toBech32());
    const network= networks.resolveNetwork(appWallet.chain, appWallet.network);
    const credList = Array.from(creds).map(el => {
      return {
        cred: el.cred,
        address: el.address,
        path: hdPathToArray(el.path)
      }
    })
    const accountData = {
      state: {
        networkId: network.networkId
      },
      account: {
        pub: wallet.publicKey,
        path: [purpose.hdwallet, 1815, index]
      },
      keys: {
        payment: Object.values(addresses).filter(address => hdPathToArray(address['path'])[3] === 0),
        stake: [{
          cred: BaseAddress.from_address(address).stake_cred().to_keyhash().to_hex(),
          path: `m/${purpose.hdwallet}'/1815'/${index}'/${ChainDerivations.CHIMERIC_ACCOUNT}/0`
        }],
        change: Object.values(addresses).filter(address => hdPathToArray(address['path'])[3] === 1),
        script: [],
        drep: [],
        cc_cold: [],
        cc_hot: []
      }
    }
    // const credList = [
    //   {
    //     cred: BaseAddress.from_address(address).payment_cred().to_keyhash().to_hex(),
    //     path: [WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED + index, 0, 0]
    //   },
    //   {
    //     cred: RewardAddress.from_address(stakeAddress).payment_cred().to_keyhash().to_hex(),
    //     path: [WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED + index, 2, 0]
    //   }]
    // Process Inputs
    const inputs = this.generateLedgerInputs(accountData, txBody.inputs(), usedUtxos);
    // Collateral Inputs
    const collateralInputs = txBody.collateral() ? this.generateLedgerInputs(accountData, txBody.collateral(), usedUtxos) : null;
    // Reference Inputs
    const referenceInputs = txBody.reference_inputs() ? this.generateLedgerInputs(accountData, txBody.reference_inputs(), usedUtxos) : null;
    // Process Outputs
    const outputs: TxOutput[] = this.generateLedgerOutputs(accountData, tx, tx.body().outputs());
    // Collateral Output
    let collateralOutput = null;
    if (txBody.collateral_return()) {
      const collateralOutputs = TransactionOutputs.new();
      collateralOutputs.add(txBody.collateral_return());
      collateralOutput = this.generateLedgerOutputs(accountData, tx, collateralOutputs);
    }
    // Additional Witness Paths
    const additionalWitnessPaths = this.generateAdditionalWitnessPaths(credList, inputs, collateralInputs, referenceInputs);

    const lTx = {
      network: {
        protocolMagic: network.networkParams?.networkMagic,
        networkId: 1,
      },
      inputs,
      outputs,
      fee: txBody.fee().to_str(),
    };

    if (txBody.ttl()) {
      lTx['ttl'] = txBody.ttl().toString();
    }
    if (txBody.donation()) {
      lTx['donation'] = txBody.donation();
    }
    if (collateralInputs) {
      lTx['collateralInputs'] = collateralInputs;
    }
    if (referenceInputs) {
      lTx['referenceInputs'] = referenceInputs;
    }
    if (collateralOutput) {
      lTx['collateralOutput'] = collateralOutput;
    }
    if (txBody.total_collateral() != null) {
      lTx['totalCollateral'] = txBody.total_collateral();
    }
    if (txBody.withdrawals()) {
      lTx['withdrawals'] = this.generateLedgerWithdrawals(accountData, txBody.withdrawals());
    }
    if (txBody.certs()) {
      lTx['certificates'] = this.generateLedgerCertificates(accountData, txBody.certs());
    }
    if (tx.auxiliary_data() && isCatalystVotingRegistrationMetadata(tx.auxiliary_data())) {
      lTx['auxiliaryData'] = generateLedgerMetadata(accountData, tx.auxiliary_data());
    } else if (txBody.auxiliary_data_hash()) {
      lTx['auxiliaryData'] = generateLedgerMetadataFromHash(txBody.auxiliary_data_hash());
    }
    if (txBody.mint()) {
      lTx['mint'] = generateLedgerMintBundle(txBody.mint());
    }
    if (txBody.script_data_hash() != null) {
      lTx['scriptDataHashHex'] = txBody.script_data_hash().to_hex();
    }
    if (txBody.validity_start_interval() != null) {
      lTx['validityIntervalStart'] = txBody.validity_start_interval().toString();
    }
    if (txBody.required_signers()) {
      lTx['requiredSigners'] = this.generateRequiredSigners(accountData, txBody.required_signers());
    }
    if (txBody.network_id()) {
      lTx['includeNetworkId'] = true;
    }
    if (txBody.voting_procedures()) {
      lTx['votingProcedures'] = this.generateLedgerVotingProcedures(accountData, txBody.voting_procedures());
    }
    let signingMode;
    if (!!collateralInputs || !!tx.witness_set().redeemers() || !!txBody.reference_inputs()) {
      signingMode = TransactionSigningMode.PLUTUS_TRANSACTION;
    } else if (additionalWitnessPaths.some((path3) => path3[0] === (HARDENED + purpose.multisig) || path3[0] === (HARDENED + purpose.minting))) {
      signingMode = TransactionSigningMode.MULTISIG_TRANSACTION;
    } else {
      signingMode = TransactionSigningMode.ORDINARY_TRANSACTION;
    }
    const req = {
      signingMode,
      tx: lTx,
      options: {
        tagCborSets: hasConwaySetTag(tx),
      },
    };
    if (additionalWitnessPaths.length > 0) {
      req['additionalWitnessPaths'] = additionalWitnessPaths;
    }
    const fullTx = JSON.parse(JSON.stringify(req));

    console.log(fullTx);
    const transport: Transport = isUsb ? await this.connectViaUSB() : await this.connectViaBT();
    const ledger: Ada = new Ada(transport);
    await this.ensureLedgerVersion(ledger);

    const response: SignedTransactionData = await ledger.signTransaction(fullTx);
    console.log('response', response);
    return assembleWitnesses(accountData, response);
  },
  generateAdditionalWitnessPaths(credList, inputs, collaterals: TxInput[], refInputs: TxInput[]) {
    const additionalWitnessPaths = [];
    for (const cred of credList) {
      const hardenedPath = cred.path;
      if (additionalWitnessPaths.some((i2) => isSameArray(i2, hardenedPath))) {
        continue;
      }
      const isPartOfInputs = inputs.some((item) => item.path && isSameArray(item.path, hardenedPath));
      const isPartOfCollaterals = collaterals ? collaterals.some((item) => item.path && isSameArray(item.path, hardenedPath)) : false;
      const isPartOfRefInputs = refInputs ? refInputs.some((item) => item.path && isSameArray(item.path, hardenedPath)) : false;
      if (!isPartOfInputs && !isPartOfCollaterals && !isPartOfRefInputs) {
        additionalWitnessPaths.push(hardenedPath);
      }
    }
    return additionalWitnessPaths;
  },
  generateLedgerWithdrawals(accountData2, withdrawals: Withdrawals) {
    const ledgerWithdrawals = [];
    for (let i = 0 ; i < withdrawals.keys().len() ; i++) {
      const rewardAddress = withdrawals.keys().get(i);
      const amount = withdrawals.get(rewardAddress)
      const cred = getAddressCredentials(rewardAddress.to_address().to_bech32());
      const stakeCred = getOwnedCred([accountData2.keys], cred.stakeCred, "stake");
      if (stakeCred) {
        ledgerWithdrawals.push({
          stakeCredential: {
            type: CredentialParamsType.KEY_PATH,
            keyPath: hdPathToArray(stakeCred.path)
          },
          amount: amount.to_str()
        });
      } else if (cred.stakeCred) {
        ledgerWithdrawals.push({
          stakeCredential: isScriptStakeAddress(rewardAddress) ? {
            type: CredentialParamsType.SCRIPT_HASH,
            scriptHashHex: cred.stakeCred
          } : {
            type: CredentialParamsType.KEY_HASH,
            keyHashHex: cred.stakeCred
          },
          amount: amount.to_str()
        });
      }
    }
    return ledgerWithdrawals.length === 0 ? void 0 : ledgerWithdrawals;
  },
  generateRequiredSigners(accountData2, requiredSigners: Ed25519KeyHashes) {
    const requiredSignerList = [];
    for (let i = 0 ; i < requiredSigners.len() ; i++) {
      const requiredSigner = requiredSigners.get(i).to_hex()
      const cred = getOwnedCred([accountData2.keys], requiredSigner);
      if (cred) {
        requiredSignerList.push({
          type: TxRequiredSignerType.PATH,
          path: hdPathToArray(cred.path)
        });
      } else {
        requiredSignerList.push({
          type: TxRequiredSignerType.HASH,
          hashHex: requiredSigner
        });
      }
    }
    return requiredSignerList;
  },
  generateLedgerCertificates(accountData2, certificates: Certificates) {
    const ledgerCertificate = [];
    const networkId2 = accountData2.state.networkId;
    for (let i = 0 ; i < certificates.len() ; i++) {
      const cert = certificates.get(i)
      switch (cert.kind()) {
        case CertificateKind.StakeRegistration: {
          const regCert: StakeRegistration = cert.as_stake_registration();
          const cred: string = regCert.stake_credential().to_keyhash().to_hex();
          const addr: string = getRewardAddressFromCred(cred, networkId2);
          const ownedCred = getOwnedCred([accountData2.keys], cred, "stake");
          const ledgerRegCert = {
            type: regCert.coin() ? CertificateType.STAKE_REGISTRATION_CONWAY : CertificateType.STAKE_REGISTRATION,
            params: {
              stakeCredential: ownedCred ? {
                type: CredentialParamsType.KEY_PATH,
                keyPath: hdPathToArray(ownedCred.path)
              } : isScriptStakeAddress(addr) ? {
                type: CredentialParamsType.SCRIPT_HASH,
                scriptHashHex: cred
              } : {
                type: CredentialParamsType.KEY_HASH,
                keyHashHex: cred
              }
            }
          };
          if (regCert.coin()) {
            ledgerRegCert.params['deposit'] = regCert.coin().to_str();
          }
          ledgerCertificate.push(ledgerRegCert);
          break;
        }
        case CertificateKind.StakeDeregistration: {
          const deregCert: StakeDeregistration = cert.as_stake_deregistration();
          const cred: string = deregCert.stake_credential().to_keyhash().to_hex();
          const addr: string = getRewardAddressFromCred(cred, networkId2);
          const ownedCred = getOwnedCred([accountData2.keys], cred, "stake");
          const ledgerDeregCert = {
            type: deregCert.coin() ? CertificateType.STAKE_DEREGISTRATION_CONWAY : CertificateType.STAKE_DEREGISTRATION,
            params: {
              stakeCredential: ownedCred ? {
                type: CredentialParamsType.KEY_PATH,
                keyPath: hdPathToArray(ownedCred.path)
              } : isScriptStakeAddress(addr) ? {
                type: CredentialParamsType.SCRIPT_HASH,
                scriptHashHex: cred
              } : {
                type: CredentialParamsType.KEY_HASH,
                keyHashHex: cred
              }
            }
          };
          if (deregCert.coin()) {
            ledgerDeregCert.params['deposit'] = deregCert.coin().to_str();
          }
          ledgerCertificate.push(ledgerDeregCert);
          break;
        }
        case CertificateKind.StakeDelegation: {
          const delegation2: StakeDelegation = cert.as_stake_delegation();
          const cred: string = delegation2.stake_credential().to_keyhash().to_hex();
          const addr: string = getRewardAddressFromCred(cred, networkId2);
          const ownedCred = getOwnedCred([accountData2.keys], cred, "stake");
          ledgerCertificate.push({
            type: CertificateType.STAKE_DELEGATION,
            params: {
              stakeCredential: ownedCred ? {
                type: CredentialParamsType.KEY_PATH,
                keyPath: hdPathToArray(ownedCred.path)
              } : isScriptStakeAddress(addr) ? {
                type: CredentialParamsType.SCRIPT_HASH,
                scriptHashHex: cred
              } : {
                type: CredentialParamsType.KEY_HASH,
                keyHashHex: cred
              },
              poolKeyHashHex: delegation2.pool_keyhash().to_hex()
            }
          });
          break;
        }
        case CertificateKind.PoolRegistration:
        case CertificateKind.PoolRetirement:
          throw new Error("Error: generateLedgerCertificates: pool registration / retire cert no supported yet.");
        case CertificateKind.VoteDelegation: {
          const delegation2: VoteDelegation = cert.as_vote_delegation();
          const cred: string = delegation2.stake_credential().to_keyhash().to_hex();
          const addr: string = getRewardAddressFromCred(cred, networkId2);
          const drep = delegation2.drep();
          const ownedCred = getOwnedCred([accountData2.keys], cred, "stake");
          const ledgerVoteDel = {
            type: CertificateType.VOTE_DELEGATION,
            params: {
              stakeCredential: ownedCred ? {
                type: CredentialParamsType.KEY_PATH,
                keyPath: hdPathToArray(ownedCred.path)
              } : isScriptStakeAddress(addr) ? {
                type: CredentialParamsType.SCRIPT_HASH,
                scriptHashHex: cred
              } : {
                type: CredentialParamsType.KEY_HASH,
                keyHashHex: cred
              }
            }
          };
          switch (drep.kind()) {
            case DRepKind.AlwaysAbstain: {
              ledgerVoteDel.params['dRep'] = {
                type: DRepParamsType.ABSTAIN
              };
            }
            break
            case DRepKind.AlwaysNoConfidence: {
              ledgerVoteDel.params['dRep'] = {
                type: DRepParamsType.NO_CONFIDENCE
              };
            }
            break;
            case DRepKind.KeyHash: {
              const keyHash = drep.to_key_hash().to_hex();
              const ownedDRepCred = keyHash ? getOwnedCred([accountData2.keys], keyHash, "drep") : null;
              if (ownedDRepCred) {
                ledgerVoteDel.params['dRep'] = {
                  type: DRepParamsType.KEY_PATH,
                  keyPath: hdPathToArray(ownedDRepCred.path)
                };
              } else {
                ledgerVoteDel.params['dRep'] = {
                  type: DRepParamsType.KEY_HASH,
                  keyHashHex: keyHash
                };
              }
            }
            break;
            case DRepKind.ScriptHash: {
              ledgerVoteDel.params['dRep'] = {
                type: DRepParamsType.SCRIPT_HASH,
                scriptHashHex: drep.to_script_hash().to_hex()
              };
            }
            break;
          }
          ledgerCertificate.push(ledgerVoteDel);
          break;
        }
        case CertificateKind.CommitteeHotAuth: {
          const committeeHotAuth: CommitteeHotAuth = cert.as_committee_hot_auth();
          const coldKey = committeeHotAuth.committee_cold_credential().to_keyhash().to_hex();
          const hotKey = committeeHotAuth.committee_hot_credential().to_keyhash().to_hex();
          const ownedColdCred = getOwnedCred([accountData2.keys], coldKey, "cc_cold");
          const ownedHotCred = getOwnedCred([accountData2.keys], hotKey, "cc_hot");
          const ledgerCommitteeHotAuth = {
            type: CertificateType.AUTHORIZE_COMMITTEE_HOT,
            params: {
              coldCredential: ownedColdCred ? {
                type: CredentialParamsType.KEY_PATH,
                keyPath: hdPathToArray(ownedColdCred.path)
              } : {
                type: CredentialParamsType.KEY_HASH,
                keyHashHex: ownedColdCred
              },
              hotCredential: ownedHotCred ? {
                type: CredentialParamsType.KEY_PATH,
                keyPath: hdPathToArray(ownedHotCred.path)
              } : {
                type: CredentialParamsType.KEY_HASH,
                keyHashHex: ownedHotCred
              }
            }
          };
          ledgerCertificate.push(ledgerCommitteeHotAuth);
          break;
        }
        case CertificateKind.CommitteeColdResign: {
          const committeeHColdResign: CommitteeColdResign = cert.as_committee_cold_resign();
          const coldKey: string = committeeHColdResign.committee_cold_credential().to_keyhash().to_hex()
          const ownedColdCred = getOwnedCred([accountData2.keys], coldKey, "cc_cold");
          const ledgerCommitteeColdResign = {
            type: CertificateType.RESIGN_COMMITTEE_COLD,
            params: {
              coldCredential: ownedColdCred ? {
                type: CredentialParamsType.KEY_PATH,
                keyPath: hdPathToArray(ownedColdCred.path)
              } : {
                type: CredentialParamsType.KEY_HASH,
                keyHashHex: ownedColdCred
              }
            }
          };
          if (committeeHColdResign.anchor()) {
            ledgerCommitteeColdResign.params['anchor'] = {
              url: committeeHColdResign.anchor().url().url(),
              hashHex: committeeHColdResign.anchor().anchor_data_hash().to_hex()
            };
          }
          ledgerCertificate.push(ledgerCommitteeColdResign);
          break;
        }
        case CertificateKind.DRepRegistration: {
          const drepRegistration: DRepRegistration = cert.as_drep_registration();
          const cred: string = drepRegistration.voting_credential().to_keyhash().to_hex();
          const ownedDRepCred = getOwnedCred([accountData2.keys], cred, "drep");
          const ledgerDRepRegistration = {
            type: CertificateType.DREP_REGISTRATION,
            params: {
              dRepCredential: ownedDRepCred ? {
                type: CredentialParamsType.KEY_PATH,
                keyPath: hdPathToArray(ownedDRepCred.path)
              } : {
                type: CredentialParamsType.KEY_HASH,
                keyHashHex: ownedDRepCred
              },
              deposit: drepRegistration.coin().to_str()
            }
          };
          if (drepRegistration.anchor()) {
            ledgerDRepRegistration.params['anchor'] = {
              url: drepRegistration.anchor().url().url(),
              hashHex: drepRegistration.anchor().anchor_data_hash().to_hex()
            };
          }
          ledgerCertificate.push(ledgerDRepRegistration);
          break;
        }
        case CertificateKind.DRepUpdate: {
          const drepUpdate: DRepUpdate = cert.as_drep_update();
          const cred: string = drepUpdate.voting_credential().to_keyhash().to_hex();
          const ownedDRepCred = getOwnedCred([accountData2.keys], cred, "drep");
          const ledgerDRepUpdate = {
            type: CertificateType.DREP_UPDATE,
            params: {
              dRepCredential: ownedDRepCred ? {
                type: CredentialParamsType.KEY_PATH,
                keyPath: hdPathToArray(ownedDRepCred.path)
              } : {
                type: CredentialParamsType.KEY_HASH,
                keyHashHex: ownedDRepCred
              }
            }
          };
          if (drepUpdate.anchor()) {
            ledgerDRepUpdate.params['anchor'] = {
              url: drepUpdate.anchor().url().url(),
              hashHex: drepUpdate.anchor().anchor_data_hash().to_hex()
            };
          }
          ledgerCertificate.push(ledgerDRepUpdate);
          break;
        }
        case CertificateKind.DRepDeregistration: {
          const drepDeregistration: DRepDeregistration = cert.as_drep_deregistration();
          const cred = drepDeregistration.voting_credential().to_keyhash().to_hex();
          const ownedDRepCred = getOwnedCred([accountData2.keys], cred, "drep");
          const ledgerDRepdrepDeregistration = {
            type: CertificateType.DREP_DEREGISTRATION,
            params: {
              dRepCredential: ownedDRepCred ? {
                type: CredentialParamsType.KEY_PATH,
                keyPath: hdPathToArray(ownedDRepCred.path)
              } : {
                type: CredentialParamsType.KEY_HASH,
                keyHashHex: ownedDRepCred
              },
              deposit: drepDeregistration.coin().to_str()
            }
          };
          ledgerCertificate.push(ledgerDRepdrepDeregistration);
          break;
        }
        default:
          throw new Error(`generateLedgerCertificates: unsupported certificate type`);
      }
    }
    return ledgerCertificate;
  },
  generateLedgerVotingProcedures(accountData2, votingProcedure: VotingProcedures) {
    const ledgerVotingProcedures = [];
    const procedureList = votingProcedure.to_js_value()
    for (const procedure of procedureList) {
      let voter = void 0;
      const voterType = Object.keys(procedure.voter)[0];
      switch (voterType) {
        case 'ConstitutionalCommitteeHotKey': {
          const ccHotKey = procedure.voter['ConstitutionalCommitteeHotKey'];
          const cred = Object.values(ccHotKey)[0];
          const ownedCred = getOwnedCred([accountData2.keys], cred, 'cc_hot');
          if (ownedCred) {
            voter = {
              type: VoterType.COMMITTEE_KEY_PATH,
              keyPath: hdPathToArray(ownedCred.path),
            };
          } else if (Object.keys(ccHotKey)[0] === 'Key') {
            voter = {
              type: VoterType.COMMITTEE_KEY_HASH,
              keyHashHex: cred,
            };
          } else {
            voter = {
              type: VoterType.COMMITTEE_SCRIPT_HASH,
              scriptHashHex: cred,
            };
          }
          break;
        }
        case 'DRep': {
          const drep = procedure.voter['DRep'];
          const cred = Object.values(drep)[0];
          const ownedCred = getOwnedCred([accountData2.keys], cred, 'drep');
          if (ownedCred) {
            voter = {
              type: VoterType.DREP_KEY_PATH,
              keyPath: hdPathToArray(ownedCred.path),
            };
          } else if (Object.keys(drep)[0] === 'Key') {
            voter = {
              type: VoterType.DREP_KEY_HASH,
              keyHashHex: cred,
            };
          } else {
            voter = {
              type: VoterType.DREP_SCRIPT_HASH,
              scriptHashHex: cred,
            };
          }
          break;
        }
        case 'StakingPool': {
          voter = {
            type: VoterType.STAKE_POOL_KEY_HASH,
            keyHashHex: procedure.voter['StakingPool'],
          };
          break;
        }
        default:
          throw new Error(`generateLedgerVotingProcedures: unsupported voter type: ${voterType}`);
      }
      const votingProcedure = {
        voter,
        votes: [],
      };
      for (const vote of procedure.votes) {
        let voteOption;
        if (vote.voting_procedure.vote === 'No') {
          voteOption = VoteOption.NO;
        } else if (vote.voting_procedure.vote === 'Yes') {
          voteOption = VoteOption.YES;
        } else {
          voteOption = VoteOption.ABSTAIN;
        }
        const ledgerVote = {
          govActionId: {
            txHashHex: vote.action_id.transaction_id,
            govActionIndex: vote.action_id.index,
          },
          votingProcedure: {
            vote: voteOption,
          },
        };
        if (vote.voting_procedure.anchor) {
          ledgerVote.votingProcedure['anchor'] = {
            url: vote.voting_procedure.anchor.anchor_url,
            hashHex: vote.voting_procedure.anchor.anchor_data_hash,
          };
        }
        votingProcedure.votes.push(ledgerVote);
      }
      ledgerVotingProcedures.push(votingProcedure);
    }
    return ledgerVotingProcedures;
  },
  async ensureLedgerVersion(ledger: Ada) {
    const version: GetVersionResponse = await ledger.getVersion();
    if (!version) throw new Error('Cardano app is closed');
  },
  generateLedgerInputs(accountData2, inputs: TransactionInputs, utxoList) {
    const ledgerInputs = [];
    for (let i = 0 ; i < inputs.len() ; i++) {
      const input = inputs.get(i)
      console.log(utxoList)
      const utxo3 = utxoList.find((u2) => u2.tx_hash === input.transaction_id().to_hex() && u2.tx_index === input.index());
      const cred = utxo3 ? getAddressCredentials(utxo3.payment_addr.bech32) : null;
      const key3 = cred ? getOwnedCred([accountData2.keys], cred.paymentCred) : null;
      ledgerInputs.push({
        txHashHex: input.transaction_id().to_hex(),
        outputIndex: input.index(),
        path: key3 ? hdPathToArray(key3.path) : null
      });
    }
    return ledgerInputs;
  },
  generateLedgerTokenBundle(multiAsset: MultiAsset) {
    let tokenBundle = undefined;

    if (multiAsset) {
      tokenBundle = [];
      for (let j = 0; j < multiAsset.keys().len(); j++) {
        const policy: ScriptHash = multiAsset.keys().get(j);
        const assets: Assets = multiAsset.get(policy);
        const tokens = [];
        for (let k = 0; k < assets.keys().len(); k++) {
          const assetName: AssetName = assets.keys().get(k);
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
          policyIdHex: policy.to_hex(),
          tokens,
        });
      }
    }
    return tokenBundle;
  },
  generateLedgerOutputs(accountData2, tx2: FixedTransaction, outputs: TransactionOutputs) {
    let _a;
    const ledgerOutputs = [];
    for (let i = 0; i < outputs.len() ; i++) {
      const output2 = outputs.get(i);
      const outputJs = output2.to_js_value()
      const cred = getAddressCredentials(output2.address().to_bech32(), null, true);
      if (!cred) {
        throw new Error("unable to parse output address: " + output2.address().to_bech32());
      }
      const paymentCred = cred.paymentCred ? getOwnedCred([accountData2.keys], cred.paymentCred) : null;
      let out;
      let format2 = TxOutputFormat.ARRAY_LEGACY;
      let isBabbage = false
      if (output2.serialization_format() === CborContainerType.Map) {
        format2 = TxOutputFormat.MAP_BABBAGE;
        isBabbage = true
      }
      try {
        if (paymentCred) {
          out = {
            format: format2,
            destination: {
              type: TxOutputDestinationType.DEVICE_OWNED,
              params: generateLedgerOwnedAddress(accountData2, paymentCred, cred.stakeCred)
            },
            amount: output2.amount().coin().to_str()
          };
        }
      } catch (err2) {
        //
      }
      if (!out) {
        out = {
          format: format2,
          destination: {
            type: TxOutputDestinationType.THIRD_PARTY,
            params: {
              addressHex: toHexString(cred.addressBytes)
            }
          },
          amount: output2.amount().coin().to_str()
        };
      }
      if (output2.amount().multiasset()) {
        out.tokenBundle = this.generateLedgerTokenBundle(output2.amount().multiasset());
      }
      let plutusScriptBytes
      if (outputJs.script_ref) {
        const cslPlutusScript = output2.script_ref();
        const decodedPlutusScript = getDecodedCbor(toHexString(cslPlutusScript.to_bytes()));
        plutusScriptBytes = ((_a = decodedPlutusScript == null ? void 0 : decodedPlutusScript.value) == null ? void 0 : _a.value) ?? cslPlutusScript.to_bytes();
        let script = null;
        if (plutusScriptBytes) {
          script = toHexString(plutusScriptBytes);
        } else {
          script = outputJs.script_ref["PlutusScript"] ?? outputJs.script_ref["NativeScript"] ?? null;
        }
        if (script && typeof script === "string") {
          out = {
            ...out,
            referenceScriptHex: script
          };
        }
      }
      const hvb = getPlutusHVB(outputJs.plutus_data);
      if (output2.plutus_data()) {
        hvb.bytes = toHexString(output2.plutus_data().to_bytes());
      }
      if (hvb.bytes) {
        out = {
          ...out,
          datum: {
            type: DatumType.INLINE,
            datumHex: hvb.bytes
          }
        };
      } else if (hvb.hash) {
        if (format2 === TxOutputFormat.MAP_BABBAGE) {
          out = {
            ...out,
            datum: {
              type: DatumType.HASH,
              datumHashHex: hvb.hash
            }
          };
        } else {
          out = {
            ...out,
            datumHashHex: hvb.hash
          };
        }
      }
      ledgerOutputs.push(out);
    }
    return ledgerOutputs;
  },
  async signData(address: string, payload: string, network: any, accountIndex: number, isUsb: boolean): Promise<SignMessageResponse> {
    const messageData: MessageData = {
      messageHex: payload,
      signingPath: [WalletTypePurpose.CIP1852, CoinTypes.CARDANO, accountIndex + HARDENED, 2, 0],
      hashPayload: payload.length > 99,
      preferHexDisplay: false,
      addressFieldType: MessageAddressFieldType.ADDRESS,
      address: {
        type: AddressType.REWARD_KEY,
        params: {
          stakingPath: [WalletTypePurpose.CIP1852, CoinTypes.CARDANO, accountIndex + HARDENED, 2, 0],
        },
      },
      network: { protocolMagic: network.networkParams.networkMagic, networkId: network.networkId },
    };

    console.log(messageData);
    let transport: Transport;
    console.log(isUsb);
    if (isUsb) {
      transport = await this.connectViaUSB();
    } else {
      transport = await this.connectViaBT();
    }
    const ledger: Ada = new Ada(transport);
    const version: GetVersionResponse = await ledger.getVersion(); // check if Ledger has Cardano app opened
    if (!version) {
      throw new Error('Cardano app is closed');
    }
    return await ledger.signMessage(messageData);
  },
};
