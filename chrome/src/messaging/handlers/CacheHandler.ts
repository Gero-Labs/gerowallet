/* eslint-disable prettier/prettier */
import { autoInjectable, Lifecycle, scoped } from "tsyringe";

export enum CacheType {
    transactions,
    history,
    assetsIcons,
    walletDetails,
    usedAddresses,
    unusedAddresses,
    addressInfo,
    assetInfo,
    Arweave,
    ArweaveRequest,
    stakingInfo,
    poolInfo,
    utxos,
    rewardUtxos
}
export interface Cache {
    timestamp: Date;
    data: any
}
@scoped(Lifecycle.ContainerScoped)
@autoInjectable()
export class CacheHandler {
    private readonly expireAt = 1000 * 60 * 2;
    private cache = new Map<string, Cache>([]);

    public set(key: number | string, type: CacheType, data: any): void {
        const generatedKey = this.generateKey(key, type);
        this.cache.set(generatedKey, { timestamp: new Date(), data });
    }

    public get(key: number | string, type: CacheType, canExpire = false, overrideExpireAt: number | undefined = undefined): any | null {
        const generatedKey = this.generateKey(key, type);
        if (!this.cache.has(generatedKey)) {
            return null;
        }
        const result = this.cache.get(generatedKey);
        if (canExpire && (!result?.timestamp || this.isExpired(result.timestamp, overrideExpireAt))) {
            return null;
        }
        return result?.data;
    }

    private generateKey = (key: number | string, type: CacheType): string => `${key}-${type}`;

    private isExpired(timestamp: Date, overrideExpireAt: number | undefined = undefined): boolean {
        const expireAt = overrideExpireAt !== undefined ? overrideExpireAt : this.expireAt;
        return (timestamp.getTime() + expireAt < new Date().getTime());
    }

}
