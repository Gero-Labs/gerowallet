import { autoInjectable, singleton } from 'tsyringe';
import { ConceptualWalletService } from '../api/conceptual-wallet.service';
import { CollateralRepository } from '../repositories';

@singleton()
@autoInjectable()
export class CollateralService {
  constructor(
    private conceptualWalletService: ConceptualWalletService,
    private collateralRepository: CollateralRepository
  ) {
  }

  public async isCollateralSet(): Promise<boolean> {
    const conceptualWalletId = this.conceptualWalletService.getCurrentActiveWalletId();

    if (conceptualWalletId === undefined) {
      return false;
    }

    return await this.collateralRepository.get(conceptualWalletId) !== undefined;
  };

  public async removeCollateral() {
    const conceptualWalletId = this.conceptualWalletService.getCurrentActiveWalletId();

    if (conceptualWalletId !== undefined) {
      const collateral = await this.collateralRepository.get(conceptualWalletId);

      await this.collateralRepository.remove(collateral);
    }
  }
}
