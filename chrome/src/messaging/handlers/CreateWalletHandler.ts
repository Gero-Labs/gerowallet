import { AbstractMessageHandler } from '../core/AbstractMessageHandler';
import { MessageRequestInterface } from '../core/MessageRequestInterface';
import { ConceptualWalletService } from '../../api/conceptual-wallet.service';
import {autoInjectable, singleton} from 'tsyringe';

@singleton()
@autoInjectable()
export class CreateWalletHandler extends AbstractMessageHandler {
  constructor(private conceptualWalletService?: ConceptualWalletService) {
    super();
  }
  async handle(request: MessageRequestInterface) {
    const maxWalletAmountAchieved = await this.conceptualWalletService.maxAmountAchieved();

    if (!maxWalletAmountAchieved) {
      if (!request.tabFound) {
        chrome.tabs.create({
          url: 'index.html?#/create-wallet-step-1'
        });
      } else {
        chrome.tabs.update(request.tabToUpdate, { selected: true, url: 'index.html?#/create-wallet-step-1' });
      }
    } else {
      request.cb({ error: 'max-wallet.js-amount-achieved' });
    }
  }
}
