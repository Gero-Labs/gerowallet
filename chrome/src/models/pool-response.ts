export interface PoolResponse {
    [hash: string]: PoolInfo;
}

export interface PoolInfo {
    pool_id_hash: string;
    pool_id: string;
    name: string;
    url: string;
    stake: string;
    tax_ratio: string;
    tax_fix: string;
    roa_short: string;
}
