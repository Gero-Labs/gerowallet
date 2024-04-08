import { validateSync } from 'class-validator';
import { Pool, PoolInfo, PoolResponse } from '../models';
import { LogService } from '../services/log.service';
import {config} from "../config";
import { autoInjectable } from 'tsyringe';

@autoInjectable()
export class PoolsApiService {

    constructor(private logService: LogService) {
    }

    private readonly baseUrl = config.poolsUrl;

    public async getAvailablePools() {
        const result = this.getAvailablePoolsFromApi();
        return result
            .then((poolsResponse: PoolResponse) => {
                const pools = [];
                Object.keys(poolsResponse).forEach((poolId) => {
                    const pool = this.mapResponseToPool(poolsResponse[poolId]);
                    if (pool) {
                        pools.push(pool);
                    }
                });
                return pools;
            })
            .catch((error) => {
                this.logService.log(`PoolsService error: ${JSON.stringify(error)}`);
                return [];
            });
    }

    private async getAvailablePoolsFromApi(): Promise<PoolResponse> {
        const response = await fetch(`${this.baseUrl}/list.json`, {
            method: 'GET',
        });
        return response.json().then( poolsList => {
            return poolsList.data;
        });
    }

    private mapResponseToPool(poolResponse: PoolInfo): Pool {
        const pool = new Pool(poolResponse);
        const errors = validateSync(pool);
        if (errors.length === 0) {
            return pool;
        }
        return undefined;
    }
}
