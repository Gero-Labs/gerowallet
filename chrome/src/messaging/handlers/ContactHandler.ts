import { AbstractMessageHandler } from '../core/AbstractMessageHandler';
import { MessageRequestInterface } from '../core/MessageRequestInterface';

export class ContactHandler extends AbstractMessageHandler {
    handle(request: MessageRequestInterface) {
        chrome.tabs.create({
            url: 'https://gerowallet.io/#contact',
        });
    }
}
