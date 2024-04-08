import BigNumber from 'bignumber.js';
import { db } from '../database/GeroWalletDatabase';
import { DEFAULT_TTL } from '../constants';
import { AddressUtxoResponse, DelegationType, TransactionBuildRequest } from '../shared/types';
import { Buffer } from 'buffer';
import { WalletAddressesService } from '../shared/wallet-addresses.service';
import { PasswordCipher } from './PasswordCipher';
import { AsyncLoader } from '../shared/AsyncLoader';
import { IKey } from '../database/models/Key';
import { ConceptualWalletService } from '../api/conceptual-wallet.service';
import { autoInjectable, singleton } from 'tsyringe';
import { UtxosService } from './utxos.service';
import { BaseConfig } from '../database/models/Network';
import { Certificate, TransactionBuilder, Value, TransactionBody } from '@emurgo/cardano-serialization-lib-browser';
import { AddressService } from './address.service';
import { EncodingService } from './encoding.service';

interface Withdrawal {
    address: string;
    amount: string;
}

@singleton()
@autoInjectable()
export class SendNewTransactionService {
    constructor(
        private utxoService: UtxosService,
        private conceptualWalletService?: ConceptualWalletService,
        private walletAddressesService?: WalletAddressesService,
        private passwordCipher?: PasswordCipher,
        private addressService?: AddressService,
        private encodingService?: EncodingService
    ) {}

    public async generateDelegationCerts(type: DelegationType, poolId) {
        const conceptualWalletId = localStorage.getItem('conceptualWalletId');
        if (!conceptualWalletId || !(await this.conceptualWalletService.exists(+conceptualWalletId))) {
            throw new Error('No conceptualWalletId in localStorage during delegation certs');
        }
        const keys = await db.key.where({ conceptualWalletId: +conceptualWalletId }).toArray();
        const publicKeyBech32 = keys.find((key) => !key.isEncrypted);

        try {
            const publicKey = AsyncLoader.Serialization.Bip32PublicKey.from_bech32(publicKeyBech32.hash);
            const stakeKey = publicKey
                .derive(2) // chimeric
                .derive(0);

            const certificates = [];

            if (type === DelegationType.RegistrationAndStaking) {
                const registrationCertificate = AsyncLoader.Serialization.Certificate.new_stake_registration(
                    AsyncLoader.Serialization.StakeRegistration.new(
                        AsyncLoader.Serialization.StakeCredential.from_keyhash(stakeKey.to_raw_key().hash()),
                    ),
                );
                certificates.push(registrationCertificate);
            }
            const delegationCertificate = AsyncLoader.Serialization.Certificate.new_stake_delegation(
                AsyncLoader.Serialization.StakeDelegation.new(
                    AsyncLoader.Serialization.StakeCredential.from_keyhash(stakeKey.to_raw_key().hash()),
                    AsyncLoader.Serialization.Ed25519KeyHash.from_bech32(poolId),
                ),
            );
            certificates.push(delegationCertificate);
            return certificates;
        } catch (error) {
            return false;
        }
    }

    public async generateDeregistrationCerts() {
        const conceptualWalletId = localStorage.getItem('conceptualWalletId');
        if (!conceptualWalletId || !(await this.conceptualWalletService.exists(+conceptualWalletId))) {
            throw new Error('No conceptualWalletId in localStorage during delegation certs');
        }
        const keys = await db.key.where({ conceptualWalletId: +conceptualWalletId }).toArray();
        const publicKeyBech32 = keys.find((key) => !key.isEncrypted);

        try {
            const publicKey = AsyncLoader.Serialization.Bip32PublicKey.from_bech32(publicKeyBech32.hash);
            const stakeKey = publicKey
                .derive(2) // chimeric
                .derive(0);

            const certificates = [];

            const deregistrationCertificate = AsyncLoader.Serialization.Certificate.new_stake_deregistration(
                AsyncLoader.Serialization.StakeDeregistration.new(
                    AsyncLoader.Serialization.StakeCredential.from_keyhash(stakeKey.to_raw_key().hash()),
                ),
            );
            certificates.push(deregistrationCertificate);
            return certificates;
        } catch (error) {
            return false;
        }
    }

    private async getWalletUtxos(utxos: AddressUtxoResponse[], walletId: string) {
        const tmpAddresses = await this.walletAddressesService.getAccountAddressesWithShift('all', utxos, +walletId);
        return utxos ? utxos.map((utxo) => {
            const formattedUtxo = {
                ...utxo,
                addressing: tmpAddresses.paths[utxo.receiver],
            };
            formattedUtxo['tokens'] = formattedUtxo.assets.map((token) => ({
                asset: token,
                quantity: token.amount,
            }));
            return formattedUtxo;
        }): [];
    }

    private initTransactionBuilder(protocolParams: BaseConfig): TransactionBuilder {
        const txConfig = AsyncLoader.Serialization.TransactionBuilderConfigBuilder.new()
        .fee_algo(
            AsyncLoader.Serialization.LinearFee.new(
                AsyncLoader.Serialization.BigNum.from_str(protocolParams.linearFee.coefficient),
                AsyncLoader.Serialization.BigNum.from_str(protocolParams.linearFee.constant)
            )
        )
        .pool_deposit(AsyncLoader.Serialization.BigNum.from_str(protocolParams.poolDeposit))
        .key_deposit(AsyncLoader.Serialization.BigNum.from_str(protocolParams.keyDeposit))
        // NOTE: issue when using coins_per_utxo_byte
        .coins_per_utxo_word(AsyncLoader.Serialization.BigNum.from_str('34482')) // TODO: use network protocol instead
        .max_value_size(5000)
        .max_tx_size(16384)
        .ex_unit_prices(AsyncLoader.Serialization.ExUnitPrices.new(
            AsyncLoader.Serialization.UnitInterval.new(
                AsyncLoader.Serialization.BigNum.from_str('577'),
                AsyncLoader.Serialization.BigNum.from_str('10000')
            ),
            AsyncLoader.Serialization.UnitInterval.new(
                AsyncLoader.Serialization.BigNum.from_str('721'),
                AsyncLoader.Serialization.BigNum.from_str('10000000')
            )
        ))
        .prefer_pure_change(true)
        .build();

        const txBuilder = AsyncLoader.Serialization.TransactionBuilder.new(
            txConfig
        );

        return txBuilder;
    }

    private addCertificates(txBuilder: TransactionBuilder, certificates: Certificate[]) {
        if (certificates.length > 0) {
            const certsArray = certificates.reduce((certs, cert) => {
                certs.add(cert);
                return certs;
            }, AsyncLoader.Serialization.Certificates.new());
            txBuilder.set_certs(certsArray);
        }
    }

    private addWithdrawals(txBuilder: TransactionBuilder, withdrawals: Withdrawal[]) {
        if (withdrawals.length > 0) {
            const processed = withdrawals.map((withdrawal) => {
                const address = AsyncLoader.Serialization.Address.from_bech32(withdrawal.address);
                return {
                    address: AsyncLoader.Serialization.RewardAddress.from_address(address),
                    amount: AsyncLoader.Serialization.BigNum.from_str(withdrawal.amount),
                };
            });

            const withdrawalArray = processed.reduce((withs, withdrawal) => {
                withs.insert(withdrawal.address, withdrawal.amount);
                return withs;
            }, AsyncLoader.Serialization.Withdrawals.new());
            txBuilder.set_withdrawals(withdrawalArray);
        }
    }

    private cardanoValueFromTokens(value, tokens = []) {
        let cardanoValue = AsyncLoader.Serialization.Value.new(AsyncLoader.Serialization.BigNum.from_str(value));
        if (!tokens || tokens?.length === 0) {
            return cardanoValue;
        } else {
            const assets = AsyncLoader.Serialization.MultiAsset.new();
            tokens.forEach((token) => {
                const policyId = AsyncLoader.Serialization.ScriptHash.from_bytes(
                    Buffer.from(token.asset.policyId, 'hex'),
                );
                const assetName = AsyncLoader.Serialization.AssetName.new(
                    Buffer.from(token.asset.assetName || '', 'hex'),
                );
                const quantity = AsyncLoader.Serialization.BigNum.from_str(token.quantity);

                const asset = assets.get(policyId) ?? AsyncLoader.Serialization.Assets.new();

                asset.insert(assetName, quantity);
                assets.insert(policyId, asset);
            });

            if (assets.len() > 0) {
                cardanoValue.set_multiasset(assets);
            }
            return cardanoValue;
        }
    }

    private addOutputs(txBuilder: TransactionBuilder, outputs: TransactionBuildRequest[]): number {
        let minAdaRequired = 0;
        outputs.forEach((output) => {
            const { transactionOutput, minAda } = this.calculateOutputsMinAda(output)
            minAdaRequired += Number(minAda);
            txBuilder.add_output(transactionOutput);
        });
        return minAdaRequired;
    }

    public calculateOutputsMinAda(output: TransactionBuildRequest) {
        const receiverAddress = this.addressService.normalizeToAddress(output.address);
        if (!receiverAddress) {
            throw new Error('Receiver Address is not supported');
        }
        const cardanoValue = this.cardanoValueFromTokens(output.value, output.tokens ?? null);
        const transactionOutput = AsyncLoader.Serialization.TransactionOutput.new(
            receiverAddress,
            cardanoValue
        );
        const minAda = AsyncLoader.Serialization.min_ada_for_output(transactionOutput, AsyncLoader.Serialization.DataCost.new_coins_per_word(AsyncLoader.Serialization.BigNum.from_str('34482'))).to_str();
        return {
            transactionOutput,
            minAda
        }
    }

    private addInputUtxos(
        txBuilder: TransactionBuilder,
        utxos: AddressUtxoResponse[],
        outputs: TransactionBuildRequest[],
        useAllUtxos = false
    ) {
        const utxosCIP  = AsyncLoader.Serialization.TransactionUnspentOutputs.new();
        utxos.map((utxo) => {
            utxosCIP.add(AsyncLoader.Serialization.TransactionUnspentOutput.new(
                AsyncLoader.Serialization.TransactionInput.new(
                    AsyncLoader.Serialization.TransactionHash.from_bytes(Buffer.from(utxo.tx_hash, 'hex')),
                    utxo.tx_index,
                ),
                AsyncLoader.Serialization.TransactionOutput.new(
                    AsyncLoader.Serialization.Address.from_bech32(utxo.receiver),
                    this.cardanoValueFromRemoteFormat(utxo),
                ),
            ))}
        );
        if (!useAllUtxos) {
            const strategy = this.outputHasAssets(outputs) ?
            AsyncLoader.Serialization.CoinSelectionStrategyCIP2.RandomImproveMultiAsset : AsyncLoader.Serialization.CoinSelectionStrategyCIP2.RandomImprove;
            txBuilder.add_inputs_from(utxosCIP, strategy);
        } else {
            this.useAllUtxos(txBuilder, utxos);
        }
    }

    private useAllUtxos(
        txBuilder: TransactionBuilder,
        utxos: AddressUtxoResponse[]
    ) {
        // NOTE: issues on staking (calculating proper fee) whehn using the following example
        // let inputBuilder = TxInputsBuilder.new();
        // inputBuilder.add_input(address, input, value);
        // txBuilder.set_inputs(inputBuilder);
        utxos.forEach(utxo => {
            txBuilder.add_input(
                AsyncLoader.Serialization.Address.from_bech32(utxo.receiver),
                AsyncLoader.Serialization.TransactionInput.new(
                    AsyncLoader.Serialization.TransactionHash.from_bytes(Buffer.from(utxo.tx_hash, 'hex')),
                    utxo.tx_index,
                ),
                this.cardanoValueFromRemoteFormat(utxo)
            );
        });
    }

    private outputHasAssets(outputs: TransactionBuildRequest[]) {
        if (outputs?.length > 0) {
            const assets = outputs.filter(output => output.tokens?.length > 0);
            return assets?.length > 0;
        }
        return false;
    }

    private estimateChangeAmount(
        txBuilder: TransactionBuilder,
        utxos: AddressUtxoResponse[],
        changeAddress: string
    ) {
        let changeAmount = 0;
        const implicitSum = txBuilder.get_implicit_input();
        // output excluding fee
        const targetOutput = txBuilder
            .get_explicit_output()
            .checked_add(AsyncLoader.Serialization.Value.new(txBuilder.get_deposit()));

        for (const utxo of utxos) {
            const currentInputSum = txBuilder.get_explicit_input().checked_add(implicitSum);

            const tx = txBuilder.min_fee();
            const serial = AsyncLoader.Serialization.Value.new(tx);
            const output = targetOutput.checked_add(serial);

            // update amount required to make sure we have ADA required for change UTXO entry
            if (changeAddress == null) {
                throw new Error('no outputs');
            }

            const difference = currentInputSum.clamped_sub(output);

            const minimumNeededForChange = this.minRequiredForChange(
                txBuilder,
                changeAddress,
                difference,
            );
            const adaNeededLeftForChange = minimumNeededForChange.clamped_sub(difference.coin());

            if (changeAmount < +adaNeededLeftForChange.to_str()) {
                changeAmount = +adaNeededLeftForChange.to_str();
            }
        }
        return changeAmount;
    }

    private minRequiredForChange(txBuilder, address, value: Value) {
        const output =  AsyncLoader.Serialization.TransactionOutput.new(
            AsyncLoader.Serialization.Address.from_bech32(address),
            value,
        );

        const minimumAda = AsyncLoader.Serialization.min_ada_for_output(
            output, AsyncLoader.Serialization.DataCost.new_coins_per_word(AsyncLoader.Serialization.BigNum.from_str('34482'))
        );

        const baseValue = (() => {
            if (value.coin().compare(minimumAda) < 0) {
                const newVal = AsyncLoader.Serialization.Value.new(minimumAda);
                const assets = value.multiasset();
                if (assets) {
                    newVal.set_multiasset(assets);
                }
                return newVal;
            }
            return value;
        })();

        const minRequired = txBuilder
            .fee_for_output(
                AsyncLoader.Serialization.TransactionOutput.new(
                    AsyncLoader.Serialization.Address.from_bech32(address),
                    baseValue,
                ),
            )
            .checked_add(minimumAda);

        return minRequired;
    }

    public async getMaxAmount(
        outputs: TransactionBuildRequest[]
    ) {
        const network = await db.network.toArray();

        const conceptualWalletId = localStorage.getItem('conceptualWalletId');
        if (!conceptualWalletId || !(await this.conceptualWalletService.exists(+conceptualWalletId))) {
            throw new Error('No active wallet.js in localstorage during building TX');
        }
        const utxos = await this.utxoService.getUtxosResponse();

        const protocolParams = network[0].baseConfig[0];
        const changeAddress = await this.walletAddressesService.getMainAddress(+conceptualWalletId);

        try {
            // initial checks for errors
            for (const output of outputs) {
                if (new BigNumber(output.value).isNaN()) {
                    throw new Error('Ada value not number');
                }

                if (new BigNumber(output.value).lt(new BigNumber(protocolParams.minimumUtxoValue))) {
                    throw new Error('ada value is less than minimum available');
                }

                if (new BigNumber(output.value).decimalPlaces() > 6) {
                    throw new Error('ada wrong value');
                }
            }
            // create transaction
            const txBuilder = this.initTransactionBuilder(protocolParams);

            // add outputs
            this.addOutputs(txBuilder, outputs);

            // add utxos to the transaction as inputs
            this.addInputUtxos(txBuilder, utxos, outputs, true);

            const implicitSum = txBuilder.get_implicit_input();
            const currentInputSum = txBuilder.get_explicit_input().checked_add(implicitSum);
            const minimumFee = AsyncLoader.Serialization.Value.new(txBuilder.min_fee());
            const maxAmount = currentInputSum.checked_sub(minimumFee);
            const txOutput = AsyncLoader.Serialization.TransactionOutput.new(
                AsyncLoader.Serialization.Address.from_bech32(changeAddress),
                currentInputSum,
            );
            const extraAda = AsyncLoader.Serialization.Value.new(AsyncLoader.Serialization.min_ada_for_output(
                txOutput, AsyncLoader.Serialization.DataCost.new_coins_per_word(AsyncLoader.Serialization.BigNum.from_str('34482'))
            ));
            const changeAmount = this.estimateChangeAmount(txBuilder, utxos, changeAddress);

            return {
                data: {
                    max_amount: +maxAmount.checked_sub(extraAda).coin().to_str() - changeAmount,
                },
            };
        } catch (error) {
            throw new Error(`error on max amount ${error}`);
        }
    }

    public async buildTransaction(
        outputs: TransactionBuildRequest[],
        metadata = undefined,
        certificates: Certificate[] = [],
        withdrawals: Withdrawal[] = []
    ) {
        const network = await db.network.toArray();
        const conceptualWalletId = localStorage.getItem('conceptualWalletId');
        if (!conceptualWalletId || !(await this.conceptualWalletService.exists(+conceptualWalletId))) {
            throw new Error('No active wallet.js in localstorage during building TX');
        }
        const utxos = await this.utxoService.getUtxosResponse();

        const walletUtxos = await this.getWalletUtxos(utxos, conceptualWalletId);
        const protocolParams = network[0].baseConfig[0];
        const changeAddress = await this.walletAddressesService.getMainAddress(+conceptualWalletId);

        const lastSyncInfo = await db.lastSyncInfo.toArray();
        const currentSlot = lastSyncInfo[0].genesis_slot;
        try {
            // initial checks for errors
            for (const output of outputs) {
                if (new BigNumber(output.value).isNaN()) {
                    throw new Error('Ada value not number');
                }

                if (new BigNumber(output.value).decimalPlaces() > 6) {
                    throw new Error('ada wrong value');
                }
            }

            // create transaction
            const txBuilder = this.initTransactionBuilder(protocolParams);

            const hasMetadata = !(metadata == null || metadata === undefined);

            // add certificates
            this.addCertificates(txBuilder, certificates);

            // add withdrawal
            this.addWithdrawals(txBuilder, withdrawals);

            // add metadata
            if (hasMetadata) {
                txBuilder.set_auxiliary_data(metadata);
            }

            // set ttl
            const ttlValue = currentSlot + DEFAULT_TTL;
            txBuilder.set_ttl_bignum(AsyncLoader.Serialization.BigNum.from_str(ttlValue.toString()));

            // add outputs
            const minAdaRequired = this.addOutputs(txBuilder, outputs);
          
            // add utxos to the transaction as inputs
            const shouldUseAllUtxos = certificates.length > 0 || withdrawals.length > 0;
            try {
                this.addInputUtxos(txBuilder, utxos, outputs, shouldUseAllUtxos);
                const calcChangeAddress = AsyncLoader.Serialization.Address.from_bech32(changeAddress);
                txBuilder.add_change_if_needed(calcChangeAddress);
            }
            catch (e: unknown) {
                const error = e as string;
                if (this.isNotEnoughBalanceError(error) && !shouldUseAllUtxos) {
                    this.addInputUtxos(txBuilder, utxos, outputs, true);
                    const calcChangeAddress = AsyncLoader.Serialization.Address.from_bech32(changeAddress);
                    txBuilder.add_change_if_needed(calcChangeAddress);
                }
            }
            // tx build
            const txBody = txBuilder.build();

            const usedUtxos = [];
            for (let i=0; i <txBody.inputs().len(); i++) {
                const txIndex = txBody.inputs().get(i).index();
                const txHash = Buffer.from(txBody.inputs().get(i).transaction_id().to_bytes()).toString('hex');

                const usedUtxo = walletUtxos.find(utxo => utxo.tx_hash === txHash && utxo.tx_index === txIndex);
                if (usedUtxo) {
                    usedUtxos.push(usedUtxo);
                }
            }

            let spendingValue;
            if (this.outputHasAssets(outputs)) {
                spendingValue = txBuilder.get_fee_if_set().to_str()
            } else if (outputs && outputs.length > 0 && outputs[0].value) {
                spendingValue = outputs[0].value
            } else {
                spendingValue = txBuilder
                    .get_explicit_output()
                    .checked_add(AsyncLoader.Serialization.Value.new(txBuilder.get_deposit()))
                    .checked_sub(AsyncLoader.Serialization.Value.new(txBuilder.min_fee()));
            }

            const txHash = AsyncLoader.Serialization.hash_transaction(txBody);
            const txInfo = {
                data: {
                    txBody,
                    txHash,
                    txBodyHex: Buffer.from(txBody.to_bytes()).toString('hex'),
                    txHashHex: Buffer.from(txHash.to_bytes()).toString('hex'),
                    minFee: txBuilder.min_fee().to_str(),
                    fee: txBuilder.get_fee_if_set().to_str(),
                    spending: {
                        send: spendingValue,
                        minimumAdaFee: this.getMinimumAdaFee(outputs, txBody)
                    },
                    minAdaRequired,
                    outputs,
                    usedUtxos,
                    metadata,
                    certificates,
                    withdrawals,
                    ttl: currentSlot + DEFAULT_TTL,
                }
            }  
            return txInfo;
        } catch (error) {
            throw new Error(`error while build ${error}`);
        }
    }

    private getMinimumAdaFee(outputs: Readonly<TransactionBuildRequest>[], txBody: Readonly<TransactionBody>): string {
        if (outputs.length === 0) {
            return '0';
        }
        
        const { value, tokens } = outputs[0];

        if (value && tokens?.length === 0) {
            return '0';
        }

        return txBody.outputs().get(0).amount().coin().to_str();
    }

    public async getPrivateKey(password: string) {
        const conceptualWalletId = localStorage.getItem('conceptualWalletId');
        const keys = await db.key.where({ conceptualWalletId: +conceptualWalletId }).toArray();

        const encrypted = keys.filter((key) => key.isEncrypted);
        if (!encrypted || encrypted.length === 0) {
            return undefined;
        }
        for (let i = 0; i < encrypted.length; i++) {
            const key = encrypted[i];
            const result = this.encodingService.decode(key.hash, password);
            if (result !== undefined) {
                return result;
            }
        }
        return undefined;
    }

    public async txSign(transaction, password: string): Promise<Uint8Array> {
        const conceptualWalletId = localStorage.getItem('conceptualWalletId');
        if (!conceptualWalletId || !(await this.conceptualWalletService.exists(+conceptualWalletId))) {
            throw new Error('No conceptualWallet during signing');
        }
        try {
            const { txHash, txBody, metadata, usedUtxos, certificates, withdrawals } = transaction;

            const vkeyWitnesses = AsyncLoader.Serialization.Vkeywitnesses.new();
            const deduped = [];
            const keyHashes = [];
            usedUtxos.forEach((senderUtxo: AddressUtxoResponse) => {
                const keyHash = this.addressService.getPaymentKeyHash(senderUtxo.receiver);
                if (keyHash) {
                    const keyHex = Buffer.from(keyHash).toString('hex');
                    if (!keyHashes.includes(keyHex)) {
                        keyHashes.push(keyHex);
                        deduped.push(senderUtxo);
                    }
                }
            });
            const keys = await db.key.where({ conceptualWalletId: +conceptualWalletId }).toArray();
            const privateKey = await this.getPrivateKey(password);
            const decodedHash = await this.passwordCipher.decryptWithPassword(password, privateKey as string);

            deduped.forEach((utxo) => {
                const prvKey = AsyncLoader.Serialization.Bip32PrivateKey.from_bytes(decodedHash)
                    .derive(harden(1852))
                    .derive(harden(1815))
                    .derive(harden(0)) // TODO: move this logic on a separate variable (Account key)
                    .derive(utxo.addressing ? utxo.addressing.type : 0)
                    .derive(utxo.addressing ? utxo.addressing.path : 0)
                    .to_raw_key();

                const vkeyWitness = AsyncLoader.Serialization.make_vkey_witness(txHash, prvKey);
                vkeyWitnesses.add(vkeyWitness);
            });
            if (certificates.length > 0 || withdrawals.length > 0) {
                const prvKey = AsyncLoader.Serialization.Bip32PrivateKey.from_bytes(decodedHash)
                    .derive(harden(1852))
                    .derive(harden(1815))
                    .derive(harden(0))
                    .derive(2)
                    .derive(0)
                    .to_raw_key();

                const stakeKeyVitness = AsyncLoader.Serialization.make_vkey_witness(txHash, prvKey);
                vkeyWitnesses.add(stakeKeyVitness);
            }

            const witnesses = AsyncLoader.Serialization.TransactionWitnessSet.new();
            witnesses.set_vkeys(vkeyWitnesses);

            const signedTxRaw = AsyncLoader.Serialization.Transaction.new(txBody, witnesses, metadata);
            const signHash = signedTxRaw.to_bytes();
            return signHash;
        } catch (error) {
            throw new Error(`error txSign ${error}`);
        }
    }

    cardanoValueFromRemoteFormat(utxo) {
        const cardanoValue = AsyncLoader.Serialization.Value.new(
            AsyncLoader.Serialization.BigNum.from_str(utxo.amount),
        );

        if (!utxo.assets || utxo.assets.length === 0) {
            return cardanoValue;
        }

        const assets = AsyncLoader.Serialization.MultiAsset.new();

        utxo.assets.forEach((token) => {
            const policyId = AsyncLoader.Serialization.ScriptHash.from_bytes(Buffer.from(token.policyId, 'hex'));
            const assetName = AsyncLoader.Serialization.AssetName.new(Buffer.from(token.name || '', 'hex'));
            const quantity = AsyncLoader.Serialization.BigNum.from_str(token.amount);

            const policyContent = assets.get(policyId) ?? AsyncLoader.Serialization.Assets.new();

            policyContent.insert(assetName, quantity);
            assets.insert(policyId, policyContent);
        });

        if (assets.len() > 0) {
            cardanoValue.set_multiasset(assets);
        }

        return cardanoValue;
    }

    private isNotEnoughBalanceError(error: string) {
        const balanceErrors = [
            'not enough ada',
            'insufficient input',
            'utxo balance insufficient',
        ];
        return balanceErrors.some(balanceError => error.toLowerCase().includes(balanceError));
    }
}

function harden(num: number): number {
    return 0x80000000 + num;
}
