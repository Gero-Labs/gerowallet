import { AbstractModel } from '../database/models/AbstractModel';
import { IDataPayload } from '../database/GeroWalletDatabase';
import { GERO_CARDANO_SERVER } from '../constants';
import { LastSyncInfo } from '../database/models/LastSyncInfo';

export class LastSyncInfoService extends AbstractModel {
    constructor() {
        super('lastSyncInfo');
    }

    public async getBestBlock(): Promise<void> {
        const block = await fetch(`${GERO_CARDANO_SERVER}/v2/bestblock`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        })
            .then((res) => res.json())
            .catch((error) => {
                localStorage.setItem('bestblock-status', 'false');
                throw new Error(`some error for getBestBlock: ${error}`);
            });

        if (block && block.hash) {
            localStorage.setItem('bestblock-status', 'true');
            const lastSyncInfo: LastSyncInfo = {
                blockHash: block.hash,
                height: block.height,
                time: new Date(),
                slotNum: block.slot,
                epoch: block.epoch,
                genesis_slot: block.genesis_slot,
            };
            this.addToDatabase(lastSyncInfo);
        }
    }

    private addToDatabase(lastSyncInfo: LastSyncInfo) {
        this.getAll().then((result) => {
            const data = result.payload as IDataPayload[];
            if (data.length === 0) {
                this.saveNew(lastSyncInfo);
            } else {
                this.put({
                    ...lastSyncInfo,
                    lastSyncInfoId: 1,
                });
            }
        });
    }
}
