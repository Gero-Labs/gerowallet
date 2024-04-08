import { MessageRequestFactory } from './core/MessageRequestFactory';
import { TabInfo } from './core/tabInfo';
import MessageSender = chrome.runtime.MessageSender;

export class MessageController {
    constructor(private messageRequestFactory: MessageRequestFactory) {}

    handleMessageRequest(message: any, sender: MessageSender, response: any, tabInfo: TabInfo): void {
        const request = this.messageRequestFactory.prepareRequest(message, sender, response, tabInfo);
        this.messageRequestFactory.createHandler(request);
    }
}
