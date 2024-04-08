import { AssetModel, AssetModelExtended, TransactionDirection,  } from '../../shared/types';

export type TransactionStatus = 'Pending' | 'Failed';

export interface IPendingTransaction {
    stakeKey: string;
    type: string;
    from: string;
    to: string;
    date: Date;
    amountADA: number;
    feeADA: number;
    totalADA: number;
    status: TransactionStatus;
    direction: TransactionDirection;
    poolId?: string;
    assets: AssetModel[];
    ttl: number;
    hash: string;
}

export class PendingTransaction implements IPendingTransaction {
    stakeKey: string;
    type: string;
    from: string;
    to: string;
    date: Date;
    amountADA: number;
    feeADA: number;
    totalADA: number;
    status: TransactionStatus;
    direction: TransactionDirection;
    poolId?: string;
    assets: AssetModelExtended[];
    ttl: number;
    hash: string;

    constructor(stakeKey: string) {
        this.stakeKey = stakeKey;
        this.direction = TransactionDirection.Send;
    }
}
