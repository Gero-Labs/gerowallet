import { AbstractMessageHandler } from '../core/AbstractMessageHandler';
import { MessageRequestInterface } from '../core/MessageRequestInterface';
import { SendNewTransactionService } from '../../services/send-new-transaction.service';
import { autoInjectable } from 'tsyringe';
import { HardwareWalletService } from '../../services/hardware-wallet.service';
import { TransactionType } from '../../shared/types';
import { WalletType } from '../../database/models/ConceptualWallet';
import { TransactionsService } from '../../api/transactions.service';

export interface HardwareSignTransactionRequestInterface extends MessageRequestInterface {
    params: {
        transactionDetails: any;
    };
}

@autoInjectable()
export class HardwareWalletSignTransactionHandler extends AbstractMessageHandler {
    constructor(
        private sendNewTransactionService?: SendNewTransactionService,
        private hardwareWalletService?: HardwareWalletService,
        private transactionsService?: TransactionsService,
    ) {
        super();
    }

    async sendTransaction(transactionDetails) {
        try {
            if (this.isStakingTransaction(transactionDetails.type) && transactionDetails.poolId) {
                const certificates = await this.sendNewTransactionService.generateDelegationCerts(
                    transactionDetails.type,
                    transactionDetails.poolId,
                );
                transactionDetails.certificates = certificates;
            } else if (transactionDetails.type === TransactionType.Deregistration) {
                const certificates = await this.sendNewTransactionService.generateDeregistrationCerts();
                transactionDetails.certificates = certificates;
            }
            const newTransaction = await this.sendNewTransactionService.buildTransaction(
                transactionDetails.outputs,
                null,
                transactionDetails?.certificates ?? [],
                transactionDetails?.withdrawals ?? [],
            );

            if (transactionDetails.walletType === WalletType.Trezor) {
                const signHash = <Uint8Array>await this.hardwareWalletService.txToTrezor(
                    newTransaction.data.txBody,
                    0,
                    newTransaction.data.outputs[0]?.address,
                    newTransaction.data.usedUtxos,
                );
                const tx = await this.transactionsService.sendTx({encodedTx: signHash});
                return tx;
            } else if (transactionDetails.walletType === WalletType.Ledger) {
                const signHash = <Uint8Array>await this.hardwareWalletService.txToLedger(
                    newTransaction.data.txBody,
                    newTransaction.data.outputs[0]?.address,
                    0,
                    newTransaction.data.metadata,
                    false,
                    newTransaction.data.usedUtxos
                );
               const tx = await this.transactionsService.sendTx({encodedTx: signHash});
               return tx;
            } else return null;
        } catch (e) {
            console.log(e);
            throw new Error(e);
        }
    }

    public async handle(request: HardwareSignTransactionRequestInterface) {
        try {
            const response = await this.sendTransaction(request.params.transactionDetails);
            if (response.error) {
                request.cb({ error: response.error });
            } else {
                request.cb( request.cb({txHash: response}));
            }
        } catch(err) {
            request.cb({ error: err });
        }
    }

    private isStakingTransaction(type: TransactionType) {
        return type === TransactionType.RegistrationAndStaking || type === TransactionType.Staking;
    }
}
