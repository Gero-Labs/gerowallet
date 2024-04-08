import { AbstractMessageHandler } from "../core/AbstractMessageHandler";
import { MessageRequestInterface } from "../core/MessageRequestInterface";
import { TransactionsService } from "../../api/transactions.service";
import { ConceptualWalletService } from '../../api/conceptual-wallet.service';
import { CacheHandler, CacheType } from "./CacheHandler";
import { autoInjectable, singleton } from 'tsyringe';
import { BlockFrostService } from "../../api/blockfrost.service";

interface TransactionHandlerRequest extends MessageRequestInterface {
    params: {
        conceptualWalletId: number;
        forceUpdate: boolean;
        isFirstRequest: boolean;
    }
}

@singleton()
@autoInjectable()
export class TransactionsHandler extends AbstractMessageHandler {
    constructor(
      private transactionsService: TransactionsService,
      private cache: CacheHandler,
      private blockFrostService: BlockFrostService,
      private conceptualWalletService?: ConceptualWalletService,
    ) {
        super();
    }

    async handle(request: TransactionHandlerRequest) {
        try {
            const { conceptualWalletId, rewardAddress } = await this.conceptualWalletService.find(
                request.params.conceptualWalletId,
            );

            if (!conceptualWalletId || !rewardAddress) {
                request.cb({ 
                    totalBalance: 0,
                    assets: [],
                    txNumber: 0,
                });
            }

            const txNumber = request.params.isFirstRequest ? 0 : await this.blockFrostService.getTxNumber(rewardAddress);

            const cache = this.cache.get(conceptualWalletId, CacheType.utxos);
            if (
                !!cache?.transactions &&
                !request.params.forceUpdate &&
                cache?.txNumber === txNumber
            ) {
                request.cb({ ...cache.transactions, txNumber });
            } else{
                const transactions = await this.transactionsService.getTransactions(conceptualWalletId);
                this.cache.set(conceptualWalletId, CacheType.utxos, { transactions, txNumber });
                request.cb({ ...transactions, txNumber });
            }
        } catch (e) {
            request.cb({ 
                totalBalance: 0,
                assets: [],
                txNumber: 0,
            });
        }
    }
}
