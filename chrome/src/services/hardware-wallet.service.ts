/* eslint-disable prettier/prettier */
import {autoInjectable, singleton} from 'tsyringe';
import {
    AuxiliaryData,
    TransactionBody,
    TransactionOutputs,
    TransactionWitnessSet
} from '@emurgo/cardano-serialization-lib-nodejs';
import {AsyncLoader} from '../shared/AsyncLoader';
import {db} from '../database/GeroWalletDatabase';
import {ConceptualWalletService} from '../api/conceptual-wallet.service';
import {config} from '../config';
import Ada, {
    AddressType,
    bigint_like,
    BIP32Path,
    CertificateType,
    HARDENED,
    PoolKeyType,
    PoolOwnerType,
    PoolRewardAccountType,
    RelayType,
    RequiredSigner,
    SignTransactionRequest,
    StakeCredentialParamsType,
    Transaction,
    TransactionSigningMode,
    TxAuxiliaryData,
    TxAuxiliaryDataType,
    TxInput,
    TxOutput,
    TxOutputDestination,
    TxOutputDestinationType,
    TxOutputFormat,
    TxRequiredSignerType
} from '@cardano-foundation/ledgerjs-hw-app-cardano';
import TransportWebUSB from '@ledgerhq/hw-transport-webusb';
import TrezorConnect, {
    CardanoAuxiliaryData,
    CardanoCertificate,
    CardanoInput,
    CardanoOutput,
    CardanoPublicKey,
    CardanoRequiredSigner,
    CardanoSignTransaction,
    CardanoWithdrawal,
    Success,
    Unsuccessful,
} from "@trezor/connect-web";
import {
    CardanoAddressType,
    CardanoCertificateType,
    CardanoPoolRelayType,
    CardanoTxSigningMode
} from '@trezor/protobuf/lib/messages';
import {Buffer} from "buffer";

// https://github.com/trezor/connect/blob/develop/docs/methods/cardanoSignTransaction.md
// Yoroi has excellent documentation for Trezor setup
@singleton()
@autoInjectable()
export class HardwareWalletService {
    public
    private walletName: string;

    constructor(
        private conceptualWalletService?: ConceptualWalletService,) {
        this.initWallet();
    }

    public async getTrezorPublicKey(bundleSize?: number): Promise<Success<CardanoPublicKey> | Unsuccessful> {

        let publicKey;
        if (bundleSize > 0) {
            let bundle;
            for (let i = 0; i < bundleSize; i++) {
                bundle = {
                    path: `m/1852'/1815'/0'/0/${i}'`,
                    showOnTrezor: false
                }
                publicKey = await TrezorConnect.cardanoGetPublicKey({
                    bundle
                });
            }
        } else {
            publicKey = await TrezorConnect.cardanoGetPublicKey({
                path: "m/1852'/1815'/0'"
            })
        }
        //stop Trezor's listener
        return publicKey;
    }

    public getHardwareWalletName(): string {
        return this.walletName;
    }

    public txToLedger = async (txBody: TransactionBody, address: string, index = 0, txAuxiliaryData: AuxiliaryData, isDapp?: boolean, usedUtxos?: any[]) => {
        const keys = {
            payment: {
                hash: await this.addrToPaymentKeyHash(),
                path: [HARDENED + 1852, HARDENED + 1815, HARDENED + 0, 0, 0]
            },
            stake: {
                hash: await this.addrToStakeKeyHash(),
                path: [HARDENED + 1852, HARDENED + 1815, HARDENED + 0, 2, 0]
            },
        };

        let signingMode = TransactionSigningMode.ORDINARY_TRANSACTION;
        const inputs = txBody.inputs();
        const ledgerInputs: TxInput[] = [];
        for (let i = 0; i < inputs.len(); i++) {
            const input = inputs.get(i);

            const foundUtxo = usedUtxos.find(utxo => utxo.tx_hash === input.transaction_id().to_hex() && utxo.tx_index === input.index());
            ledgerInputs.push({
                txHashHex: Buffer.from(input.transaction_id().to_bytes()).toString('hex'),
                outputIndex: input.index(),
                path: [
                    HARDENED + 1852, HARDENED + 1815, HARDENED + 0, foundUtxo.addressing.type, foundUtxo.addressing.path
                ], // needed to include payment key witness if available
            });
        }

        const outputs = txBody.outputs();

        const ledgerOutputs: TxOutput[] = this.outputsToLedger(outputs, address, index, false);

        let ledgerCertificates = null;
        const certificates = txBody.certs();
        if (certificates) {
            ledgerCertificates = [];
            for (let i = 0; i < certificates.len(); i++) {
                const cert = certificates.get(i);
                const certificate = {type: null, params: null};
                if (cert.kind() === 0) {
                    const credential = cert.as_stake_registration().stake_credential();
                    certificate.type = CertificateType.STAKE_REGISTRATION;
                    if (credential.kind() === 0) {
                        certificate.params = {
                            stakeCredential: {
                                type: StakeCredentialParamsType.KEY_PATH,
                                keyPath: keys.stake.path,
                            },
                        };
                    } else {
                        const scriptHash = Buffer.from(
                            credential.to_scripthash().to_bytes()
                        ).toString('hex');
                        certificate.params = {
                            stakeCredential: {
                                type: StakeCredentialParamsType.SCRIPT_HASH,
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
                                type: StakeCredentialParamsType.KEY_PATH,
                                keyPath: keys.stake.path,
                            },
                        };
                    } else {
                        const scriptHash = Buffer.from(
                            credential.to_scripthash().to_bytes()
                        ).toString('hex');
                        certificate.params = {
                            stakeCredential: {
                                type: StakeCredentialParamsType.SCRIPT_HASH,
                                scriptHash,
                            },
                        };
                    }
                } else if (cert.kind() === 2) {
                    const delegation = cert.as_stake_delegation();
                    const credential = delegation.stake_credential();
                    const poolKeyHashHex = Buffer.from(
                        delegation.pool_keyhash().to_bytes()
                    ).toString('hex');
                    certificate.type = CertificateType.STAKE_DELEGATION;
                    if (credential.kind() === 0) {
                        certificate.params = {
                            stakeCredential: {
                                type: StakeCredentialParamsType.KEY_PATH,
                                keyPath: keys.stake.path,
                            },
                        };
                    } else {
                        const scriptHash = Buffer.from(
                            credential.to_scripthash().to_bytes()
                        ).toString('hex');
                        certificate.params = {
                            stakeCredential: {
                                type: StakeCredentialParamsType.SCRIPT_HASH,
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
                        if (keyHash == keys.stake.hash) {
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
                            const ipv4 = singleHostAddr.ipv4()
                                ? this.bytesToIp(singleHostAddr.ipv4().ip())
                                : null;
                            const ipv6 = singleHostAddr.ipv6()
                                ? this.bytesToIp(singleHostAddr.ipv6().ip())
                                : null;
                            ledgerRelays.push({type, params: {portNumber, ipv4, ipv6}});
                        } else if (relay.kind() === 1) {
                            const type = RelayType.SINGLE_HOST_HOSTNAME;
                            const singleHostName = relay.as_single_host_name();
                            const portNumber = singleHostName.port();
                            const dnsName = singleHostName.dns_name().record();
                            ledgerRelays.push({
                                type,
                                params: {portNumber, dnsName},
                            });
                        } else if (relay.kind() === 2) {
                            const type = RelayType.MULTI_HOST;
                            const multiHostName = relay.as_multi_host_name();
                            const dnsName = multiHostName.dns_name();
                            ledgerRelays.push({
                                type,
                                params: {dnsName},
                            });
                        }
                    }
                    const cost = params.cost().to_str();
                    const margin = params.margin();
                    const pledge = params.pledge().to_str();
                    const operator = Buffer.from(params.operator().to_bytes()).toString(
                        'hex'
                    );
                    let poolKey;
                    if (operator == keys.stake.hash) {
                        signingMode = TransactionSigningMode.POOL_REGISTRATION_AS_OPERATOR;
                        poolKey = {
                            type: PoolKeyType.DEVICE_OWNED,
                            params: {path: keys.stake.path},
                        };
                    } else {
                        poolKey = {
                            type: PoolKeyType.THIRD_PARTY,
                            params: {keyHashHex: operator},
                        };
                    }
                    const metadata = params.pool_metadata()
                        ? {
                            metadataUrl: params.pool_metadata().url().url(),
                            metadataHashHex: Buffer.from(
                                params.pool_metadata().pool_metadata_hash().to_bytes()
                            ).toString('hex'),
                        }
                        : null;
                    const rewardAccountHex = Buffer.from(
                        params.reward_account().to_address().to_bytes()
                    ).toString('hex');
                    let rewardAccount;
                    if (rewardAccountHex == address) {
                        rewardAccount = {
                            type: PoolRewardAccountType.DEVICE_OWNED,
                            params: {path: keys.stake.path},
                        };
                    } else {
                        rewardAccount = {
                            type: PoolRewardAccountType.THIRD_PARTY,
                            params: {rewardAccountHex},
                        };
                    }
                    const vrfKeyHashHex = Buffer.from(
                        params.vrf_keyhash().to_bytes()
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
                const withdrawal = {stakeCredential: {type: null, keyPath: null, scriptHash: null}, amount: ''};
                const rewardAddress = withdrawals.keys().get(i);
                if (rewardAddress.payment_cred().kind() === 0) {
                    withdrawal.stakeCredential.type = StakeCredentialParamsType.KEY_PATH;
                    withdrawal.stakeCredential.keyPath = keys.stake.path;
                } else {
                    withdrawal.stakeCredential.type = StakeCredentialParamsType.SCRIPT_HASH;
                    withdrawal.stakeCredential.scriptHash = Buffer.from(
                        rewardAddress.payment_cred().to_scripthash().to_bytes()
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
                        txBody.auxiliary_data_hash().to_bytes()
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
                const policy = mint.keys().get(j);
                const assets = mint.get(policy);
                const tokens = [];
                for (let k = 0; k < assets.keys().len(); k++) {
                    const assetName = assets.keys().get(k);
                    const amount = assets.get(assetName);
                    tokens.push({
                        assetNameHex: Buffer.from(assetName.name()).toString('hex'),
                        amount: amount.is_positive()
                            ? amount.as_positive().to_str()
                            : amount.as_negative().to_str(),
                    });
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
                            'hex'
                        ),
                        outputIndex: parseInt(input.index().toString()),
                        path: keys.payment.path, // needed to include payment key witness if available
                    });
                } else {
                    collateralInputs.push({
                        txHashHex: Buffer.from(input.transaction_id().to_bytes()).toString(
                            'hex'
                        ),
                        outputIndex: parseInt(input.index().toString()),
                    });
                }
                signingMode = TransactionSigningMode.PLUTUS_TRANSACTION;
            }
        }

        let collateralOutput = (() => {
            if (txBody.collateral_return()) {
                const outputs = AsyncLoader.Serialization.TransactionOutputs.new();
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
            const refInputs = txBody.reference_inputs();
            for (let i = 0; i < refInputs.len(); i++) {
                const input = refInputs.get(i);
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
                if (signer === keys.payment.hash) {
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
                protocolMagic: config.network.magic,
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
            includeNetworkId: !!txBody.network_id()
        };

        Object.keys(ledgerTx).forEach(
            (key) => !ledgerTx[key] && ledgerTx[key] != 0 && delete ledgerTx[key]
        );

        const fullTx: SignTransactionRequest = {
            signingMode,
            tx: ledgerTx,
            additionalWitnessPaths,
        };

        Object.keys(fullTx).forEach(
            (key) => !fullTx[key] && fullTx[key] != 0 && delete fullTx[key]
        );

        const foundDevices = await navigator.usb.getDevices();
        const device = foundDevices.find(x => x.productName === 'Nano S' || x.productName === 'Nano S Plus' || x.productName === 'Nano X');
        if (!device) {
            throw new Error('Ledger not found');
        }
        const transport = await TransportWebUSB.open(device);
        const appAda = new Ada(transport);
        const version = await appAda.getVersion(); // check if Ledger has Cardano app opened
        if (!version) {
            throw new Error('Cardano app is close');
        }
        const result = await appAda.signTransaction(fullTx);

        const ledgerKeys = await appAda.getExtendedPublicKeys({
            paths: [[HARDENED + 1852, HARDENED + 1815, HARDENED + 0]],
        });

        // getting public keys
        const witnessSet = AsyncLoader.Serialization.TransactionWitnessSet.new();
        const vkeys = AsyncLoader.Serialization.Vkeywitnesses.new();

        result.witnesses.forEach((witness) => {
                const vkey = AsyncLoader.Serialization.Vkey.new(
                    AsyncLoader.Serialization.Bip32PublicKey.from_bytes(
                        Buffer.from(ledgerKeys[0].publicKeyHex + ledgerKeys[0].chainCodeHex, 'hex')
                    )
                        .derive(witness.path[3])
                        .derive(witness.path[4])
                        .to_raw_key()
                );
                const signature = AsyncLoader.Serialization.Ed25519Signature.from_hex(
                    witness.witnessSignatureHex
                );
                vkeys.add(AsyncLoader.Serialization.Vkeywitness.new(vkey, signature));

        });
        witnessSet.set_vkeys(vkeys);
        if (isDapp) {
            return witnessSet;
        } else {
            const signedTxRaw = AsyncLoader.Serialization.Transaction.new(txBody, witnessSet, txAuxiliaryData);
            const signHash = signedTxRaw.to_bytes();
            return signHash;
        }
    };

    public async txToTrezor(txBody: TransactionBody, index = 0, address: string, usedUtxos: any[], isFromDapp?: boolean): Promise<Uint8Array | TransactionWitnessSet> {

        const trezorPaymentKey = {path: "m/1852'/1815'/0'/0/0", hash: await this.addrToPaymentKeyHash()};
        const trezorStakingKey = {path: "m/1852'/1815'/0'/2/0"};

        let signingMode = CardanoTxSigningMode.ORDINARY_TRANSACTION;

        const inputs = txBody.inputs();
        const trezorInputs: CardanoInput[] = [];
        for (let i = 0; i < inputs.len(); i++) {
            const input = inputs.get(i);
            const uxoInputAddressing = usedUtxos.find(utxo => utxo.tx_hash === Buffer.from(input.transaction_id().to_bytes()).toString('hex')).addressing
            trezorInputs.push({
                prev_hash: Buffer.from(input.transaction_id().to_bytes()).toString('hex'),
                prev_index: input.index(),
                path: `m/1852'/1815'/0'/${uxoInputAddressing.type}/${uxoInputAddressing.path}`
            });
        }

        const outputs = txBody.outputs();
        const trezorOutputs: CardanoOutput[] = [];
        for (let i = 0; i < outputs.len(); i++) {
            const output = outputs.get(i);
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
                            assetNameBytes: Buffer.from(assetName.name()).toString('hex'),
                            amount,
                        });
                    }
                    // sort canonical
                    tokens.sort((a, b) => {
                        if (a.assetNameBytes.length == b.assetNameBytes.length) {
                            return a.assetNameBytes > b.assetNameBytes ? 1 : -1;
                        } else if (a.assetNameBytes.length > b.assetNameBytes.length)
                            return 1;
                        else return -1;
                    });
                    tokenBundle.push({
                        policyId: Buffer.from(policy.to_bytes()).toString('hex'),
                        tokenAmounts: tokens,
                    });
                }
            }
            const outputAddress = isFromDapp ? output.address().to_bech32() : Buffer.from(output.address().to_bytes()).toString(
                'hex'
            );
            const destination =
                outputAddress == address
                    ? {
                        addressParameters: {
                            addressType: CardanoAddressType.BASE,
                            path: `m/1852'/1815'/${index}'/0/0`,
                            stakingPath: `m/1852'/1815'/${index}'/2/0`,
                        },
                    }
                    : {
                        address: output.address().to_bech32(),
                    };
            const datumHash = output.data_hash()
                ? Buffer.from(output.data_hash().to_bytes()).toString('hex')
                : null;
            const outputRes = {
                amount: output.amount().coin().to_str(),
                tokenBundle,
                datumHash,
                ...destination,
            };
            if (!tokenBundle) delete outputRes.tokenBundle;
            if (!datumHash) delete outputRes.datumHash;
            trezorOutputs.push(outputRes);
        }

        let trezorCertificates: CardanoCertificate[] = null;
        const certificates = txBody.certs();
        if (certificates) {
            trezorCertificates = [];
            for (let i = 0; i < certificates.len(); i++) {
                const cert = certificates.get(i);
                //initialize with null
                let certificate: CardanoCertificate = {type: null};
                if (cert.kind() === 0) {
                    const credential = cert.as_stake_registration().stake_credential();
                    certificate.type = CardanoCertificateType.STAKE_REGISTRATION;
                    if (credential.kind() === 0) {
                        certificate.path = trezorStakingKey.path;
                    } else {
                        const scriptHash = Buffer.from(
                            credential.to_scripthash().to_bytes()
                        ).toString('hex');
                        certificate.scriptHash = scriptHash;
                    }
                } else if (cert.kind() === 1) {
                    const credential = cert.as_stake_deregistration().stake_credential();
                    certificate.type = CardanoCertificateType.STAKE_DEREGISTRATION;
                    if (credential.kind() === 0) {
                        certificate.path = trezorStakingKey.path;
                    } else {
                        const scriptHash = Buffer.from(
                            credential.to_scripthash().to_bytes()
                        ).toString('hex');
                        certificate.scriptHash = scriptHash;
                    }
                } else if (cert.kind() === 2) {
                    const delegation = cert.as_stake_delegation();
                    const credential = delegation.stake_credential();
                    const poolKeyHashHex = Buffer.from(
                        delegation.pool_keyhash().to_bytes()
                    ).toString('hex');
                    certificate.type = CardanoCertificateType.STAKE_DELEGATION;
                    if (credential.kind() === 0) {
                        certificate.path = trezorStakingKey.path;
                    } else {
                        const scriptHash = Buffer.from(
                            credential.to_scripthash().to_bytes()
                        ).toString('hex');
                        certificate.scriptHash = scriptHash;
                    }
                    certificate.pool = poolKeyHashHex;
                } else if (cert.kind() === 3) {
                    const params = cert.as_pool_registration().pool_params();
                    certificate.type = CardanoCertificateType.STAKE_POOL_REGISTRATION;
                    const owners = params.pool_owners();
                    const poolOwners = [];
                    for (let i = 0; i < owners.len(); i++) {
                        const keyHash = Buffer.from(owners.get(i).to_bytes()).toString('hex');
                        const walletStakeHash = await this.addrToStakeKeyHash();
                        if (keyHash === walletStakeHash) {
                            signingMode = CardanoTxSigningMode.POOL_REGISTRATION_AS_OWNER;
                            poolOwners.push({
                                stakingKeyPath: trezorStakingKey.path,
                            });
                        } else {
                            poolOwners.push({
                                stakingKeyHash: keyHash,
                            });
                        }
                    }
                    const relays = params.relays();
                    const trezorRelays = [];
                    for (let i = 0; i < relays.len(); i++) {
                        const relay = relays.get(i);
                        if (relay.kind() === 0) {
                            const singleHostAddr = relay.as_single_host_addr();
                            const type = CardanoPoolRelayType.SINGLE_HOST_IP;
                            const port = singleHostAddr.port();
                            const ipv4Address = singleHostAddr.ipv4()
                                ? this.bytesToIp(singleHostAddr.ipv4().ip())
                                : null;
                            const ipv6Address = singleHostAddr.ipv6()
                                ? this.bytesToIp(singleHostAddr.ipv6().ip())
                                : null;
                            trezorRelays.push({type, port, ipv4Address, ipv6Address});
                        } else if (relay.kind() === 1) {
                            const type = CardanoPoolRelayType.SINGLE_HOST_NAME;
                            const singleHostName = relay.as_single_host_name();
                            const port = singleHostName.port();
                            const hostName = singleHostName.dns_name().record();
                            trezorRelays.push({
                                type,
                                port,
                                hostName,
                            });
                        } else if (relay.kind() === 2) {
                            const type = CardanoPoolRelayType.MULTIPLE_HOST_NAME;
                            const multiHostName = relay.as_multi_host_name();
                            const hostName = multiHostName.dns_name();
                            trezorRelays.push({
                                type,
                                hostName,
                            });
                        }
                    }
                    const cost = params.cost().to_str();
                    const margin = params.margin();
                    const pledge = params.pledge().to_str();
                    const poolId = Buffer.from(params.operator().to_bytes()).toString(
                        'hex'
                    );
                    const metadata = params.pool_metadata()
                        ? {
                            url: params.pool_metadata().url().url(),
                            hash: Buffer.from(
                                params.pool_metadata().pool_metadata_hash().to_bytes()
                            ).toString('hex'),
                        }
                        : null;
                    const rewardAccount = params.reward_account().to_address().to_bech32();
                    const vrfKeyHash = Buffer.from(
                        params.vrf_keyhash().to_bytes()
                    ).toString('hex');

                    certificate.poolParameters = {
                        poolId,
                        vrfKeyHash,
                        pledge,
                        cost,
                        margin: {
                            numerator: margin.numerator().to_str(),
                            denominator: margin.denominator().to_str(),
                        },
                        rewardAccount,
                        owners: poolOwners,
                        relays: trezorRelays,
                        metadata,
                    };
                }
                trezorCertificates.push(certificate);
            }
        }
        const fee = txBody.fee().to_str();
        const ttl = txBody.ttl();
        const withdrawals = txBody.withdrawals();
        let trezorWithdrawals: CardanoWithdrawal[] = null;
        if (withdrawals) {
            trezorWithdrawals = [];
            for (let i = 0; i < withdrawals.keys().len(); i++) {
                const rewardAddress = withdrawals.keys().get(i);
                let withdrawal: CardanoWithdrawal = {
                    amount: withdrawals.get(rewardAddress).to_str()
                };
                if (rewardAddress.payment_cred().kind() === 0) {
                    withdrawal.path = trezorStakingKey.path;
                } else {
                    withdrawal.scriptHash = Buffer.from(
                        rewardAddress.payment_cred().to_scripthash().to_bytes()
                    ).toString('hex');
                }
                withdrawal.amount = withdrawals.get(rewardAddress).to_str();
                trezorWithdrawals.push(withdrawal);
            }
        }
        const auxiliaryData: CardanoAuxiliaryData = txBody.auxiliary_data_hash()
            ? {
                hash: Buffer.from(txBody.auxiliary_data_hash().to_bytes()).toString(
                    'hex'
                ),
            }
            : null;
        const validityStartInterval = txBody.validity_start_interval();

        const mint = txBody.mint();
        let additionalWitnessRequests = null;
        let mintBundle = null;
        if (mint) {
            mintBundle = [];
            for (let j = 0; j < mint.keys().len(); j++) {
                const policy = mint.keys().get(j);
                const assets = mint.get(policy);
                const tokens = [];
                for (let k = 0; k < assets.keys().len(); k++) {
                    const assetName = assets.keys().get(k);
                    const amount = assets.get(assetName);
                    tokens.push({
                        assetNameBytes: Buffer.from(assetName.name()).toString('hex'),
                        mintAmount: amount.is_positive()
                            ? amount.as_positive().to_str()
                            : amount.as_negative().to_str(),
                    });
                }
                // sort canonical
                tokens.sort((a, b) => {
                    if (a.assetNameBytes.length == b.assetNameBytes.length) {
                        return a.assetNameBytes > b.assetNameBytes ? 1 : -1;
                    } else if (a.assetNameBytes.length > b.assetNameBytes.length) return 1;
                    else return -1;
                });
                mintBundle.push({
                    policyId: Buffer.from(policy.to_bytes()).toString('hex'),
                    tokenAmounts: tokens,
                });
            }
            additionalWitnessRequests = [];
            if (trezorPaymentKey.path) additionalWitnessRequests.push(trezorPaymentKey.path);
            if (trezorStakingKey.path) additionalWitnessRequests.push(trezorStakingKey.path);
        }


        // Plutus
        const scriptDataHash = txBody.script_data_hash()
            ? Buffer.from(txBody.script_data_hash().to_bytes()).toString('hex')
            : null;

        let collateralInputs = null;
        if (txBody.collateral()) {
            collateralInputs = [];
            const collateraInputs = txBody.collateral();
            for (let i = 0; i < collateraInputs.len(); i++) {
                const input = collateraInputs.get(i);
                if (trezorPaymentKey.path) {
                    collateralInputs.push({
                        prev_hash: Buffer.from(input.transaction_id().to_bytes()).toString(
                            'hex'
                        ),
                        prev_index: input.index(),
                        path: trezorPaymentKey.path, // needed to include payment key witness if available
                    });
                } else {
                    collateralInputs.push({
                        prev_hash: Buffer.from(input.transaction_id().to_bytes()).toString(
                            'hex'
                        ),
                        prev_index: input.index(),
                    });
                }
                signingMode = CardanoTxSigningMode.PLUTUS_TRANSACTION;
            }
        }

        let requiredSigners: CardanoRequiredSigner[] = null;
        if (txBody.required_signers()) {
            requiredSigners = [];
            const r = txBody.required_signers();
            for (let i = 0; i < r.len(); i++) {
                const signer = Buffer.from(r.get(i).to_bytes()).toString('hex');
                if (signer === trezorPaymentKey.hash) {
                    requiredSigners.push({
                        keyPath: trezorPaymentKey.path,
                    });
                } else {
                    requiredSigners.push({
                        keyHash: signer,
                    });
                }
            }
            signingMode = CardanoTxSigningMode.PLUTUS_TRANSACTION;
        }

        const trezorTx: CardanoSignTransaction = {
            signingMode,
            inputs: trezorInputs,
            outputs: trezorOutputs,
            fee,
            ttl: ttl ? ttl.toString() : null,
            certificates: trezorCertificates,
            withdrawals: trezorWithdrawals,
            auxiliaryData,
            mint: mintBundle,
            scriptDataHash,
            collateralInputs,
            requiredSigners,
            protocolMagic: config.network.magic, //we should revert to native Trezor's protocolMagic in case of TXSign error
            networkId: config.network.id, //we should revert to native Trezor's networkId in case of TXSign error
            additionalWitnessRequests,
            validityIntervalStart: validityStartInterval
                ? validityStartInterval.toString()
                : undefined
        };
        Object.keys(trezorTx).forEach(
            (key) => !trezorTx[key] && trezorTx[key] != 0 && delete trezorTx[key]
        );

        const result = await TrezorConnect.cardanoSignTransaction(trezorTx);
        if (!result.success) {
            throw new Error(`Trezor could not sign tx. Code: ${(result as Unsuccessful).payload?.code}, Error:${(result as Unsuccessful).payload?.error}`);
        }

        const witnessSet = AsyncLoader.Serialization.TransactionWitnessSet.new();
        const vkeys = AsyncLoader.Serialization.Vkeywitnesses.new();

        result.payload.witnesses.forEach((witness) => {
            const vkey = AsyncLoader.Serialization.Vkey.new(
                AsyncLoader.Serialization.PublicKey.from_bytes(Buffer.from(witness.pubKey, 'hex'))
            );
            const signature = AsyncLoader.Serialization.Ed25519Signature.from_hex(
                witness.signature
            );
            vkeys.add(AsyncLoader.Serialization.Vkeywitness.new(vkey, signature));
        });
        witnessSet.set_vkeys(vkeys);

        if (isFromDapp) {
            return witnessSet;
        } else {
            const signedTxRaw = AsyncLoader.Serialization.Transaction.new(txBody, witnessSet);
            const signHash = signedTxRaw.to_bytes();

            return signHash;
        }

    };

    private async addrToPaymentKeyHash(): Promise<string> {
        const conceptualWalletId = localStorage.getItem('conceptualWalletId');
        if (!conceptualWalletId || !(await this.conceptualWalletService.exists(+conceptualWalletId))) {
            throw new Error('No conceptualWalletId in localStorage during delegation certs');
        }
        const baseAddr = await db.address.where({conceptualWalletId: +conceptualWalletId, type: 1}).toArray();

        const bs = AsyncLoader.Serialization.BaseAddress.from_address(
            AsyncLoader.Serialization.Address.from_bytes(Buffer.from(baseAddr[0].hash, 'hex'))
        )
            .payment_cred()
            .to_keyhash();

        return Buffer.from(bs.to_bytes()).toString('hex');
    }

    private async addrToStakeKeyHash(): Promise<string> {
        const conceptualWalletId = localStorage.getItem('conceptualWalletId');
        if (!conceptualWalletId || !(await this.conceptualWalletService.exists(+conceptualWalletId))) {
            throw new Error('No conceptualWalletId in localStorage during delegation certs');
        }
        const stakingHash = await db.address.where({conceptualWalletId: +conceptualWalletId, type: 4}).toArray();

        const skh = AsyncLoader.Serialization.RewardAddress.from_address(
            AsyncLoader.Serialization.Address.from_bytes(Buffer.from(stakingHash[0].hash, 'hex'))
        )
            .payment_cred()
            .to_keyhash();

        return Buffer.from(skh.to_bytes()).toString('hex');
    }

    private async initWallet(): Promise<void> {
        try {
            await TrezorConnect.init({
                lazyLoad: true,
                popup: true,
                env: 'webextension',
                extension: 'GeroWallet',
                webusb: true,
                manifest: {
                    email: 'chris@gerowallet.io',
                    appUrl: 'https://www.gerowallet.io/#'
                },
            });
        } catch (e) {
            throw new Error(`Can not init Trezor ${e}`)
        }
    }

    private bytesToIp(bytes) {
        if (!bytes) return null;
        if (bytes.length === 4) {
            return {ipv4: bytes.join('.')};
        } else if (bytes.length === 16) {
            let ipv6 = '';
            for (let i = 0; i < bytes.length; i += 2) {
                ipv6 += bytes[i].toString(16) + bytes[i + 1].toString(16) + ':';
            }
            ipv6 = ipv6.slice(0, -1);
            return {ipv6};
        }
        return null;
    }

    private outputsToLedger(outputs: TransactionOutputs, address, index, checkDatum = true): TxOutput[] {
        const ledgerOutputs = [];
        for (let i = 0; i < outputs.len(); i++) {
            const output = outputs.get(i);
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
                    tokens.sort((a, b) => {
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

            const outputAddress = Buffer.from(output.address().to_bytes()).toString(
                'hex'
            );
            const destination: TxOutputDestination =
                output.address().to_bech32() !== address
                    ? {
                        type: TxOutputDestinationType.DEVICE_OWNED,
                        params: {
                            type: AddressType.BASE_PAYMENT_KEY_STAKE_KEY,
                            params: {
                                spendingPath: [
                                    HARDENED + 1852,
                                    HARDENED + 1815,
                                    HARDENED + index,
                                    0,
                                    0,
                                ],
                                stakingPath: [
                                    HARDENED + 1852,
                                    HARDENED + 1815,
                                    HARDENED + index,
                                    2,
                                    0,
                                ],
                            },
                        },
                    }
                    : {
                        type: TxOutputDestinationType.THIRD_PARTY,
                        params: {
                            addressHex: outputAddress,
                        },
                    };
            const datum = checkDatum ? (output as any)?.datum() : null;
            let outputRes: TxOutput = {
                amount: output.amount().coin().to_str(),
                tokenBundle,
                destination,
                datumHashHex:
                    datum && datum.kind() === 0
                        ? Buffer.from(datum.as_data_hash().to_bytes()).toString('hex')
                        : null,
            };
            //that is deleting the format property, that's why we add it in the next line
            Object.keys(outputRes).forEach((key) => {
                if (!outputRes[key]) delete outputRes[key];
            });
            //TODO: this is hardcoded until we implement babbage utxos
            outputRes.format = TxOutputFormat.ARRAY_LEGACY
            ledgerOutputs.push(outputRes);
        }
        return ledgerOutputs;
    };
}
