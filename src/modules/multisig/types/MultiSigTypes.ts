import { DappRisk, DappScore } from "@/models/cardano-shield-types";

// MultiSig.vue
export interface WalletInfo {
    icon: string;
    title: string;
    value: number;
    inlineValue: {
        display: boolean;
        value: number;
    };
}

export interface Transaction {
    tx_hash: string;
    time: number;
    sentAmount?: number;
    receivedAmount?: number;
    status: string;
}

export interface Signer {
    address: string;
    name: string;
    isThisWallet: boolean;
}

export interface MultisigWalletInterface {
    id?: string;
    name?: string;
    chain?: string;
    network?: string;
    createdAt?: string;
    multisigScriptCBOR?: string;
    requiredSigners?: number;
    signers?: Signer[];
    stakeAddress?: string;
    addressBech32: string;
}

// MultisigTransaction.vue
export interface Step {
    name: string;
    label: string;
}

export interface Tooltip {
    enabled: boolean;
    text: string;
}


export interface Token {
    unit: string;
    quantity: string;
    decimals?: number;
    ticker?: string;
    balance?: string;
    verified?: boolean;
    metadata?: {
        name: string;
        ticker: string;
        decimals: number;
    };
    img?: string;
    name?: string;
    last_price?: number;
    isScam?: boolean;
}

export interface Collectible {
    name: string;
    unit: string;
    toSendQuantity: number;
    quantity: number;
    img?: string;
    isScam?: boolean;
}

export interface SendData {
    isMultisigFunding: boolean;
    selectedTokens: Token[];
    selectedCollectibles: any[];
    recipientAddress: string;
    selectedWallet: any;
    availableWallets: any[];
    minAda: number;
    adaShortage: number;
    senderWallet: string;
}

// SendRecipientDetailsStep.vue
export interface Contact {
    name: string;
    address: string;
    img?: string;
}

export interface Asset {
    name: string;
    img?: string;
}

// SummaryStep.vue
export interface TxData {
    to_hex: () => string;
}

export interface Risks {
    score?: DappScore;
    addressRisk?: DappRisk;
    domainRisk?: DappRisk;
    receivingRisk?: boolean;
}

export interface SwapDetails {
    give: {
        total: number;
        txFee: string;
        provider: string;
        assets: Array<{
            amount: number;
            currency: string;
            id: string;
        }>;
    };
    receive: {
        total: number;
        provider: string;
        assets: Array<{
            amount: number;
            currency: string;
            id: string;
        }>;
    };
    recipient: string;
    txMetadata?: any;
}