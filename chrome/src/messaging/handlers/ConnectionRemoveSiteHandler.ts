import { MessageRequestInterface } from '../core/MessageRequestInterface';
import { autoInjectable, singleton } from 'tsyringe';
import { AbstractMessageHandler } from '../core/AbstractMessageHandler';
import { ConnectionService } from '../../services/ConnectionService';

export interface ConnectionRemoveSiteMessageRequest extends MessageRequestInterface {
  params: {
    conceptualWalletId: number;
    website: string
  }
}

@singleton()
@autoInjectable()
export class ConnectionRemoveSiteHandler extends AbstractMessageHandler {
  constructor(private connectionService: ConnectionService) {
    super();
  }

  async handle(request: ConnectionRemoveSiteMessageRequest) {
    const walletId = request.params.conceptualWalletId;
    const website = request.params.website;

    try {
      await this.connectionService.removeWebsite(walletId, website);
      request.cb();
    } catch {
      request.cb({ error: `Failed to remove ${website} for id: ${walletId}`});
    }
  }
}
