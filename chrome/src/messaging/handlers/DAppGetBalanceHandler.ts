import { autoInjectable, singleton } from 'tsyringe';
import { AbstractMessageHandler } from "../core/AbstractMessageHandler";
import { MessageRequestInterface } from "../core/MessageRequestInterface";
import { ConceptualWalletService } from '../../api/conceptual-wallet.service';
import { BalanceService } from '../../services/balance.service';

@singleton()
@autoInjectable()
export class DAppGetBalanceHandler extends AbstractMessageHandler {

  constructor(
    private conceptualWalletService?: ConceptualWalletService,
    private balanceService?: BalanceService
  ){
    super();
  }

  async handle(request: MessageRequestInterface) {
    const conceptualWalletId = this.conceptualWalletService.getCurrentActiveWalletId();
    const totalBalanceFormatted = await this.balanceService.getTotalBalance(conceptualWalletId);

    request.cb({
      balance: Buffer.from(totalBalanceFormatted.to_bytes()).toString('hex'),
    });
  }

}
