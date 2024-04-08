import { AbstractMessageHandler } from "../core/AbstractMessageHandler";
import { MessageRequestInterface } from "../core/MessageRequestInterface";
import { db } from '../../database/GeroWalletDatabase';

interface UpdateUserSettingsRequest extends MessageRequestInterface{
    params: {
        language?: string;
        currency?: string;
    }
}
export class UpdateUserSettingsHandler extends AbstractMessageHandler {

    handle(request: UpdateUserSettingsRequest) {
        const walletId = localStorage.getItem('conceptualWalletId');
        if(request.params.currency){
            db.userSettings.update(+walletId, {currency: request.params.currency});
        }
        if(request.params.language){
            db.userSettings.update(+walletId, {language: request.params.language});
        }
        request.cb();
    }
}
