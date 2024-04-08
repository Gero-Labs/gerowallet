import { AbstractMessageHandler } from '../core/AbstractMessageHandler';
import { autoInjectable } from 'tsyringe';

@autoInjectable()
export class RegisterPathHandler extends AbstractMessageHandler {
    handle(request: any) {
        chrome.browserAction.setPopup({ popup: `index.html#${request.params.path}` });
        request.cb();
    }
}