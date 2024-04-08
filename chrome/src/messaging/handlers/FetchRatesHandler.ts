import {AbstractMessageHandler} from "../core/AbstractMessageHandler";
import {MessageRequestInterface} from "../core/MessageRequestInterface";
import { RatesService } from "../../api";
import { autoInjectable } from 'tsyringe';
import { LogService } from '../../services/log.service';

interface FetchRatesRequestParams extends MessageRequestInterface{
  params: {
    baseCurrency: string,
    fromCurrency: string[]
  }
}

@autoInjectable()
export class FetchRatesHandler extends AbstractMessageHandler {
    constructor(private logService: LogService) {
        super();
    }

    async handle(request: FetchRatesRequestParams) {
      await new RatesService(request.params.fromCurrency, request.params.baseCurrency.toLowerCase(), this.logService).getLatestRateFromApi();
      request.cb();
    }
}
