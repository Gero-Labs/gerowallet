import { MessageRequestInterface } from '../core/MessageRequestInterface';
import { AbstractMessageHandler } from '../core/AbstractMessageHandler';
import { ConceptualWalletService } from '../../api/conceptual-wallet.service';
import {autoInjectable, singleton} from 'tsyringe';

interface UpdateWalletHandlerRequest extends MessageRequestInterface {
  params: {
    wallet: {
      id?: number,
      name?: string,
      color?: string,
      listOrder?: number,
    }
  }
}

@singleton()
@autoInjectable()
export class UpdateWalletHandler extends AbstractMessageHandler {
  constructor(private conceptualWalletService?: ConceptualWalletService) {
    super();
  }
  handle(request: UpdateWalletHandlerRequest) {
    const {listOrder, color, name, id } = request.params.wallet;

    try {
      if (name) {
        this.conceptualWalletService.setName(id, name);
      }

      if (color) {
        this.conceptualWalletService.setColor(id, color);
      }

      if (listOrder) {
        this.conceptualWalletService.setListOrder(id, listOrder);
      }
    } catch {
      request.cb({error: 'error-on-wallet.js-update'})
    }

    request.cb();
  }
}
