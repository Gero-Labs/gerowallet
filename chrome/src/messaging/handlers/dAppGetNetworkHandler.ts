import { autoInjectable, singleton } from 'tsyringe';
import { config } from '../../config';
import { AsyncLoader } from '../../shared/AsyncLoader';
import { AbstractMessageHandler } from "../core/AbstractMessageHandler";
import { MessageRequestInterface } from "../core/MessageRequestInterface";

@singleton()
@autoInjectable()
export class DAppGetNetworkHander extends AbstractMessageHandler {

  constructor(){
    super();
  }

  async handle(request: MessageRequestInterface) {
    const network = config.network.id;

    request.cb({
      network: network
    });
  }
}
