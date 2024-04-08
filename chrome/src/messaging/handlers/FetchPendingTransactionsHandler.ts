import { AbstractMessageHandler } from "../core/AbstractMessageHandler";
import { autoInjectable, singleton } from 'tsyringe';
import { PendingTransactionsService } from '../../services/pending-transactions.service';
import { ConceptualWalletService } from '../../api/conceptual-wallet.service';


@singleton()
@autoInjectable()
export class FetchPendingTransactionsHandler extends AbstractMessageHandler {
    constructor(
        private pendingTranscationsService?: PendingTransactionsService,
        private conceptualWalletService?: ConceptualWalletService,
    ) {
        super();
    }

    async handle(request) {

        const walletId = this.conceptualWalletService.getCurrentActiveWalletId();
        const wallet = await this.conceptualWalletService.find(walletId);

        if (wallet) {
            const transactions = await this.pendingTranscationsService.fetchAllTransactionsForActiveWallet();
            request.cb({pending: transactions});
        } else {
            request.cb({pending: []});
        }

    }
}
