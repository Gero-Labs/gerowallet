import { autoInjectable, singleton } from 'tsyringe';
import { AbstractMessageHandler } from '../core/AbstractMessageHandler';
import { ConceptualWalletService } from '../../api/conceptual-wallet.service';
import { PopupService } from '../../services/popup.service';
import { ConnectionRepository } from '../../repositories';
import { ConnectionWalletMessageRequest } from './ConnectionWalletSiteHandler';

@singleton()
@autoInjectable()
export class DAppConnectionHandler extends AbstractMessageHandler {
  constructor(
    private conceptualWalletService?: ConceptualWalletService,
    private popupService?: PopupService
  ) {
    super();
  }

  async handle(request: ConnectionWalletMessageRequest) {
    const origin = request.sender.origin;
    if (origin) {
      const walletId = this.conceptualWalletService.getCurrentActiveWalletId();

      const repository = new ConnectionRepository();
      const connection = await repository.get(walletId);
      const walletConnected = connection?.websites.find(w => w === origin);
      if (walletConnected) {
        request.cb({ connected: true });
      } else {  
        const result: any = await this.popupService.showPopup(`index.html?#/connection?origin=${origin}`);
  
        request.cb({ connected: result === 'connected' });
      }
    } else {
      request.cb({ connected: false }); 
    }
  }
}
