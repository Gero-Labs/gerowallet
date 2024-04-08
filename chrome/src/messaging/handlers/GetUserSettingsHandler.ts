import { AbstractMessageHandler } from "../core/AbstractMessageHandler";
import { MessageRequestInterface } from "../core/MessageRequestInterface";
import { db } from '../../database/GeroWalletDatabase';
import { ConceptualWalletService } from '../../api/conceptual-wallet.service';
import {autoInjectable, singleton} from 'tsyringe';
export interface UserSettingsMessageRequest extends MessageRequestInterface {
    params: {
        conceptualWalletId: number;
    }
  }
  
@singleton()
@autoInjectable()
export class GetUserSettingsHandler extends AbstractMessageHandler {
    constructor(private conceptualWalletService?: ConceptualWalletService) {
        super();
    }
    public async handle(request: UserSettingsMessageRequest) {
        if (request.params.conceptualWalletId) {
            const conceptualWalletId = await this.conceptualWalletService.checkId(request.params.conceptualWalletId);
            const settings = await db.userSettings.get(conceptualWalletId);
            request.cb(settings);
        } else {
            request.cb(undefined);  
        }

    }
}
