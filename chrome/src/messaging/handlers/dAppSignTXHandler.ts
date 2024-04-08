import { AbstractMessageHandler } from '../core/AbstractMessageHandler';
import { MessageRequestInterface } from '../core/MessageRequestInterface';
import { AsyncLoader } from '../../shared/AsyncLoader';
import { PasswordCipher } from '../../services/PasswordCipher';
import { SendNewTransactionService } from '../../services/send-new-transaction.service';
import { WalletAddressesService } from '../../shared/wallet-addresses.service';
import { autoInjectable, singleton } from 'tsyringe';
import { PopupService } from '../../services/popup.service';
import { ConceptualWalletService } from '../../api/conceptual-wallet.service';
import { TxSignError } from '../../dAppConnector/api-error';
import { AddressUtxoResponse } from '../../shared/types';
import { UtxosService } from '../../services/utxos.service';
import {HardwareWalletService} from "../../services/hardware-wallet.service";
import { AddressService } from '../../services/address.service';
import { WalletType } from '../../database/models/ConceptualWallet';
import { FixedTransaction, TransactionWitnessSet } from '@emurgo/cardano-serialization-lib-browser';

const blake2b = require('blake2b');

export interface DAppSignTXHandlerRequestParams extends MessageRequestInterface {
    params: {
        tx: string;
        partialSign?: boolean;
    };
}

@singleton()
@autoInjectable()
export class DAppSignTXHandler extends AbstractMessageHandler {
    constructor(
        private sendNewTransactionService?: SendNewTransactionService,
        private passwordCipher?: PasswordCipher,
        private walletAddressesService?: WalletAddressesService,
        private conceptualWalletService?: ConceptualWalletService,
        private utxosService?: UtxosService,
        private hardwareWalletService?: HardwareWalletService,
        private addressService?: AddressService,
        private popupService?: PopupService
    ) {
        super();
    }

    async handle(request: DAppSignTXHandlerRequestParams) {
        try {
            const rawTx = AsyncLoader.Serialization.FixedTransaction.from_hex(
                request.params.tx,
            );
            const connectedSite = request.sender.origin;

            const vkeyWitnesses = AsyncLoader.Serialization.Vkeywitnesses.new();
            const txBody = rawTx.body();
            const deduped = [];
            const keyHashes = [];
            const conceptualWalletId = this.conceptualWalletService.getCurrentActiveWalletId();
            const txHashHex = this.getTxHashHex(rawTx);

            const utxos: AddressUtxoResponse[] = await this.utxosService.getUtxosResponse();
            const walletUtxos = await this.getWalletUtxos(utxos, conceptualWalletId.toString());
            const changeAddress = await this.walletAddressesService.getMainAddress(+conceptualWalletId);
            let paymentKeyHash = this.addressService.getPaymentKeyHash(changeAddress);
            let paymentkeyHex = Buffer.from(paymentKeyHash).toString('hex');

            let stakeKeyHash = this.addressService.getStakeKeyHash(changeAddress);
            let stakeKeyHex = Buffer.from(stakeKeyHash).toString('hex');

            for (let i = 0; i < txBody.inputs().len(); i++) {
                const input = txBody.inputs().get(i);
                const inputTxHash = Buffer.from(input.transaction_id().to_bytes()).toString('hex');
                const inputTxIndex = input.index();
                const utxo = walletUtxos.find((utxo) => {
                    return inputTxHash === utxo.tx_hash && utxo.tx_index === inputTxIndex;
                });

                if (utxo) {
                    paymentKeyHash = this.addressService.getPaymentKeyHash(utxo.receiver);
                    paymentkeyHex = Buffer.from(paymentKeyHash).toString('hex');
        
                    stakeKeyHash = this.addressService.getStakeKeyHash(utxo.receiver);
                    stakeKeyHex = Buffer.from(stakeKeyHash).toString('hex');

                    if (!keyHashes.includes(paymentkeyHex)) {
                        keyHashes.push(paymentkeyHex);
                        deduped.push(utxo);
                    }
                }
            }

            const paymentKeyHashes = await this.getPaymentKeyHashes(conceptualWalletId);

            //get keyHashes from required signers
            const requiredSigners = txBody.required_signers();
            if (requiredSigners) {
                for (let i = 0; i < requiredSigners.len(); i++) {
                    const requiredKeyHash = Buffer.from(requiredSigners.get(i).to_bytes()).toString('hex');
                    if (!keyHashes.includes(requiredKeyHash)) {
                        if (paymentKeyHashes.includes(requiredKeyHash)) {
                            keyHashes.push(requiredKeyHash);
                            deduped.push({
                                addressing: {type: 0, path: 0}
                            });
                        } else if (requiredKeyHash === stakeKeyHex) {
                            keyHashes.push(requiredKeyHash);
                            deduped.push({
                                addressing: {type: 2, path: 0}
                            });
                        }
                    }
                }
            }

            const password = await this.popupService.showPopup(`index.html?#/swap?tx=${request.params.tx}&connectedSite=${connectedSite}`);

            if (password === undefined) {
                throw new Error(TxSignError.UserDeclined.info);
            }

            const wallet = await this.conceptualWalletService.find(conceptualWalletId);
            if (wallet.walletType === WalletType.Trezor) {
                const wit: TransactionWitnessSet = <TransactionWitnessSet>await this.hardwareWalletService.txToTrezor(
                    txBody,
                    0,
                    wallet.address,
                    walletUtxos,
                    true
                );

                request.cb({
                    witnesses: Buffer.from(wit.to_bytes()).toString('hex'),
                });
            } else if (wallet.walletType === WalletType.Ledger) {
                const wit: TransactionWitnessSet = <TransactionWitnessSet>await this.hardwareWalletService.txToLedger(
                    txBody,
                    wallet.address,
                    0,
                    null,
                    true,
                    walletUtxos
                );
                request.cb({
                    witnesses: Buffer.from(wit.to_bytes()).toString('hex'),
                });
            } else {
                const privateKey = await this.sendNewTransactionService.getPrivateKey(password);
                const decodedHash = await this.passwordCipher.decryptWithPassword(password, privateKey as string);

                if (!decodedHash && request.params.partialSign === false) {
                    throw new Error(TxSignError.ProofGeneration.info);
                }
                const txHash = AsyncLoader.Serialization.TransactionHash.from_bytes(Buffer.from(txHashHex, 'hex'));

                deduped.forEach((utxo) => {
                    const prvKey = AsyncLoader.Serialization.Bip32PrivateKey.from_bytes(decodedHash)
                        .derive(this.harden(1852))
                        .derive(this.harden(1815))
                        .derive(this.harden(0)) // TODO: move this logic on a separate variable (Account key)
                        .derive(utxo.addressing ? utxo.addressing.type : 0)
                        .derive(utxo.addressing ? utxo.addressing.path : 0)
                        .to_raw_key();
                    const vkeyWitness = AsyncLoader.Serialization.make_vkey_witness(txHash, prvKey);
                    vkeyWitnesses.add(vkeyWitness);
                });
                if (
                    !keyHashes.includes(stakeKeyHash) && (
                    (txBody.certs() && txBody.certs().len() > 0) ||
                    (txBody.withdrawals() && txBody.withdrawals().len() > 0))
                ) {
                    const prvKey = AsyncLoader.Serialization.Bip32PrivateKey.from_bytes(decodedHash)
                        .derive(this.harden(1852))
                        .derive(this.harden(1815))
                        .derive(this.harden(0))
                        .derive(2)
                        .derive(0)
                        .to_raw_key();
                    const stakeKeyVitness = AsyncLoader.Serialization.make_vkey_witness(txHash, prvKey);
                    vkeyWitnesses.add(stakeKeyVitness);
                }
                let witnesses = AsyncLoader.Serialization.TransactionWitnessSet.new();
                witnesses.set_vkeys(vkeyWitnesses);

                if (!witnesses && request.params.partialSign === false) {
                    throw new Error(TxSignError.ProofGeneration.info);
                }

                request.cb({
                    witnesses: Buffer.from(witnesses.to_bytes()).toString('hex'),
                });
            }
        } catch (error) {
            request.cb({ error });
            throw error;
        }
    }

    private harden(num: number): number {
        return 0x80000000 + num;
    }

    private getTxHashHex(tx: FixedTransaction) {
        const output = new Uint8Array(32);
        return blake2b(output.length).update(tx.raw_body()).digest('hex');
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

    private async getPaymentKeyHashes(walletId: number): Promise<string[]> {
        const accountAddresses = await this.walletAddressesService.getAccountAddresses('external', 20, 0, walletId);
        return accountAddresses.addresses
            .map(address => this.addressService.getPaymentKeyHash(address))
            .filter(hash => !!hash)
            .map(keyHash => Buffer.from(keyHash).toString('hex'));
    }
}
