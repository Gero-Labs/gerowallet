import { autoInjectable, singleton } from 'tsyringe';
import { AbstractMessageHandler } from '../core/AbstractMessageHandler';
import { ConceptualWalletService } from '../../api/conceptual-wallet.service';
import { ConnectionRepository } from '../../repositories';
import { ConnectionWalletMessageRequest } from './ConnectionWalletSiteHandler';

@singleton()
@autoInjectable()
export class DAppIsEnabledHandler extends AbstractMessageHandler {

  constructor(private conceptualWalletService?: ConceptualWalletService) {
    super();
  }

  async handle(request: ConnectionWalletMessageRequest) {
    const origin = request.sender.origin;
    const walletId = this.conceptualWalletService.getCurrentActiveWalletId();
    const repository = new ConnectionRepository();
    const connection = await repository.get(walletId);
    const walletConnected = connection?.websites.find(w => w === origin);
    request.cb({ connected: walletConnected !== undefined });
  }
}
