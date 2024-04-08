import { AbstractMessageHandler } from '../core/AbstractMessageHandler';
import { MessageRequestInterface } from '../core/MessageRequestInterface';
import { autoInjectable } from 'tsyringe';
import { APIError, ERROR, TxSendError } from '../../dAppConnector/api-error';
import { TransactionsService } from '../../api/transactions.service';

interface DAppSubmitHandlerRequestParams extends MessageRequestInterface {
    params: {
        tx: string;
    };
}
@autoInjectable()
export class DAppSubmitTXHandler extends AbstractMessageHandler {
    constructor(private transactionsService?: TransactionsService) {
        super();
    }

    async handle(request: DAppSubmitHandlerRequestParams) {
        try {
            const response = await this.transactionsService.sendTx({
                encodedTx: Buffer.from(request.params.tx, 'hex'),
            });
            if (response.error) {
                if (response.status_code === 400) {
                    throw new Error(TxSendError.Failure.info.concat('.', ' ', response.message));
                } else if (response.status_code === 500) throw new Error(APIError.InternalError.info);
                else if (response.status_code === 429) throw new Error(TxSendError.Refused.info);
                else if (response.status_code === 425) throw new Error(ERROR.fullMempool);
                else throw new Error(APIError.InvalidRequest.info);
            }
            request.cb({ result: response });
        } catch (error) {
            request.cb({ error });
            throw error;
        }
    }
}
