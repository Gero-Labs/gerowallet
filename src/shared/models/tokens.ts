export interface Token {
    decimals: number;
    ticker: string;
    quantity: number;
    last_price?: number;
    name?: string;
    img?: string;
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

export interface Value {
    selectedTokens: Token[];
    selectedCollectibles: CollectibleItem[];
    minAda?: number;
    adaShortage?: number;
}

export interface Asset {
    name: string;
    img?: string;
}
