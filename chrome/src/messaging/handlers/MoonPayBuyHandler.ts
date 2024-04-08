import {AbstractMessageHandler} from "../core/AbstractMessageHandler";
import {MessageRequestInterface} from "../core/MessageRequestInterface";
import {EnabledPaymentMethods, MoonPayBuilder} from "../../services/moonpay.service";
import { LogService } from '../../services/log.service';
import { autoInjectable } from 'tsyringe';

interface MoonPayRequestInterface extends MessageRequestInterface {
    params: {
        paymentMethod: EnabledPaymentMethods;
        address: string;
        baseCurrency: string;
    }
}

@autoInjectable()
export class MoonPayBuyHandler extends AbstractMessageHandler {

    constructor(private logService: LogService) {
        super();
    }
    handle(request: MoonPayRequestInterface) {
        new MoonPayBuilder(request.params.paymentMethod, request.params.address, request.params.baseCurrency, this.logService)
            .getURLConstructed()
            .then(url => {
            chrome.tabs.create({
                url
            });
        });
    }
}
