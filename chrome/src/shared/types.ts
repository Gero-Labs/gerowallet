import { Partner, WalletColor, WalletType } from "../database/models/ConceptualWallet";
export * from './txscan';

export type RestoreWalletRequest = {
    recoveryPhrase: string;
    walletName: string;
    walletPassword: string;
    walletColor: WalletColor;
    partner: Partner;
};

export interface RestoreHardwareWalletRequest extends RestoreWalletRequest {
    publicKey: string;
    walletType: WalletType;
};

export const CoreAddressTypes = Object.freeze({
    CARDANO_LEGACY: 0,
    CARDANO_BASE: 1,
    CARDANO_PTR: 2,
    CARDANO_ENTERPRISE: 3,
    CARDANO_REWARD: 4,
    /**
     * Note: we store Shelley addresses as the full payload (not just payment key)
     * since it's easier to extract a key from a payload then the inverse
     *
     * This also matches how the remote works as it has to return the full payload
     * so we can tell the address type
     */
    JORMUNGANDR_SINGLE: 1_00,
    JORMUNGANDR_GROUP: 1_01,
    JORMUNGANDR_ACCOUNT: 1_02,
    JORMUNGANDR_MULTISIG: 1_03,
    ERGO_P2PK: 2_00,
    ERGO_P2SH: 2_01,
    ERGO_P2S: 2_02,
});

export const HARD_DERIVATION_START: 2147483648 = 0x80000000;

export const WalletTypePurpose = Object.freeze({
    BIP44: 2147483692, // HARD_DERIVATION_START + 44;
    CIP1852: 2147485500, // HARD_DERIVATION_START + 1852;
});
export const CoinTypes = Object.freeze({
    CARDANO: 2147485463, // HARD_DERIVATION_START + 1815;
    ERGO: 2147484077, // HARD_DERIVATION_START + 429;
});

/**
 * Defined by bip44
 * https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki#address-gap-limit
 */
export const BIP44_SCAN_SIZE = 20;

export const ChainDerivations = Object.freeze({
    EXTERNAL: 0,
    INTERNAL: 1,
    CHIMERIC_ACCOUNT: 2,
});

export const STAKING_KEY_INDEX = 0;

export const CardanoMainnetNetworkID = 0;

export type ServerStatusResponse = {
    isServerOk: boolean;
    isMaintenance: boolean;
    serverTime: number; // in milliseconds
};

export type AddressUtxoResponse = {
    utxo_id: string;
    tx_hash: string;
    tx_index: number;
    receiver: string;
    amount: string;
    assets: Array<{
        amount: string;
        assetId: string;
        policyId: string;
        name: string;
    }>;
    block_num: number;
};

export interface StakingInfo {
    poolId: string;
    rewardsAmount: number;
    withdrawableAmount: number;
    hasEverDelegated: boolean;
}

export interface BalanceInfo {
    withdrawableAmount: number;
    controlledAmount: number;
}

export interface AddressInfo {
    withdrawableAmount: number;
    controlledAmount: number;
    poolId: string;
    rewardsAmount: number;
    hasEverDelegated: boolean;
}

export interface AssetsInfo {
    unit: string;
    quantity: string;
}

export interface StakingRewards {
    nextRewards: NextReward[];
    rewardsHistory: RewardHistory[];
}

export interface NextReward {
    epochNo: number;
    poolId?: string;
    rewardDate?: string;
}

export interface RewardHistory {
    amount: string;
    earned_epoch: string;
    spendable_epoch: string;
    pool_id: string;
    reward_date?: string;
}

export interface RewardHistoryResponse {
    [addresses: string]: Array<{
        epoch: number;
        reward: string;
        poolHash: string;
    }>;
}

export interface AccountStateResponse {
    [addresses: string]: null | {
        poolOperator: null; // not implemented yet
        remainingAmount: string; // current remaining awards
        rewards: string; //all the rewards every added (not implemented yet)
        withdrawals: string; // all the withdrawals that have ever happened (not implemented yet)
    };
}

export enum TransactionType {
    Send = 'Send',
    Staking = 'Staking',
    RegistrationAndStaking = 'RegistrationAndStaking',
    Deregistration = 'Deregistration',
    Withdrawal = 'Withdrawal',
    Collateral = 'Collateral'
}

export enum TransactionDirection {
    Send = 'send',
    Receive = 'receive',
    Collateral = 'collateral',
}

export enum DelegationType {
    Staking = 'Staking',
    RegistrationAndStaking = 'RegistrationAndStaking',
    Deregistration = 'Deregistration',
    Withdrawal = 'Withdrawal',
}

export type RemotePoolInfo = {
    // from pool metadata (off chain)
    name?: string;
    description?: string;
    ticker?: string;
    homepage?: string;
};

export type CurrentPool = {
    hash: string;
    poolId: string;
};

export type RemotePool = {
    info: RemotePoolInfo;
    history: Array<{
        epoch: number;
        slot: number;
        tx_ordinal: number;
        cert_ordinal: number;
        payload: any; // TODO: how to store this since different networks have different cert types
    }>;
};
export type PoolInfoResponse = {
    [key: string]: RemotePool | null;
};

export type BestBlockResponse = {
    // 0 if no blocks in db
    height: number;
    // null when no blocks in db
    epoch: null | number;
    slot: null | number;
    hash: null | string;
    genesis_slot: number;
};

export const AddInputResult = Object.freeze({
    // valid
    VALID: 0,
    // not worth the fee of adding it to input
    TOO_SMALL: 1,
    // token would overflow if added
    OVERFLOW: 2,
    // doesn't contribute to target
    NO_NEED: 3,
});

export type HistoryRequest = {
    addresses: Array<string>;
    after?: {
        block: string;
        tx: string;
    };
    untilBlock: string;
};

export type SignedRequest = {
    encodedTx: string;
};

export const Bech32Prefix = Object.freeze({
    ADDRESS: 'addr',
    PAYMENT_KEY_HASH: 'addr_vkh',
});

export type TransactionToken = {
    asset: {
        assetId: string;
        assetName: string;
        policyId: string;
    };
    quantity: string;
};

export type TransactionBuildRequest = {
    address: string;
    value: string;
    tokens?: TransactionToken[];
};

export interface SwapToken {
    name: string;
    amount: string;
    id: string;
}

export interface SwapTokenCurrency extends SwapToken {
    image: string | undefined;
    current_price: number | undefined;
    amountInCurrency: number | undefined;
    currency: string;
    decimals: number;
}

export interface SwapDetails {
    fee: number;
    feeInCurrency: string;
    recipient: string;
    txCbor: string;
    payTokens: SwapTokenCurrency[];
    receiveTokens: SwapTokenCurrency[];
    txMetadata: string[];
}

export interface AssetModel {
    amount: number;
    assetId: string;
    name: string;
    policyId: string;
    ticker: string;
}

export interface AssetModelExtended extends AssetModel {
    decimals?: number;
    icon?: string;
    metadata?: any;
    isNFT?: boolean;
}

export interface BlockFrostInputOutput {
    address: string;
    amount: string;
    assets: Array<{
        amount: string;
        assetId: string;
        policyId: string;
        name: string;
    }>;
}

export interface BlockfrostTransactionInfo {
    asset_mint_or_burn_count: number;
    block_num: number;
    delegation_count: number;
    fee: string;
    hash: string;
    pool_retire_count: number;
    pool_update_count: number;
    stake_cert_count: number;
    time: Date;
    poolId: string;
    withdrawal_count: number;
    inputs: BlockFrostInputOutput[];
    outputs: BlockFrostInputOutput[];
}

export interface PendingState {
    address: string;
    amount: number;
    fee: number;
    assets: AssetModelExtended[];
    minAdaNeeded?: number;
}
