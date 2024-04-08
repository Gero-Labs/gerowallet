import { autoInjectable, singleton } from 'tsyringe';
import { AbstractMessageHandler } from '../core/AbstractMessageHandler';
import { MessageRequestInterface } from '../core/MessageRequestInterface';
import { ConnectionService } from '../../services/ConnectionService';

export interface ConnectionWalletMessageRequest extends MessageRequestInterface {
  params: {
    conceptualWalletIds: number[];
    website: string;
  }
}

@singleton()
@autoInjectable()
export class ConnectionWalletsSiteHandler extends AbstractMessageHandler {
  constructor(private connectionService: ConnectionService) {
    super();
  }

  async handle(request: ConnectionWalletMessageRequest) {
    await this.connectionService.connectWebsite(request.params.conceptualWalletIds, request.params.website);
    request.cb({ connected: true });
  }
}
