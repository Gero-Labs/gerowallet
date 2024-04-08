import { autoInjectable, singleton } from 'tsyringe';
import { AbstractMessageHandler } from '../core/AbstractMessageHandler';
import { MessageRequestInterface } from '../core/MessageRequestInterface';
import { CollateralService } from '../../services/CollateralService';


@singleton()
@autoInjectable()
export class DAppRemoveCollateralHandler extends AbstractMessageHandler {
  constructor(private collateralService?: CollateralService) {
    super();
  }

  async handle(request: MessageRequestInterface) {
    await this.collateralService.removeCollateral();
    request.cb();
  }
}
