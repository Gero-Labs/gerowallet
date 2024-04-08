import {AbstractMessageHandler} from "../core/AbstractMessageHandler";
import {MessageRequestInterface} from "../core/MessageRequestInterface";
import {SendNewTransactionService} from "../../services/send-new-transaction.service";
import {TransactionBuildRequest} from "../../shared/types";
import { autoInjectable, singleton } from 'tsyringe';

export interface NewTransactionRequestInterface extends MessageRequestInterface {
    params: {
        outputs: TransactionBuildRequest[];
        metadata?: any;
        certificates?: any[];
        withdrawals?: any[];
        allowNoOutputs?: boolean;
    }
}

@singleton()
@autoInjectable()
export class NewTransactionHandler extends AbstractMessageHandler {
    constructor(private sendNewTransactionService?: SendNewTransactionService) {
        super();
    }

    public async handle(request: NewTransactionRequestInterface) {
        const buildResult = await this.sendNewTransactionService.buildTransaction(
            request.params.outputs,
            request.params?.metadata,
            request.params?.certificates,
            request.params?.withdrawals
        );
        request.cb(buildResult);
    }
}