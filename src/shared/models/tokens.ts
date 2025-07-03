// Types
export interface Token {
    decimals: number;
    ticker: string;
    quantity: number;
    last_price?: number;
    verified?: boolean;
    balance?: number;
}

export interface CollectibleItem {
    name: string;
    img: string;
    quantity: number;
    toSendQuantity?: number;
    isScam?: boolean;
}

export interface Collection {
    name: string;
    items: CollectibleItem[];
}

export interface Value {
    selectedTokens: Token[];
    selectedCollectibles: CollectibleItem[];
    minAda?: number;
    adaShortage?: number;
}

export interface Contact {
    name: string;
    address: string;
    img?: string;
}

export interface Asset {
    name: string;
    img?: string;
}

export interface SendData {
    selectedWallet: any;
    recipientAddress?: string;
}

export interface ContactItem {
    name: string;
    address: string;
    img?: string;
}