import { AbstractMessageHandler } from '../core/AbstractMessageHandler';
import { MessageRequestInterface } from '../core/MessageRequestInterface';
import { ChromeTabFinder } from '../../shared/ChromeTabFinder';
import { ConceptualWalletService } from '../../api/conceptual-wallet.service';
import {autoInjectable, singleton} from 'tsyringe';

@singleton()
@autoInjectable()
export class ImportWalletHandler extends AbstractMessageHandler {
  constructor(private conceptualWalletService?: ConceptualWalletService, private chromeTabFinder?: ChromeTabFinder) {
    super();
  }
  async handle(request: MessageRequestInterface): Promise<void> {
    const maxWalletAmountAchieved = await this.conceptualWalletService.maxAmountAchieved();

    if (!maxWalletAmountAchieved) {
      if (!request.tabFound) {
        const tabId = this.chromeTabFinder.isTab(request.message);
        if (!tabId) {
          chrome.tabs.create({
            url: 'index.html?#/import-wallet-step-1'
          });
        }
      } else {
        chrome.tabs.update(request.tabToUpdate, { selected: true, url: 'index.html?#/import-wallet-step-1' });
      }
    } else {
      request.cb({error: 'max-wallet.js-amount-achieved'})
    }
  }
}
