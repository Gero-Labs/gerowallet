import { AbstractMessageHandler } from "../core/AbstractMessageHandler";
import { autoInjectable, singleton } from 'tsyringe';
import { PendingTransactionsService } from '../../services/pending-transactions.service';
import { PendingTransaction, TransactionStatus } from '../../database/models/PendingTransaction';
import { ConceptualWalletService } from '../../api/conceptual-wallet.service';
import { PendingState, TransactionDirection } from '../../shared/types';
import { DEFAULT_TTL } from '../../constants';
import { MessageRequestInterface } from '../core/MessageRequestInterface';
import { AssetsService } from "../../services/assets.service";

export interface PendingTransactionsMessageRequest extends MessageRequestInterface {
    params: {
        details: PendingState;
        hash: string;
    }
}


@singleton()
@autoInjectable()
export class SetPendingTransactionHandler extends AbstractMessageHandler {
    constructor(
        private pendingTranscationsService?: PendingTransactionsService,
        private conceptualWalletService?: ConceptualWalletService,
        private assetsService?: AssetsService
    ) {
        super();
    }

    async handle(request: PendingTransactionsMessageRequest) {

        const walletId = this.conceptualWalletService.getCurrentActiveWalletId();
        const wallet = await this.conceptualWalletService.find(walletId);

        if(wallet){
            const pendingTX: PendingTransaction = {
                stakeKey: wallet.rewardAddress,
                type: 'Send',
                from: wallet.address,
                to: request.params.details.address,
                date: new Date(),
                amountADA: request.params.details.amount,
                feeADA: request.params.details.fee,
                totalADA: request.params.details.amount + request.params.details.fee,
                status: 'Pending' as TransactionStatus,
                direction: TransactionDirection.Send,
                assets: request.params.details.assets.map(asset => ({
                    ...asset,
                    name: asset.name === 'Cardano' ? 'Cardano' : this.assetsService.getTickerFromName(asset.name),
                })),
                ttl: DEFAULT_TTL,
                hash: request.params.hash
            }

            await this.pendingTranscationsService.setPendingTransaction(pendingTX);
            request.cb();
        } else{
            throw new Error()
        }
    }
}
