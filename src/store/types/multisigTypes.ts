interface Signer {
    address: string;
    name: string;
    isThisWallet: boolean;
}

interface MultisigWalletInterface {
    id?: string;
    name?: string;
    chain?: string;
    network?: string;
    createdAt?: string;
    multisigScriptCBOR?: string;
    requiredSigners?: number;
    signers?: Signer[];
    stakeAddress?: string;
    paymentAddress?: string;
}

interface _MultisigWalletState {
    multiSigWallets: MultisigWalletInterface[];
    multiSigWallet: MultisigWalletInterface;
    assets: any[];
    baseAddress: string;
    resolvedAssets: any[];
    resolvedCollections: any[];
    stakeAddress: string;
    pinnedTokens: string[];
    price: any;
    transactions: any[];
    pendingTxs: any[];
    provider: any;
    loadingTxs: boolean;
    isSyncing: boolean;
    pools: any[];
    rewards: any[];
    connectedDapps: any[];
}