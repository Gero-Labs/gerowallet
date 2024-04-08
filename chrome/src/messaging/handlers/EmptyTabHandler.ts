import { AbstractMessageHandler } from '../core/AbstractMessageHandler';
import { MessageRequestInterface } from '../core/MessageRequestInterface';

export class EmptyTabHander extends AbstractMessageHandler {
  handle(request: MessageRequestInterface): void {
    if(!request.tabFound) {
      chrome.tabs.create({
        url: "index.html?#/"
      });
    } else {
      chrome.tabs.update(request.tabToUpdate, {selected: true,  url: "index.html?#/"});
    }
  }
}
