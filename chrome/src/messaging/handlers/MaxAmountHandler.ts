import {AbstractMessageHandler} from "../core/AbstractMessageHandler";
import {MessageRequestInterface} from "../core/MessageRequestInterface";
import {TransactionBuildRequest} from "../../shared/types";
import { autoInjectable, singleton } from 'tsyringe';
import { SendNewTransactionService } from "../../services/send-new-transaction.service";

interface MaxAccountRequest extends MessageRequestInterface {
    params: {
        outputs: TransactionBuildRequest[];
        metadata: any;
        certificates?: any[];
        withdrawals?: any[];
        allowNoOutputs: boolean;
    }
}

@singleton()
@autoInjectable()
export class MaxAmountHandler extends AbstractMessageHandler {
    constructor(private sendNewTransactionService?: SendNewTransactionService) {
        super();
    }

    async handle(request: MaxAccountRequest) {
        const result = await this.sendNewTransactionService.getMaxAmount(
            request.params.outputs,
        );
        request.cb(result);
    }
}
