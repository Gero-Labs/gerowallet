/* eslint-disable prettier/prettier */
import { AbstractMessageHandler } from '../core/AbstractMessageHandler';
import { MessageRequestInterface } from '../core/MessageRequestInterface';
import { ConceptualWalletService } from '../../api/conceptual-wallet.service';
import {autoInjectable, singleton} from 'tsyringe';
import { CacheHandler } from './CacheHandler';
import { CacheType } from '.';

@singleton()
@autoInjectable()
export class GetWalletsListHandler extends AbstractMessageHandler {
  constructor(
      private cache: CacheHandler,
      private conceptualWalletService?: ConceptualWalletService,
      ) {
    super();
  }
  async handle(request: MessageRequestInterface) {
    try {
      const wallets = await this.conceptualWalletService.map(wallet => {
        const result = this.cache.get(wallet?.conceptualWalletId, CacheType.utxos);
        return {
          name: wallet.name,
          id: wallet?.conceptualWalletId,
          balance: result?.transactions?.totalBalance,
          address: wallet?.address,
          color: wallet?.color,
          rewardAddress: wallet?.rewardAddress,
          assets: result?.transactions?.assets,
          walletType: wallet.walletType,
          listOrder: wallet.listOrder,
          partner: wallet.partner
        };
      });

      return request.cb(wallets);
    } catch {
      return request.cb({ error: 'get-wallets-list error' });
    }
  }
}
