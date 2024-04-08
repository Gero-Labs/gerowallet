import {AbstractMessageHandler} from "../core/AbstractMessageHandler";
import {MessageRequestInterface} from "../core/MessageRequestInterface";
import {SendNewTransactionService} from "../../services/send-new-transaction.service";
import { DelegationType } from "../../shared/types";
import { autoInjectable, singleton } from 'tsyringe';
import { TransactionsService } from "../../api/transactions.service";

export interface BuildDelegationRequestInterface extends MessageRequestInterface {
    params: {
        transactionDetails: any;
    }
}

@singleton()
@autoInjectable()
export class BuildDelegationHandler extends AbstractMessageHandler {
    constructor(
        private sendNewTransactionService: SendNewTransactionService,
        private transactionsService: TransactionsService
    ) {
        super();
    }

    async buildDelegationTransaction(transactionDetails) {
        const certificates = await this.sendNewTransactionService.generateDelegationCerts(transactionDetails.type, transactionDetails.poolId);
        transactionDetails.certificates = certificates;
        const newTransaction = await this.sendNewTransactionService.buildTransaction(transactionDetails.outputs, null, transactionDetails.certificates ?? []);
        if (transactionDetails.type === DelegationType.RegistrationAndStaking) {
            const refunds = await this.transactionsService.getRegistrationRefunds();
            newTransaction.data['refunds'] = +refunds;
        } else {
            newTransaction.data['refunds'] = 0;
        }
        return newTransaction;
    }

    async buildDeregistrationTransaction(transactionDetails) {
        try {
            const certificates = await this.sendNewTransactionService.generateDeregistrationCerts();
            transactionDetails.certificates = certificates;
            const newTransaction = await this.sendNewTransactionService.buildTransaction(transactionDetails.outputs, null, transactionDetails.certificates ?? []);
            const refunds = await this.transactionsService.getRegistrationRefunds();
            newTransaction.data['refunds'] = +refunds;
            return newTransaction;
        } catch(e) {
            const error = e.toString();
            if (error.includes('not enough ADA') || error.includes('minimumNeededForChange')) {
                return 'not_enough_ada';
            }
            throw(e);
        }
    }

    async buildWithdrawalTransaction(transactionDetails) {
        try {
            const newTransaction = await this.sendNewTransactionService.buildTransaction(transactionDetails.outputs, null, transactionDetails.certificates ?? [], transactionDetails.withdrawals ?? []);
            return newTransaction;
        } catch(e) {
            const error = e.toString();
            if (error.includes('not enough ADA') || error.includes('minimumNeededForChange')) {
                return 'not_enough_ada';
            }
            throw(e);
        }
    } 

    public async handle(request: BuildDelegationRequestInterface) {
        const transactionDetails = request.params.transactionDetails;
        if (transactionDetails.type === DelegationType.RegistrationAndStaking || transactionDetails.type === DelegationType.Staking) {
            const result = await this.buildDelegationTransaction(request.params.transactionDetails);
            request.cb(result);
        } else if (transactionDetails.type === DelegationType.Deregistration) {
            const result = await this.buildDeregistrationTransaction(request.params.transactionDetails);
            request.cb(result);
        } else if (transactionDetails.type === DelegationType.Withdrawal) {
            const result = await this.buildWithdrawalTransaction(request.params.transactionDetails);
            request.cb(result);
        }
    }
}
