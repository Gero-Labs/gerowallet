import { GERO_CARDANO_SERVER } from '../constants';
import { PoolSummary } from '../models/pool-summary';

export class PoolInfoService {
    public async getPoolMetadata(poolId: string): Promise<PoolSummary> {
        const result = await fetch(`${GERO_CARDANO_SERVER}/poolInfo/${poolId}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        }).catch((error) => {
            throw new Error(`error fetching pool info: ${error}`);
        });

        return result.json().then((poolInfo: PoolSummary) => poolInfo);
    }
}
