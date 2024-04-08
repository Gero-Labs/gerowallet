import { inject, injectable, singleton } from 'tsyringe';
import { Value } from '@emurgo/cardano-serialization-lib-browser';
import { assetsToValue } from '../shared/asset-utils';
import { TransactionsService } from '../api/transactions.service';

@singleton()
@injectable()
export class BalanceService {
  constructor(
    @inject(TransactionsService) private transactionsService?: TransactionsService,
  ) {}

  public async getTotalBalance(conceptualWalletId: number): Promise<Value> {
    const transactions = await this.transactionsService.getTransactions(conceptualWalletId);
    const cardanoBalance = transactions.totalBalance;
    const assets = transactions.assets;
    const totalBalance = [];
    totalBalance.push({
      unit: 'lovelace',
      quantity: cardanoBalance.toString(),
    });
    assets.forEach(asset => {
      totalBalance.push({
        unit: asset.policyId + asset.name,
        quantity: asset.amount.toString(),
      })
    });
    return assetsToValue(totalBalance);
  }
}
