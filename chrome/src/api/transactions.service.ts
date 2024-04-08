import { GERO_CARDANO_SERVER } from '../constants';
import {
    AddressUtxoResponse,
    BlockfrostTransactionInfo,
    DelegationType,
    HistoryRequest,
    PoolInfoResponse,
    TransactionDirection,
} from '../shared/types';
import { HistoryResponse } from '../shared/historyResponse';
import { AsyncLoader } from '../shared/AsyncLoader';
import { WalletAddressesService } from '../shared/wallet-addresses.service';
import BigNumber from 'bignumber.js';
import { ConceptualWalletService } from './conceptual-wallet.service';
import { autoInjectable, singleton } from 'tsyringe';
import { AssetsService } from '../services/assets.service';
import { CollateralRepository } from '../repositories';
import { WalletInfoService } from '../services/wallet-info.service';
import { db } from '../database/GeroWalletDatabase';
import { AddressService } from '../services/address.service';
import { BlockFrostService } from './blockfrost.service';
import { CacheHandler, CacheType } from '../messaging/handlers';

const UTXOS_CACHE_DURATION = 15 * 2000;
@singleton()
@autoInjectable()
export class TransactionsService {
    private storedTransactions: BlockfrostTransactionInfo[] = [];
    private cache = new CacheHandler();

    constructor(
        private conceptualWalletService?: ConceptualWalletService,
        private walletAddressesService?: WalletAddressesService,
        private assetsService?: AssetsService,
        private collateralRepository?: CollateralRepository,
        private walletInfoService?: WalletInfoService,
        private blockfrostService?: BlockFrostService,
        private addressService?: AddressService
    ) { }

    public async getUTXOsForRewardAddress(stakeAddress: string): Promise<AddressUtxoResponse[]> {
        const cache = this.cache.get(stakeAddress, CacheType.rewardUtxos, true, UTXOS_CACHE_DURATION);

        if (cache) {
            return Promise.resolve(cache);
        }
        const result = await fetch(`${GERO_CARDANO_SERVER}/getutxos/${stakeAddress}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        return result.json().then((values: AddressUtxoResponse[]) => {
            const addressUtxos = values;
            const utxos = [];
            addressUtxos.forEach(utxo => {
                const hash = this.addressService.getPaymentKeyHash(utxo.receiver);
                if (hash) {
                    if (!utxo.receiver.startsWith('addr')) {
                        const fixedAddr = Buffer.from(
                            AsyncLoader.Serialization.Address.from_bech32(utxo.receiver).to_bytes(),
                        ).toString('hex');
                        return {
                            ...utxo,
                            receiver: fixedAddr,
                        };
                    }
                    if (utxo.assets && utxo.assets.length > 0) {
                        utxo.assets.forEach((asset) => {
                            asset.assetId = asset.policyId + asset.name;
                        });
                    }
                    utxos.push(utxo);
                }
            });
            this.cache.set(stakeAddress, CacheType.rewardUtxos, utxos);
            return utxos;
        });
    }

    public async getTransactionsHistoryForAddresses(body?: HistoryRequest): Promise<HistoryResponse | void> {
        const result = await fetch(`${GERO_CARDANO_SERVER}/v2/txs/history`, {
            headers: {
                'Content-Type': 'application/json',
            },
            method: 'POST',
            body: JSON.stringify(body),
        }).catch((error) => {
            const errorMessage = error?.response?.data?.error?.response;
            if (
                errorMessage === 'REFERENCE_BLOCK_MISMATCH' ||
                errorMessage === 'REFERENCE_TX_NOT_FOUND' ||
                errorMessage === 'REFERENCE_BEST_BLOCK_MISMATCH'
            ) {
                throw new Error('rollbackError');
            }
            throw new Error('GetTxHistoryForAddressesApiError');
        });

        if (result.ok) {
            const updatedTransactions: HistoryResponse = [];
            return result.json().then((transactions: HistoryResponse) => {
                transactions.forEach((transaction) => {
                    if (transaction) {
                        if (transaction.type === 'shelley') {
                            // unfortunately the backend returns Shelley addresses as bech32
                            // this is a bad idea, and so we manually change them to raw payload
                            for (const input of transaction.inputs) {
                                // replace non-existent w/ empty array to handle Allegra -> Mary transition
                                input.assets = input.assets ?? [];
                            }
                            for (const output of transaction.outputs) {
                                // replace non-existent w/ empty array to handle Allegra -> Mary transition
                                output.assets = output.assets ?? []; /* expected not to work for base58 addresses */
                            }
                        }
                        if (transaction.height != null) {
                            return transaction;
                        }
                        updatedTransactions.push(transaction);
                    }
                });
                return updatedTransactions;
            });
        }
    }

    public async getRegistrationRefunds(): Promise<string> {
        const network = await db.network.toArray();
        const protocolParams = network[0].baseConfig[0];
        return protocolParams.keyDeposit;
    }

    public async getPoolInfo(poolIds: string[]): Promise<PoolInfoResponse> {
        const result = await fetch(`${GERO_CARDANO_SERVER}/pool/info`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ poolIds }),
        }).catch((error) => {
            throw new Error(`some error for getPoolInfo: ${error}`);
        });

        return result?.json().then((poolInfoResponse: PoolInfoResponse) => {
            return poolInfoResponse;
        });
    }

    public async sendTx(body: { encodedTx: Uint8Array }) {
        const signedTx = Buffer.from(body.encodedTx).toString('base64');

        const response = await fetch(`${GERO_CARDANO_SERVER}/txs/signed`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json;charset=UTF-8',
            },
            body: JSON.stringify({ signedTx }),
        }).catch((error) => {
            if (error.request.response.includes('Invalid witness')) {
                throw new Error(`InvalidWitnessError ${JSON.stringify(error)}`);
            }
            throw new Error(`SendTransactionApiError ${JSON.stringify(error)}`);
        });
        return response.json();
    }

    public async getTransactions(conceptualWalletId: number) {
        conceptualWalletId = await this.conceptualWalletService.checkId(conceptualWalletId);
        let totalBalance = 0;

        const walletInfo = await this.walletInfoService.getData(conceptualWalletId);

        const [addressInfo, utxos] = await Promise.all([
            this.blockfrostService.getAddressInfo(walletInfo.rewardAddress),
            this.getUTXOsForRewardAddress(walletInfo.rewardAddress)
        ]);

        utxos.forEach(utxo => {
            if (utxo.amount) {
                totalBalance += +utxo.amount;
            }
        });

        const assets = await this.assetsService.handleUtxosAssets(utxos);

        return {
            totalBalance,
            utxos,
            assets,
            poolId: addressInfo.poolId,
            rewardsAmount: addressInfo.rewardsAmount,
            withdrawableAmount: addressInfo.withdrawableAmount,
            hasEverDelegated: addressInfo.hasEverDelegated,
        };
    }

    public async getTransactionHistory(conceptualWalletId: number, hashes: string[]) {
        conceptualWalletId = await this.conceptualWalletService.checkId(conceptualWalletId);
        const collateral = await this.collateralRepository.get(conceptualWalletId);
        const addressesArray = [];
        const checkAddressesShift = async (
            checkType,
            checkPageSize,
            checkShift,
            conceptualWalletId: number,
        ) => {
            const checkedAdresses = await this.walletAddressesService.getAccountAddresses(
                checkType,
                checkPageSize,
                checkShift,
                conceptualWalletId
            );
            addressesArray.push(...checkedAdresses.addresses);
        };

        await checkAddressesShift('all', 20, 0, conceptualWalletId);
        const registrationRefunds = await this.getRegistrationRefunds();

        const transactionHistory = await this.getHistory( hashes);
        let transactions;
        if (transactionHistory) {
            transactions = transactionHistory.map((transaction) => {
                let amount = new BigNumber(0);
                transaction.inputs.forEach((input) => {
                    if (addressesArray.includes(input.address)) {
                        amount = amount.minus(input.amount);
                    }
                });
                
                let refunds = "0";
                transaction.outputs.forEach((output) => {
                    if (addressesArray.includes(output.address)) {
                        amount = amount.plus(output.amount);
                    }
                });

                const transactionDirection = new BigNumber(amount).lt(0)
                    ? TransactionDirection.Send
                    : TransactionDirection.Receive;

                 const type = transaction.hash === collateral?.txHash
                  ? TransactionDirection.Collateral
                  : transactionDirection;

                let delegation = undefined;

                if (transaction.delegation_count > 0) {
                    if (transaction.stake_cert_count > 0) {
                        delegation = DelegationType.RegistrationAndStaking;
                        refunds = registrationRefunds;
                    } else {
                        delegation = DelegationType.Staking;
                    }
                } else if (transaction.withdrawal_count > 0) {
                    if (transaction.stake_cert_count > 0) {
                        delegation = DelegationType.Deregistration;
                        refunds = registrationRefunds;
                    } else {
                        delegation = DelegationType.Withdrawal;
                    }
                }

                return {
                    ...transaction,
                    type: type,
                    delegation,
                    refunds,
                    value: new BigNumber(amount).abs(),
                    txFromAddresses: [transaction.inputs[0].address],
                    txToAddresses: [transaction.outputs[0].address],
                    assets: this.assetsService.getTxAssetsAmount(transaction, addressesArray, transactionDirection),
                };
            });
        }

        return transactions;
    }

    public async getTransactionsBlockfrost(hashes: string[]): Promise<BlockfrostTransactionInfo[]> {
        const result = await fetch(`${GERO_CARDANO_SERVER}/history`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({hashes}),
        }).catch((error) => {
                const errorMessage = error?.response?.data?.error?.response;
                throw new Error(`GtTransactionsBlockfrost: , ${error}`);
            });

        return result?.json().then((entries: any[]) => {
            if(entries.length > 0){
                return entries;
            }
        });
    }

    /**
     * This method will only be called when we create/restore the wallet.js, to fetch the whole history
     */
    private async getHistory(hashes: string[]){
        this.storedTransactions = [];
        return this.getHistoryEntries(hashes);
    }

    private async getHistoryEntries( hashes: string[]): Promise<BlockfrostTransactionInfo[]> {
        const transactions = await this.getTransactionsBlockfrost(hashes);
        if (transactions) {
            this.storedTransactions.push(...transactions);
        }

        return this.storedTransactions;
    }
}
