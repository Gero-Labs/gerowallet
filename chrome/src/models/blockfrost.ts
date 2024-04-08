export interface BlockfrostAssetInfoResponse {
    asset: string;
    policy_id: string;
    assetsPerPolicyId: number;
    asset_name: string;
    fingerprint: string;
    quantity: string;
    initial_mint_tx_hash: string;
    mint_or_burn_count: number;
    onchain_metadata: {
        name: string;
        image?: string | string[];
        tokenType?: string;
        files?: string[];
    };
    metadata: {
        name: string;
        description: string;
        ticker: string;
        url: string;
        logo: string;
        decimals: number;
    };
}
