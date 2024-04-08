import { autoInjectable, singleton } from 'tsyringe';
import { WalletInfoService } from "../../services/wallet-info.service";
import { AbstractMessageHandler } from "../core/AbstractMessageHandler";
import { MessageRequestInterface } from "../core/MessageRequestInterface";
import { ConceptualWalletService } from '../../api/conceptual-wallet.service';
import { AsyncLoader } from '../../shared/AsyncLoader';
import { UsedUnusedAddressesService } from '../../services/usedUnusedAddresses.service';
import { BalanceService } from '../../services/balance.service';

@singleton()
@autoInjectable()
export class DAppGetInfoHandler extends AbstractMessageHandler {

  constructor(
    private walletInfoService?: WalletInfoService,
    private conceptualWalletService?: ConceptualWalletService,
    private usedUnusedAddressesService?: UsedUnusedAddressesService,
  ){
    super();
  }

  async handle(request: MessageRequestInterface) {
    const conceptualWalletId = this.conceptualWalletService.getCurrentActiveWalletId();
    const walletInfo = await this.walletInfoService.getData(conceptualWalletId);

    const { usedAddresses, unusedAddresses } = await this.usedUnusedAddressesService.getUsedUnusedAddresses(conceptualWalletId);

    request.cb({
      address: walletInfo.address,
      rewardAddress: Buffer.from(
        AsyncLoader.Serialization.Address.from_bech32(walletInfo.rewardAddress).to_bytes()
      ).toString('hex'),
      usedAddresses: usedAddresses.map(address => Buffer.from(
        AsyncLoader.Serialization.Address.from_bech32(address).to_bytes()
      ).toString('hex')),
      unusedAddresses: [ Buffer.from(
        AsyncLoader.Serialization.Address.from_bech32(unusedAddresses[0]).to_bytes()
      ).toString('hex')]
    });
  }

}
