import { AbstractMessageHandler } from "../core/AbstractMessageHandler";
import { autoInjectable, singleton } from 'tsyringe';
import { PendingTransactionsService } from '../../services/pending-transactions.service';
import { MessageRequestInterface } from '../core/MessageRequestInterface';

export interface UpdateTransactionsMessageRequest extends MessageRequestInterface {
    params: {
        hash: string;
        mode: 'Delete' | 'Update';
    }
}


@singleton()
@autoInjectable()
export class UpdatePendingTransactionHandler extends AbstractMessageHandler {
    constructor(
        private pendingTranscationsService?: PendingTransactionsService,
    ) {
        super();
    }


    async handle(request: UpdateTransactionsMessageRequest) {
        if (request.params.mode === 'Delete') {
            await this.pendingTranscationsService.removePendingTransaction(request.params.hash);
        } else {
            await this.pendingTranscationsService.updatePendingTransactionStatus(request.params.hash);
        }

        request.cb();
    }

}
