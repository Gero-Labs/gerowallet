import { AbstractMessageHandler } from "../core/AbstractMessageHandler";
import { MessageRequestInterface } from "../core/MessageRequestInterface";
import { autoInjectable, singleton } from 'tsyringe';
import { BlockFrostService } from '../../api/blockfrost.service';

@singleton()
@autoInjectable()
export class GetBlockfrostApiKeyHandler extends AbstractMessageHandler {
    constructor(private blockfrostService?: BlockFrostService) {
        super();
    }

    async handle(request: MessageRequestInterface) {
        await this.blockfrostService.fetchBlockfrostApiKey();
        request.cb();
    }
}
