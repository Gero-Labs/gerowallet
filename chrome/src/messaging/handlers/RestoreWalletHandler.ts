import {AbstractMessageHandler} from "../core/AbstractMessageHandler";
import {MessageRequestInterface} from "../core/MessageRequestInterface";
import {WalletService} from "../../services/WalletService";
import {RestoreWalletRequest} from "../../shared/types";
import { autoInjectable, singleton } from 'tsyringe';

export interface RestoreWalletMessageRequestInterface extends MessageRequestInterface {
    params: {
        request: RestoreWalletRequest
    }
}

@singleton()
@autoInjectable()
export class RestoreWalletHandler extends AbstractMessageHandler {
    constructor(private walletService?: WalletService) {
        super();
    }
    public async handle(request: RestoreWalletMessageRequestInterface) {
        const conceptualWalletId = await this.walletService.restoreWallet(request.params.request);
        request.cb(conceptualWalletId);
    }
}
