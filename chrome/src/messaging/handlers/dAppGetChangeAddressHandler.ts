import { autoInjectable, singleton } from 'tsyringe';
import { AbstractMessageHandler } from "../core/AbstractMessageHandler";
import { MessageRequestInterface } from "../core/MessageRequestInterface";
import { ConceptualWalletService } from '../../api/conceptual-wallet.service';
import { WalletAddressesService } from '../../shared/wallet-addresses.service';
import { AsyncLoader } from '../../shared/AsyncLoader';

@singleton()
@autoInjectable()
export class DAppGetChangeAddressHandler extends AbstractMessageHandler {

  constructor(
    private walletAddressesService?: WalletAddressesService,
    private conceptualWalletService?: ConceptualWalletService,
  ){
    super();
  }

  async handle(request: MessageRequestInterface) {
    const conceptualWalletId = this.conceptualWalletService.getCurrentActiveWalletId();

    const changeAddressBech32 = await this.walletAddressesService.getMainAddress(conceptualWalletId);
    const changeAddress = Buffer.from(
      AsyncLoader.Serialization.Address.from_bech32(changeAddressBech32).to_bytes(),
    ).toString('hex');

    request.cb({
      changeAddress
    });
  }
}
