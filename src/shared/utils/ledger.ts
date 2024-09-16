import TransportWebUSB from '@ledgerhq/hw-transport-webusb';
import BluetoothTransport from '@ledgerhq/hw-transport-web-ble';
import {
  Ada,
  AddressType,
  CertificateType,
  CredentialParamsType, DRepParamsType,
  GetExtendedPublicKeysResponse,
  GetVersionResponse,
  SignedTransactionData,
  SignMessageResponse,
  SignTransactionRequest,
  Transaction,
  TransactionSigningMode,
  TxInput,
  TxOutput,
  TxOutputDestinationType,
  TxOutputFormat, VoteOption, VoterType,
} from '@cardano-foundation/ledgerjs-hw-app-cardano';
import { CoinTypes, HARDENED, purpose, WalletTypePurpose } from '@/models/types';
import snackbar from '@/plugins/snackbar';
import hardwareLoading from '@/plugins/hardwareLoading';
import {
  Address,
  BaseAddress,
  Bip32PublicKey, CborContainerType, CertificateKind,
  Ed25519Signature, FixedTransaction,
  RewardAddress,
  TransactionInput,
  TransactionInputs,
  TransactionOutput,
  TransactionOutputs,
  TransactionWitnessSet,
  Vkey,
  Vkeywitness,
  Vkeywitnesses,
} from '@emurgo/cardano-serialization-lib-browser';
import { Wallet } from '@/models/wallet';
import networks from '@/shared/utils/networks';
import { appWallet } from '@/store';
import { Buffer } from 'buffer';
import { MessageAddressFieldType, MessageData } from '@cardano-foundation/ledgerjs-hw-app-cardano/dist/types/public';
import Transport from '@ledgerhq/hw-transport';
import {
  generateLedgerMetadata,
  generateLedgerMetadataFromHash,
  generateLedgerMintBundle,
  generateRequiredSigners,
  getAddressCredentials, getOwnedCred,
  getPlutusHVB, getRewardAddressFromCred,
  hasConwaySetTag,
  hdPathToArray,
  isCatalystVotingRegistrationMetadata,
  isSameArray, isScriptStakeAddress,
  toHexString,
} from '@/shared/utils/converter';
import { decode } from 'cborg';

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
    index: number = 0,
    addresses: any,
    usedUtxos?: any[],
    isUsb?: boolean,
  ): Promise<TransactionWitnessSet> {
    const txBody = tx.body();
    console.log(txBody.to_json());
    const address: Address = wallet.baseAddress().to_address();
    const stakeAddress: Address = wallet.stakeAddress().to_address();
    const network = networks.resolveNetwork(appWallet.chain, appWallet.network);

    const accountData = {
      state: {
        networkId: network.networkId
      },
      keys: {
        payment: Object.values(addresses),
        stake: {
          cred: BaseAddress.from_address(address).payment_cred().to_keyhash(),
          path: [WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED + index, 2, 0]
        }
      }

    }

    const credList = [
      {
        cred: BaseAddress.from_address(address).payment_cred().to_keyhash(),
        path: [WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED + index, 0, 0]
      },
      {
        cred: RewardAddress.from_address(stakeAddress).payment_cred().to_keyhash(),
        path: [WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED + index, 2, 0]
      }]
    // Process Inputs
    const inputs = this.inputsToLedger(txBody.inputs(), usedUtxos, addresses);
    // Collateral Inputs
    const collateralInputs = this.inputsToLedger(txBody.collateral(), usedUtxos, addresses);
    // Reference Inputs
    const referenceInputs = this.inputsToLedger(txBody.reference_inputs(), usedUtxos, addresses);
    // Process Outputs
    const outputs: TxOutput[] = this.outputsToLedger(txBody.outputs(), addresses, index, false);
    // Collateral Output
    let collateralOutput = null;
    if (txBody.collateral_return()) {
      const collateralOutputs = TransactionOutputs.new();
      collateralOutputs.add(txBody.collateral_return());
      collateralOutput = this.outputsToLedger(collateralOutputs, addresses, index, false);
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
      lTx['ttl'] = txBody.ttl();
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
      lTx.certificates = this.generateLedgerCertificates(accountData, txBody.certs());
    }
    if (tx.auxiliary_data() && isCatalystVotingRegistrationMetadata(tx.auxiliary_data())) {
      lTx.auxiliaryData = generateLedgerMetadata(accountData, tx.auxiliary_data());
    } else if (txBody.auxiliary_data_hash()) {
      lTx.auxiliaryData = generateLedgerMetadataFromHash(txBody.auxiliary_data_hash());
    }
    if (txBody.mint()) {
      lTx.mint = generateLedgerMintBundle(txBody.mint());
    }
    if (txBody.script_data_hash() != null) {
      lTx.scriptDataHashHex = txBody.script_data_hash();
    }
    if (txBody.validity_start_interval() != null) {
      lTx.validityIntervalStart = txBody.validity_start_interval();
    }
    if (txBody.required_signers()) {
      lTx.requiredSigners = this.generateRequiredSigners(accountData, txBody.required_signers());
    }
    if (txBody.network_id()) {
      lTx.includeNetworkId = true;
    }
    if (txBody.voting_procedures()) {
      lTx.votingProcedures = this.generateLedgerVotingProcedures(accountData, txBody.voting_procedures());
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
        tagCborSets: hasConwaySetTag(tx.to_hex()),
      },
    };
    if (additionalWitnessPaths.length > 0) {
      req.additionalWitnessPaths = additionalWitnessPaths;
    }
    const req_json = JSON.parse(JSON.stringify(req));
    txBuildRes2.hwRequest = req_json;
    console.log('builtTx', txBuildRes2);
    console.log('req_json', JSON.stringify(req_json));
    console.log('req_json', req_json);
    const ledger2 = await initiateLedger(void 0, signingMode);
    const requestNumber = _requestNumber;
    const response = await ledger2.signTransaction(req_json);
    if (requestNumber !== _requestNumber) {
      throw new Error('Ledger request closes.');
    }
    console.log('response', response);
    console.log('txBuildRes ', txBuildRes2);
    if (!moreTxFollow) {
      closeTransport().catch((e) => console.error(e));
    }
    if (txBuildRes2.txHash && doHashCheck) {
      if (response.txHashHex !== txBuildRes2.txHash) {
        console.error('Ledger tx hash response:', response.txHashHex);
        console.error('Source tx hash from cbor:', txBuildRes2.txHash);
        throw new Error('Tx serialization mismatch between Ledger and source transaction');
      }
    }
    const witnessSetHex = assembleWitnesses$1(accountData2, response);
    return {
      serializedWitnessSet: witnessSetHex,
      signedTransactionData: response,
    };


    const ledgerTx: Transaction = {
      network: {
        protocolMagic: network.networkParams?.networkMagic,
        networkId: 1,
      },
      inputs: ledgerInputs,
      outputs: ledgerOutputs,
      fee: txBody.fee().to_str(),
      ttl: txBody.ttl().toString(),
      certificates: ledgerCertificates,
      withdrawals: ledgerWithdrawals,
      auxiliaryData,
      validityIntervalStart: txBody.validity_start_interval()?.toString() || '0',
      mint: mintBundle,
      scriptDataHashHex: txBody.script_data_hash()
        ? Buffer.from(txBody.script_data_hash().to_bytes()).toString('hex')
        : null,
      requiredSigners: (requiredSigners.length > 0 ? requiredSigners : undefined),
      collateralInputs,
      collateralOutput,
      totalCollateral: txBody.total_collateral()
        ? txBody.total_collateral().to_str()
        : null,
      referenceInputs,
    };

    this.cleanObject(ledgerTx);

    const fullTx: SignTransactionRequest = {
      signingMode,
      tx: ledgerTx,
      additionalWitnessPaths,
      options: {},
    };

    this.cleanObject(fullTx);
    console.log(fullTx);
    const transport: Transport = isUsb ? await this.connectViaUSB() : await this.connectViaBT();
    const ledger: Ada = new Ada(transport);
    await this.ensureLedgerVersion(ledger);

    const result: SignedTransactionData = await ledger.signTransaction(fullTx);

    const ledgerKeys: GetExtendedPublicKeysResponse = await ledger.getExtendedPublicKeys({
      paths: [[WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED + index]],
    });

    const witnessSet: TransactionWitnessSet = TransactionWitnessSet.new();
    const vKeys: Vkeywitnesses = Vkeywitnesses.new();

    result.witnesses.forEach((witness) => {
      const vKey = Vkey.new(Bip32PublicKey.from_bytes(Buffer.from(ledgerKeys[0].publicKeyHex + ledgerKeys[0].chainCodeHex, 'hex'))
        .derive(witness.path[3])
        .derive(witness.path[4])
        .to_raw_key(),
      );
      const signature = Ed25519Signature.from_hex(
        witness.witnessSignatureHex,
      );
      vKeys.add(Vkeywitness.new(vKey, signature));

    });
    witnessSet.set_vkeys(vKeys);
    return witnessSet;
  },
  generateAdditionalWitnessPaths(credList, inputs: TxInput[], collaterals: TxInput[], refInputs: TxInput[]) {
    const additionalWitnessPaths = [];
    for (const cred of credList) {
      if (additionalWitnessPaths.some((i2) => isSameArray(i2, cred.path))) {
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
  generateLedgerWithdrawals(accountData2, withdrawals) {
    const ledgerWithdrawals = [];
    for (const withdrawal2 of Object.entries(withdrawals)) {
      const cred = getAddressCredentials(withdrawal2[0]);
      const stakeCred = getOwnedCred([accountData2.keys], cred.stakeCred, "stake");
      if (stakeCred) {
        ledgerWithdrawals.push({
          stakeCredential: {
            type: CredentialParamsType.KEY_PATH,
            keyPath: hdPathToArray(stakeCred.path)
          },
          amount: withdrawal2[1]
        });
      } else if (cred.stakeCred) {
        ledgerWithdrawals.push({
          stakeCredential: isScriptStakeAddress(withdrawal2[0]) ? {
            type: CredentialParamsType.SCRIPT_HASH,
            scriptHashHex: cred.stakeCred
          } : {
            type: CredentialParamsType.KEY_HASH,
            keyHashHex: cred.stakeCred
          },
          amount: withdrawal2[1]
        });
      }
    }
    return ledgerWithdrawals.length === 0 ? void 0 : ledgerWithdrawals;
  },
  generateRequiredSigners(accountData2, requiredSigners) {
    const requiredSignerList = [];
    for (const requiredSigner of requiredSigners) {
      const cred = getOwnedCred([accountData2.keys], requiredSigner);
      if (cred) {
        requiredSignerList.push({
          type: Ada.TxRequiredSignerType.PATH,
          path: hdPathToArray(cred.path)
        });
      } else {
        requiredSignerList.push({
          type: Ada.TxRequiredSignerType.HASH,
          hashHex: requiredSigner
        });
      }
    }
    return requiredSignerList;
  },
  generateLedgerCertificates(accountData2, certificates) {
    const ledgerCertificate = [];
    const networkId2 = accountData2.state.networkId;
    for (const cert of certificates) {
      const id3 = CertificateTypes.findIndex((type2) => type2 === Object.keys(cert)[0]);
      switch (id3) {
        case CertificateKind.StakeRegistration: {
          const regCert = cert.StakeRegistration;
          const cred = Object.values(regCert.stake_credential)[0];
          const addr = getRewardAddressFromCred(cred, networkId2);
          const ownedCred = getOwnedCred([accountData2.keys], cred, "stake");
          const ledgerRegCert = {
            type: regCert.coin ? CertificateType.STAKE_REGISTRATION_CONWAY : CertificateType.STAKE_REGISTRATION,
            params: {
              stakeCredential: ownedCred ? {
                type: CredentialParamsType.KEY_PATH,
                keyPath: getHardenedDerivationPath(ownedCred.path)
              } : isScriptStakeAddress(addr) ? {
                type: CredentialParamsType.SCRIPT_HASH,
                scriptHashHex: cred
              } : {
                type: CredentialParamsType.KEY_HASH,
                keyHashHex: cred
              }
            }
          };
          if (regCert.coin) {
            ledgerRegCert.params.deposit = regCert.coin;
          }
          ledgerCertificate.push(ledgerRegCert);
          break;
        }
        case CertificateKind.StakeDeregistration: {
          const deregCert = cert.StakeDeregistration;
          const cred = Object.values(deregCert.stake_credential)[0];
          const addr = getRewardAddressFromCred(cred, networkId2);
          const ownedCred = getOwnedCred([accountData2.keys], cred, "stake");
          const ledgerDeregCert = {
            type: deregCert.coin ? CertificateType.STAKE_DEREGISTRATION_CONWAY : CertificateType.STAKE_DEREGISTRATION,
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
          if (deregCert.coin) {
            ledgerDeregCert.params.deposit = deregCert.coin;
          }
          ledgerCertificate.push(ledgerDeregCert);
          break;
        }
        case CertificateKind.StakeDelegation: {
          const delegation2 = cert.StakeDelegation;
          const cred = Object.values(delegation2.stake_credential)[0];
          const addr = getRewardAddressFromCred(cred, networkId2);
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
              poolKeyHashHex: delegation2.pool_keyhash
            }
          });
          break;
        }
        case CertificateKind.PoolRegistration:
        case CertificateKind.PoolRetirement:
          throw new Error("Error: generateLedgerCertificates: pool registration / retire cert no supported yet.");
        case CertificateKind.VoteDelegation: {
          const delegation2 = cert.VoteDelegation;
          const cred = Object.values(delegation2.stake_credential)[0];
          const addr = getRewardAddressFromCred(cred, networkId2);
          const drep = delegation2.drep;
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
          if (typeof drep === "string") {
            if (drep === "AlwaysAbstain") {
              ledgerVoteDel.params.dRep = {
                type: DRepParamsType.ABSTAIN
              };
            } else {
              ledgerVoteDel.params.dRep = {
                type: DRepParamsType.NO_CONFIDENCE
              };
            }
          } else {
            const keyHash = drep.KeyHash;
            const ownedDRepCred = keyHash ? getOwnedCred([accountData2.keys], keyHash, "drep") : null;
            if (keyHash) {
              if (ownedDRepCred) {
                ledgerVoteDel.params.dRep = {
                  type: DRepParamsType.KEY_PATH,
                  keyPath: hdPathToArray(ownedDRepCred.path)
                };
              } else {
                ledgerVoteDel.params.dRep = {
                  type: DRepParamsType.KEY_HASH,
                  keyHashHex: keyHash
                };
              }
            } else {
              ledgerVoteDel.params.dRep = {
                type: DRepParamsType.SCRIPT_HASH,
                scriptHashHex: drep.ScriptHash
              };
            }
          }
          ledgerCertificate.push(ledgerVoteDel);
          break;
        }
        case CertificateKind.CommitteeHotAuth: {
          const committeeHotAuth = cert.CommitteeHotAuth;
          const coldKey = Object.values(committeeHotAuth.committee_cold_credential)[0];
          const hotKey = Object.values(committeeHotAuth.committee_hot_credential)[0];
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
          const committeeHColdResign = cert.CommitteeColdResign;
          const coldKey = Object.values(committeeHColdResign.committee_cold_credential)[0];
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
          if (committeeHColdResign.anchor) {
            ledgerCommitteeColdResign.params.anchor = {
              url: committeeHColdResign.anchor.anchor_url,
              hashHex: committeeHColdResign.anchor.anchor_data_hash
            };
          }
          ledgerCertificate.push(ledgerCommitteeColdResign);
          break;
        }
        case CertificateKind.DRepRegistration: {
          const drepRegistration = cert.DRepRegistration;
          const cred = Object.values(drepRegistration.voting_credential)[0];
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
              deposit: drepRegistration.coin
            }
          };
          if (drepRegistration.anchor) {
            ledgerDRepRegistration.params.anchor = {
              url: drepRegistration.anchor.anchor_url,
              hashHex: drepRegistration.anchor.anchor_data_hash
            };
          }
          ledgerCertificate.push(ledgerDRepRegistration);
          break;
        }
        case CertificateKind.DRepUpdate: {
          const drepUpdate = cert.DRepUpdate;
          const cred = Object.values(drepUpdate.voting_credential)[0];
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
          if (drepUpdate.anchor) {
            ledgerDRepUpdate.params.anchor = {
              url: drepUpdate.anchor.anchor_url,
              hashHex: drepUpdate.anchor.anchor_data_hash
            };
          }
          ledgerCertificate.push(ledgerDRepUpdate);
          break;
        }
        case CertificateKind.DRepDeregistration: {
          const drepDeregistration = cert.DRepDeregistration;
          const cred = Object.values(drepDeregistration.voting_credential)[0];
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
              deposit: drepDeregistration.coin
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
  generateLedgerVotingProcedures(accountData2, procedureList) {
    const ledgerVotingProcedures = [];
    for (const procedure of procedureList) {
      let voter = void 0;
      const voterType = Object.keys(procedure.voter)[0];
      switch (voterType) {
        case 'ConstitutionalCommitteeHotKey': {
          const ccHotKey = procedure.voter.ConstitutionalCommitteeHotKey;
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
          const drep = procedure.voter.DRep;
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
            keyHashHex: procedure.voter.StakingPool,
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
          ledgerVote.votingProcedure.anchor = {
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
  cleanObject(obj: any) {
    Object.keys(obj).forEach(key => !obj[key] && obj[key] !== 0 && delete obj[key]);
  },
  async ensureLedgerVersion(ledger: Ada) {
    const version: GetVersionResponse = await ledger.getVersion();
    if (!version) throw new Error('Cardano app is closed');
  },
  inputsToLedger(inputs: TransactionInputs, usedUtxos, addresses) {
    const ledgerInputs: TxInput[] = [];
    for (let i: number = 0; i < inputs.len(); i++) {
      const input: TransactionInput = inputs.get(i);
      const foundUtxo = usedUtxos.find((utxo) => utxo.tx_hash === input.transaction_id().to_hex() && utxo.tx_index === input.index());
      const address = addresses[foundUtxo.payment_addr.bech32];
      console.log(address);
      ledgerInputs.push({
        txHashHex: input.transaction_id().to_hex(),
        outputIndex: input.index(),
        path: hdPathToArray(address.path),
      });
    }
    return ledgerInputs;
  },
  generateLedgerTokenBundle(multiAsset) {
    let tokenBundle = undefined;

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
    return tokenBundle;
  },
  outputsToLedger(outputs: TransactionOutputs, addresses, index, isCollateral): TxOutput[] {
    const ledgerOutputs = [];
    for (let i: number = 0; i < outputs.len(); i++) {
      const output: TransactionOutput = outputs.get(i);
      const addressDetails = addresses[output.address().to_bech32()];

      let format: TxOutputFormat = TxOutputFormat.ARRAY_LEGACY;
      const isBabbage = output.serialization_format() === CborContainerType.Map;
      if (isCollateral && isBabbage) {
        format = TxOutputFormat.MAP_BABBAGE;
      }

      let out =
        addressDetails
          ? {
            format,
            destination: {
              type: TxOutputDestinationType.DEVICE_OWNED,
              params: {
                spendingPath: hdPathToArray(addressDetails.path),
                stakingPath: [WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED + index, 2, 0],
              },
            },
            amount: output.amount().coin(),
          }
          : {
            format,
            destination: {
              type: TxOutputDestinationType.THIRD_PARTY,
              params: {
                addressHex: output.address().to_hex(),
              },
            },
          };
      let plutusDataBytes;
      let plutusScriptBytes;
      if (output.amount().multiasset()) {
        out.tokenBundle = this.generateLedgerTokenBundle(output.amount().multiasset());
      }
      if (isBabbage) {
        const plutusData = output.plutus_data();
        const plutusScript = output.script_ref();
        if (plutusData) {
          plutusDataBytes = plutusData.to_bytes();
        }
        if (plutusScript) {
          const script = decode(plutusScript.to_bytes());
          let _a;
          plutusScriptBytes = ((_a = script == null ? void 0 : script.value) == null ? void 0 : _a.value) ?? plutusScript.to_bytes();
        }
      }
      if (output.script_ref()) {
        let script = null;
        if (plutusScriptBytes) {
          script = toHexString(plutusScriptBytes);
        } else {
          script = output.script_ref().plutus_script() ?? output.script_ref().native_script() ?? null;
        }
        if (script && typeof script === 'string') {
          out = {
            ...out,
            referenceScriptHex: script,
          };
        }
      }
      const hvb = getPlutusHVB(output.plutus_data());
      if (plutusDataBytes) {
        hvb.bytes = toHexString(plutusDataBytes);
      }
      if (hvb.bytes) {
        out = {
          ...out,
          datum: {
            type: 1,
            // DatumType.INLINE
            datumHex: hvb.bytes,
          },
        };
      } else if (hvb.hash) {
        if (format2 === TxOutputFormat.MAP_BABBAGE) {
          out = {
            ...out,
            datum: {
              type: 0,
              // DatumType.HASH
              datumHashHex: hvb.hash,
            },
          };
        } else {
          out = {
            ...out,
            datumHashHex: hvb.hash,
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
