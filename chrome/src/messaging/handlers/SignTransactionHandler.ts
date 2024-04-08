import {AbstractMessageHandler} from "../core/AbstractMessageHandler";
import {MessageRequestInterface} from "../core/MessageRequestInterface";
import {SendNewTransactionService} from "../../services/send-new-transaction.service";
import { TransactionType } from "../../shared/types";
import { autoInjectable, singleton } from 'tsyringe';
import { LogService } from '../../services/log.service';
import { TransactionsService } from "../../api/transactions.service";

export interface SignTransactionRequestInterface extends MessageRequestInterface {
    params: {
        transactionDetails: any;
    }
}

@singleton()
@autoInjectable()
export class SignTransactionHandler extends AbstractMessageHandler {
    constructor(
      private sendNewTransactionService: SendNewTransactionService,
      private transactionsService: TransactionsService,
      private logService: LogService,
    ) {
      super();
    }

    async sendTransaction(transactionDetails) {
       if (this.isStakingTransaction(transactionDetails.type) && transactionDetails.poolId) {
           const certificates = await this.sendNewTransactionService.generateDelegationCerts(
               transactionDetails.type,
               transactionDetails.poolId
           );
           transactionDetails.certificates = certificates;
       } else if (transactionDetails.type === TransactionType.Deregistration) {
           const certificates = await this.sendNewTransactionService.generateDeregistrationCerts();
           transactionDetails.certificates = certificates;
       }
       const newTransaction = await this.sendNewTransactionService.buildTransaction(transactionDetails.outputs, null, transactionDetails.certificates ?? [], transactionDetails.withdrawals ?? []);
       const signedTransaction = await this.sendNewTransactionService.txSign(newTransaction.data, transactionDetails.password);
       const tx = await this.transactionsService.sendTx({encodedTx: signedTransaction});
       return tx;
    }

   async handle(request: SignTransactionRequestInterface) {
      try {
        const response = await this.sendTransaction(request.params.transactionDetails);

        if (response.error) {
          request.cb({ error: response.error.response });
        } else {
          request.cb({txHash: response})
        }

      } catch (e) {
        this.logService.log(e);
        request.cb({error: e?.message || e});
      }
   }

   private isStakingTransaction(type: TransactionType) {
       return type === TransactionType.RegistrationAndStaking || type === TransactionType.Staking;
   }
}
