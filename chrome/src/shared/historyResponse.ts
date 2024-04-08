export type HistoryResponse = Array<RemoteTransaction>;

export type RemoteTxState = 'Successful' | 'Failed' | 'Pending';

export type RemoteWithdrawal = {
    address: string; // hex
    amount: string;
};

export type RemoteTransactionShelley = {
    ttl?: string;
    fee: string;
    certificates: RemoteCertificate[];
    withdrawals: Array<RemoteWithdrawal>;
    metadata: null | string;
};

export enum ShelleyCertificateTypes {
    StakeRegistration = 'StakeRegistration',
    StakeDeregistration = 'StakeDeregistration',
    StakeDelegation = 'StakeDelegation',
    PoolRegistration = 'PoolRegistration',
    PoolRetirement = 'PoolRetirement',
    GenesisKeyDelegation = 'GenesisKeyDelegation',
    MoveInstantaneousRewardsCert = 'MoveInstantaneousRewardsCert',
}

export type RemoteStakeRegistrationCert = {
    rewardAddress: string; // hex
};

export type RemoteCertificate = {
    certIndex: number;
    kind: ShelleyCertificateTypes;
    remoteCert: RemoteStakeRegistrationCert;
};

export interface RemoteTxBlockMeta {
    height: number | null;
    block_hash: string | null;
    tx_ordinal: number | null;
    time: string | null; // timestamp with timezone
    epoch: number | null;
    slot: number | null;
    block_num: number | null;
}

type $PropertyType<T, k extends keyof T> = T[k];

export interface RemoteTransactionBase extends RemoteTxBlockMeta {
    hash: string;
    last_update: string; // timestamp with timezone
    tx_state: RemoteTxState;
    inputs: Array<RemoteTransactionInput>;
    outputs: Array<RemoteTransactionOutput>;
}

export interface RemoteTransaction extends RemoteTransactionBase, RemoteTransactionShelley {
    type: $PropertyType<RemoteTransactionTypeT, 'shelley'>;
    // RemoteTransactionBase,
    // RemoteTransactionShelley,
}

type RemoteTransactionTypeT = {
    byron: void | 'byron';
    shelley: 'shelley';
};

export interface TransactionAsset {
    amount: string;
    assetId: string;
    policyId: string;
    name: string;
}

export type RemoteTransactionInput = {
    id: string;
    index: number; // index of output we're consuming
    txHash: string; // tx that created output we're consuming
    address: string;
    amount: string;
    assets: TransactionAsset[];
};

export type RemoteTransactionOutput = {
    address: string;
    amount: string;
    assets: TransactionAsset[];
};
