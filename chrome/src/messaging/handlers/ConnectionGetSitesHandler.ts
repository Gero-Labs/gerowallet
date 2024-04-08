import { autoInjectable, singleton } from 'tsyringe';
import { AbstractMessageHandler } from '../core/AbstractMessageHandler';
import { MessageRequestInterface } from '../core/MessageRequestInterface';
import { ConnectionService } from '../../services/ConnectionService';

export interface ConnectionGetSitesMessageRequest extends MessageRequestInterface {
  params: {
    conceptualWalletId: number;
  }
}

@singleton()
@autoInjectable()
export class ConnectionGetSitesHandler extends AbstractMessageHandler {
  constructor(private connectionService: ConnectionService) {
    super();
  }

  async handle(request: ConnectionGetSitesMessageRequest) {
    const websites = await this.connectionService.getWebsites(request.params.conceptualWalletId);
    request.cb(websites);
  }
}
