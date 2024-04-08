import { autoInjectable, singleton } from 'tsyringe';
import { PendingTransaction } from '../database/models/PendingTransaction';
import { ConceptualWalletService } from '../api/conceptual-wallet.service';

@singleton()
@autoInjectable()
export class PendingTransactionsService {

    constructor(private conceptualWalletService?: ConceptualWalletService) {
    }

    public setPendingTransaction(pendingTransaction: PendingTransaction): void {
        const pendingTransactions = this.getPendingTransactions();
        pendingTransactions.push(pendingTransaction);
        this.setPendingTransactions(pendingTransactions);
    }

    public removePendingTransaction(hash: string): void {
        const pendingTransactions = this.getPendingTransactions();
        const tx = pendingTransactions.find(transaction => transaction.hash === hash);
        if (tx) {
            const filteredTransactions = pendingTransactions?.filter(transaction => transaction.hash !== hash);
            this.setPendingTransactions(filteredTransactions);
        } else {
            throw new Error(`Cannot delete PendingTransaction with id: ${hash} `);
        }
    }

    public updatePendingTransactionStatus(hash: string): void {
        const pendingTransactions = this.getPendingTransactions();
        const tx = pendingTransactions.find(transaction => transaction.hash === hash);
        if (tx) {
            tx.status = 'Failed';
            this.setPendingTransactions(pendingTransactions);
        } else {
            throw new Error(`Cannot update PendingTransaction with id: ${hash} `);
        }
    }

    public async fetchAllTransactionsForActiveWallet(): Promise<PendingTransaction[]> {
        const activeWalletId = this.conceptualWalletService.getCurrentActiveWalletId();
        if (activeWalletId) {
            const wallet = await this.conceptualWalletService.find(activeWalletId);
            const pendingTransactions = this.getPendingTransactions();
            const transactions = pendingTransactions?.filter(transaction => transaction.stakeKey === wallet.rewardAddress);
            return transactions;
        }
        return [];
    }

    private getPendingTransactions(): PendingTransaction[] | undefined {
        const pendingTransactions = JSON.parse(localStorage.getItem('pendingTransactions'))
        if (!pendingTransactions) {
            return [];
        }
        return pendingTransactions;
    }

    private setPendingTransactions(pendingTransactions: PendingTransaction[]) {
        localStorage.setItem('pendingTransactions',  JSON.stringify(pendingTransactions));
    }
}
