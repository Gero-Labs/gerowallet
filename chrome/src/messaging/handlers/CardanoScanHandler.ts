import {AbstractMessageHandler} from "../core/AbstractMessageHandler";
import {MessageRequestInterface} from "../core/MessageRequestInterface";

interface CardanoScanRequestParams extends MessageRequestInterface{
    params: {
        address: string
    }
}

export class CardanoScanHandler extends AbstractMessageHandler {
    handle(request: CardanoScanRequestParams) {
        chrome.tabs.create({
            url: `https://cardanoscan.io/address/${request.params.address}`
        })
    }
}
