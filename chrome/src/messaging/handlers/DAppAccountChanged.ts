import { AbstractMessageHandler } from '../core/AbstractMessageHandler';
import { MessageRequestInterface } from '../core/MessageRequestInterface';
import { MessagingEvent, MessagingSender, MessagingTarget } from '../../dAppConnector/messaging';
import { UsedUnusedAddressesService } from '../../services/usedUnusedAddresses.service';
import { AsyncLoader } from '../../shared/AsyncLoader';
import { autoInjectable, singleton } from 'tsyringe';

interface DAppAccountChangedRequestParams extends MessageRequestInterface{
  params: {
    walletId: number
  }
}

@singleton()
@autoInjectable()
export class DAppAccountChanged extends AbstractMessageHandler {
  constructor(
    private usedUnusedAddressesService?: UsedUnusedAddressesService
  ) {
    super();
  }

  async handle(request: DAppAccountChangedRequestParams) {
    const walletId = request.params.walletId;
    const { usedAddresses } = await this.usedUnusedAddressesService.getUsedUnusedAddresses(walletId);

    const messagePayload = {
      data: [usedAddresses.map(address => Buffer.from(
        AsyncLoader.Serialization.Address.from_bech32(address).to_bytes()
      ).toString('hex'))],
      target: MessagingTarget.gero,
      sender: MessagingSender.extension,
      event: MessagingEvent.accountChange
    };
    if (typeof window !== 'undefined') {
      window.postMessage(messagePayload, window.origin);
    }
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) =>
        chrome.tabs.sendMessage(tab.id, messagePayload)
      );
    });
  }
}
