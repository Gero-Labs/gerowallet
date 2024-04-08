import { db } from '../database/GeroWalletDatabase';
import { Collateral } from '../database/models/Collateral';
import { autoInjectable, singleton } from 'tsyringe';

@singleton()
@autoInjectable()
export class CollateralRepository {
  async get(conceptualWalletId: number): Promise<Collateral | undefined> {
    return db.collateral.where({ conceptualWalletId: conceptualWalletId }).last()
  }

  async getAll(): Promise<Collateral[]> {
    return db.collateral.toArray();
  }

  async add(collateral: Collateral) {
    db.collateral.add(collateral);
  }

  async remove(collateral: Collateral) {
    db.collateral.delete(collateral.collateral);
  }
}
