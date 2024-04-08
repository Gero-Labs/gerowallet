import { AbstractMessageHandler } from "../core/AbstractMessageHandler";
import { MessageRequestInterface } from "../core/MessageRequestInterface";
import { WalletInfoService } from "../../services/wallet-info.service";
import { ConceptualWalletService } from '../../api/conceptual-wallet.service';
import { CacheHandler, CacheType } from "./CacheHandler";
import { autoInjectable, singleton } from 'tsyringe';

interface WalletDetailsHandlerRequest extends MessageRequestInterface {
    params: {
        conceptualWalletId: number | undefined
    }
}
@singleton()
@autoInjectable()
export class WalletDetailsHandler extends AbstractMessageHandler {

    constructor(private cache: CacheHandler,
                private conceptualWalletService?: ConceptualWalletService,
                private walletInfoService?: WalletInfoService,
                ) {
        super();
    }

    async handle(request: WalletDetailsHandlerRequest) {
        const conceptualWalletId = await this.conceptualWalletService.checkId(request.params.conceptualWalletId);
        const cache = this.cache.get(conceptualWalletId, CacheType.walletDetails);
        if (!!cache) {
            request.cb(cache);
        }
        const data = await this.walletInfoService.getData(conceptualWalletId);
        this.cache.set(conceptualWalletId, CacheType.walletDetails, data);

        request.cb(data);
    }
}
