/* eslint-disable prettier/prettier */
import { AbstractMessageHandler } from "../core/AbstractMessageHandler";
import { MessageRequestInterface } from "../core/MessageRequestInterface";
import { TransactionsService } from "../../api/transactions.service";
import { ConceptualWalletService } from '../../api/conceptual-wallet.service';
import { autoInjectable, singleton } from 'tsyringe';
import { CacheHandler, CacheType } from ".";
import {BlockFrostService} from "../../api/blockfrost.service";

interface TransactionHandlerRequest extends MessageRequestInterface {
    params: {
        conceptualWalletId: number;
        forceUpdate: boolean;
        page?: number;
        txNumber?: number
    }
}

@singleton()
@autoInjectable()
export class TransactionsHistoryHandler extends AbstractMessageHandler {
    private loading = false;
    constructor(
      private transactionsService: TransactionsService,
      private cache: CacheHandler,
      private conceptualWalletService?: ConceptualWalletService,
      private blockfrostService?: BlockFrostService
    ) {
        super();
    }

    async handle(request: TransactionHandlerRequest) {
        try {
            const conceptualWalletId = await this.conceptualWalletService.checkId(request.params.conceptualWalletId);
            let page = request.params?.page ?? 1;
            const conceptualWallet = await this.conceptualWalletService.find(conceptualWalletId);
            let txNumber = request.params.txNumber;
            if (txNumber === undefined) {
                txNumber = await this.blockfrostService.getTxNumber(conceptualWallet.rewardAddress);
            }

            if (!conceptualWalletId) {
                console.log('error!!');
                request.cb({ error: 'error' })
                return;
            }
            const cache = this.cache.get(conceptualWalletId, CacheType.history);

            if (this.loading === true) {
                request.cb(cache.transactions);
                return;
            }

            if (txNumber === 0) {
                request.cb([]);
                return;
            }


            if (
                cache?.page >= request.params.page &&
                !!cache?.transactions?.length &&
                txNumber <= cache.txNumber &&
                cache.txNumber === cache.txHashes.length
            ) {
                request.cb(cache.transactions);
                return;
            } else {
                this.loading = true;
                let txHashes = cache?.txHashes;
                if(!txHashes){
                    txHashes = await this.blockfrostService.getTxHashes(conceptualWallet.rewardAddress);
                    //here we set cache to avoid duplicate calls
                    this.cache.set(conceptualWalletId, CacheType.history, { page, txNumber, txHashes });
                }else {
                    //in case we have new transactions, fetch all the hashes again
                    if((txHashes as string[]).length < txNumber ){
                        txHashes = await this.blockfrostService.getTxHashes(conceptualWallet.rewardAddress);
                        this.cache.set(conceptualWalletId, CacheType.history, { page, txNumber, txHashes });
                        //reset the page to 0 in order to fetch all the new Transactions from beginning
                        page = 0;
                    }
                }

                //pagination
                const TX_COUNT = 10; // that property refers to how many txs we want to send for info fetch
                const startIndex = (page - 1) * TX_COUNT;
                const endIndex = Math.min(startIndex + TX_COUNT, txHashes.length);
                const hashesToBeFetched = (txHashes as string[]).slice(startIndex, endIndex);

                let transactions: any[] = [];
                let unknownTxHashes: any[] = []; // this array will contain all the hashes that are not hashed
                hashesToBeFetched.forEach(hash =>{
                    // check if transaction already exists
                   const tx = this.cache.get(`${hash}-${conceptualWalletId}`, CacheType.transactions);
                   if(!!tx){
                       transactions.push(tx);
                   }else{
                       unknownTxHashes.push(hash);
                   }
                });

                //this array will have the txs that needs to be fetched
                let newTransactions: any[] = [];
                if(!!unknownTxHashes && unknownTxHashes.length > 0){
                    newTransactions = await this.transactionsService.getTransactionHistory(conceptualWalletId, unknownTxHashes);
                    if(newTransactions?.length > 0){
                        //set the cache
                        newTransactions.forEach(tx =>{
                            this.cache.set(`${tx.hash}-${conceptualWalletId}`, CacheType.transactions, tx);
                        });
                    }
                    transactions = [...transactions, ...newTransactions];
                    transactions = transactions.sort((transaction1, transaction2) => transaction1.time - transaction2.time);
                }

                if( transactions?.length > 0){
                    //if we already have transactions cached we must inject the new txs to the already existing ones
                    if(cache?.transactions?.length > 0 ){
                        transactions = (cache.transactions as any[]).concat(transactions);
                        this.cache.set(conceptualWalletId, CacheType.history, { transactions, page, txNumber, txHashes });
                        request.cb(transactions);
                        this.loading = false;
                        return;
                    }else{
                        //this is the scenario for the 1st history request
                        this.cache.set(conceptualWalletId, CacheType.history, { transactions, page, txNumber, txHashes });
                        request.cb(transactions);
                        this.loading = false;
                        return;
                    }
                }else{
                    request.cb(cache.transactions);
                    this.loading = false;
                    return;
                }
            }
        } catch (e) {
            this.loading = false;
            request.cb([]);
        }
    }
}
