import { db } from '../database/GeroWalletDatabase';
import { ConceptualWallet, IConceptualWallet } from '../database/models/ConceptualWallet';
import { autoInjectable, singleton } from 'tsyringe';

@singleton()
@autoInjectable()
export class ConceptualWalletService {
    public async exists(conceptualWalledId: number): Promise<boolean> {
        const wallets = await this.getAll();
        return wallets.some((w) => w.conceptualWalletId === conceptualWalledId);
    }

    public async checkId(id: number): Promise<number | undefined> {
        const conceptualWalletExists = await this.exists(id);

        if (!conceptualWalletExists) {
            const initialWalletId = await this.getInitialId();

            if (!initialWalletId) {
                return undefined;
            }

            //in case the provided conceptualWalletId does not exist and we return the initialId
            //then we update the localStorage, so anyone that needs it, gets the updated number

            localStorage.setItem('conceptualWalletId', initialWalletId.toString());
            return initialWalletId;
        }

        return id;
    }

    public async getInitialId(): Promise<number | undefined> {
        const initialWallet = await this.getInitial();
        return initialWallet?.conceptualWalletId;
    }

    public getCurrentActiveWalletId(): number | undefined {
        const id = localStorage.getItem('conceptualWalletId');

        if (id !== undefined) {
            return +id;
        }

        return undefined;
    }

    public async maxAmountAchieved(): Promise<boolean> {
        const wallets = await this.getAll();
        return wallets.length >= 8;
    }

    public async map(mapFn: (wallet: ConceptualWallet) => any): Promise<ConceptualWallet[]> {
        const wallets = await this.getAll();
        return wallets.map(mapFn);
    }

    public async find(id: number): Promise<ConceptualWallet> {
        const wallets = await this.getAll();
        return wallets.find((x) => x.conceptualWalletId === id);
    }

    public isCurrentActiveWallet(id: number): boolean {
        return +localStorage.getItem('conceptualWalletId') === id;
    }

    public setName(id: number, name: string) {
        db.conceptualWallet.update(id, { name });
    }

    public setColor(id: number, color: string) {
        db.conceptualWallet.update(id, { color });
    }

    setBalance(id: number, balance: number) {
        db.conceptualWallet.update(id, { balance });
    }

    setHistory(id: number, history: any[]) {
        // Mapping BigInt instance to string
        const updatedHistory = history.map((h) => ({ ...h, value: h.value.toString() }));
        db.conceptualWallet.update(id, { history: updatedHistory });
    }

    setAddress(id: number, address: string) {
        db.conceptualWallet.update(id, { address });
    }

    setListOrder(id: number, listOrder: number) {
        db.conceptualWallet.update(id, { listOrder });
    }

    setRewardAddress(id: number, rewardAddress: string) {
        db.conceptualWallet.update(id, { rewardAddress });
    }

    public async getAll(): Promise<ConceptualWallet[]> {
        return db.conceptualWallet.orderBy('listOrder').toArray();
    }

    private async getInitial(): Promise<ConceptualWallet | undefined> {
        return db.conceptualWallet.toCollection().first();
    }

    public async getLatestListOrder(): Promise<number> {
        const wallets = await this.getAll();

        if(wallets.length === 0) {
            return 0;
        } else {
            let listOrder: number = 0;
            wallets.forEach(x => {
                if(x.listOrder > listOrder) {
                    listOrder = x.listOrder;
                }
            });

            return listOrder;
        }
    }
}
