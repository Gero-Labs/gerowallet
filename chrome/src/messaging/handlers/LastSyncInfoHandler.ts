import {AbstractMessageHandler} from "../core/AbstractMessageHandler";
import {MessageRequestInterface} from "../core/MessageRequestInterface";
import {LastSyncInfoService} from "../../api/last-sync-info.service";

export class LastSyncInfoHandler extends AbstractMessageHandler {
    async handle(request: MessageRequestInterface) {
        await new LastSyncInfoService().getBestBlock();
        request.cb();
    }
}
