import {AbstractMessageHandler} from "../core/AbstractMessageHandler";
import {MessageRequestInterface} from "../core/MessageRequestInterface";
import { PoolsApiService } from "../../api";
import { autoInjectable } from "tsyringe";

@autoInjectable()
export class ListPoolsHandler extends AbstractMessageHandler {
    constructor(private poolsApiService?: PoolsApiService) {
        super();
    }

    async handle(request: MessageRequestInterface) {
        const pools = await this.poolsApiService.getAvailablePools();
        request.cb(pools);
    }
}
