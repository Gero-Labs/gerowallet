import { autoInjectable, singleton } from 'tsyringe';
import { MessageRequestInterface } from '../core/MessageRequestInterface';
import { AbstractMessageHandler } from '../core/AbstractMessageHandler';
import { ConnectionService } from '../../services/ConnectionService';

export interface ConnectionWebsiteConnectedMessageRequest extends MessageRequestInterface {
  params: {
    origin: string;
    host: string;
  };
}

@singleton()
@autoInjectable()
export class ConnectionWebsiteConnectedHandler extends AbstractMessageHandler {
  constructor(private connectionService: ConnectionService) {
    super();
  }

 public async handle(request: ConnectionWebsiteConnectedMessageRequest) {
    let connectedWebsite = undefined;
    const tabs = await this.getTabs();
    const currentUrl = tabs && tabs.length ? new URL(tabs[0].url) : undefined;

    const connected = await this.connectionService.isWebsiteConnected(currentUrl?.origin);
    if (connected) {
      connectedWebsite = currentUrl;
    }
    request.cb(connectedWebsite);
  }

  private getTabs(): Promise<chrome.tabs.Tab[]> {
    return new Promise((resolve, reject) => {
        try {
            chrome.tabs.query({
                active: true, currentWindow: true
            }, (tabs) => resolve(tabs));
        } catch (e) {
            reject(e);
        }
    })
  }
}
