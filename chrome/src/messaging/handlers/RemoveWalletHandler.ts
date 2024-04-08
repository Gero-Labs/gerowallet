import { AbstractMessageHandler } from '../core/AbstractMessageHandler';
import { MessageRequestInterface } from '../core/MessageRequestInterface';
import { WalletService } from '../../services/WalletService';
import { ConceptualWalletService } from '../../api/conceptual-wallet.service';
import {autoInjectable, singleton} from 'tsyringe';

export interface RemoveWalletHandlerRequest extends MessageRequestInterface{
    params: {
        conceptualWalletId: number;
    }
}

@singleton()
@autoInjectable()
export class RemoveWalletHandler extends AbstractMessageHandler {
    constructor(private conceptualWalletService?: ConceptualWalletService, private walletService?: WalletService) {
        super();
    }
    async handle(request: RemoveWalletHandlerRequest) {
        try {
          const walletId = request.params.conceptualWalletId;

          this.walletService.removeConceptualWalletEntries(walletId);

          if (this.conceptualWalletService.isCurrentActiveWallet(walletId)) {
            const initialWalletId = await this.conceptualWalletService.checkId(walletId);

            if (initialWalletId) {
              request.cb({ conceptualWalletId: initialWalletId });
              return;
            }

            request.cb({ conceptualWalletId: -1 });
          } else {
            request.cb({ conceptualWalletId: undefined });
          }
        } catch (e) {
          request.cb({ error: `Failed to remove the wallet.` });
        }
    }
}
