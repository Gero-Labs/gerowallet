import { db } from '../database/GeroWalletDatabase';
import { CreateWalletService } from '../database/services/CreateWalletService';
import { autoInjectable, singleton } from 'tsyringe';

@singleton()
@autoInjectable()
export class InitialDataTablesService {
    constructor(private createWalletService?: CreateWalletService) {}

    public async setDefaultDatabaseValues(): Promise<void> {
        await db.network.toArray().then((networks) => {
            if (networks.length === 0) {
                this.createWalletService.createNetwork();
            }
        });
    }
}
