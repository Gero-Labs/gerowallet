import { AbstractMessageHandler } from "../core/AbstractMessageHandler";
import { MessageRequestInterface } from "../core/MessageRequestInterface";
import { autoInjectable, singleton } from 'tsyringe';
import { Paginate } from "../../dAppConnector/types";
import { UtxosService } from "../../services/utxos.service";

interface DAppGetUtxoHandlerRequestParams extends MessageRequestInterface{
    params: {
        amount: string | undefined,
        paginate: Paginate | undefined
    }
}

@singleton()
@autoInjectable()
export class DAppGetUtxoHandler extends AbstractMessageHandler {
    constructor(
        private utxosService?: UtxosService,
    ){
        super();
    }

    async handle(request: DAppGetUtxoHandlerRequestParams) {
        const utxosCbor = await this.utxosService.getUtxos(request.params.amount, request.params.paginate);
        request.cb(utxosCbor);
    }
}
