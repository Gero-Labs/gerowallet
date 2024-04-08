import { Bytes, Paginate, RequestAccess } from './types';
import { APIError } from './api-error';
import { fetchEnabled } from './messaging';

export interface WalletApi {
    getUtxos: (amount?: string, paginate?: Paginate) => Promise<string[] | undefined>;
    getBalance: () => Promise<string>;
    getUsedAddresses: (paginate?: Paginate) => Promise<string[]>;
    getUnusedAddresses: () => Promise<string[]>;
    getChangeAddress: () => Promise<string> ;
    getRewardAddresses: () => Promise<string[]>;
    signTx: (tx: string, partialSign?: boolean) => Promise<string>;
    signData: (addr: string, sigStructure: string) => Promise<Bytes>;
    submitTx: (tx: string) => Promise<string>;
    onAccountChange: (callback) => void;
    onNetworkChange: (callback) => void;
    experimental: {
        on: (eventName, callback) => void;
        off: (eventName, callback) => void;
        getCollateral: () => Promise<string[]>;
    }
    getCollateral: () => Promise<string[]>;
    getNetworkId: () => Promise<number>;
}

export interface WalletProperties {
    icon: string;
    name: string;
    version: string;
}

// Corresponds to Wallet from cip30 package. Due to build errors,
// this Wallets was impossible to be used
export class InjectedWallet {
    readonly version: string;
    readonly name: string;
    readonly icon: string;

    constructor(
        properties: WalletProperties,
        public api: WalletApi,
        private requestAccess: RequestAccess,
    ) {
        this.name = properties.name;
        this.version = properties.version;
        this.icon = properties.icon;
    }

    public getPublicApi() {
        return {
            apiVersion: this.version,
            version: this.version,
            name: this.name,
            icon: this.icon, 
            enable: () => this.enable(),
            isEnabled: () => this.isEnabled(),
            // TODO: remove when all connected sites are CIP-30 compatible
            getBalance: () => this.callApiMethod(() => this.api.getBalance()),
            getUtxos: (amount, paginate) => this.callApiMethod(() => this.api.getUtxos(amount, paginate)),
            submitTx: (tx) => this.callApiMethod(() => this.api.submitTx(tx)),
            onAccountChange: (callback) => this.callApiMethod(() => this.api.onAccountChange(callback)),
            onNetworkChange: (callback) => this.callApiMethod(() => this.api.onNetworkChange(callback)),
            getUsedAddresses: (paginate) => this.callApiMethod(() => this.api.getUsedAddresses(paginate)),
            experimental: {
                on: (eventName, callback) => this.callApiMethod(() => this.api.experimental.on(eventName, callback)),
                off: (eventName, callback) => this.callApiMethod(() => this.api.experimental.off(eventName, callback)),
                getCollateral: () => this.callApiMethod(() => this.api.getCollateral()),
            },
            getUnusedAddresses: () => this.callApiMethod(() => this.api.getUnusedAddresses()),
            getChangeAddress: () => this.callApiMethod(() => this.api.getChangeAddress()),
            getRewardAddresses: () => this.callApiMethod(() => this.api.getRewardAddresses()),
            signTx: (tx, partialSign) => this.callApiMethod(() => this.api.signTx(tx, partialSign)),
            signData: (address, payload) => this.callApiMethod(() => this.api.signData(address, payload)),
            getCollateral: () => this.callApiMethod(() => this.api.getCollateral()),
            getNetworkId: () => this.callApiMethod(() => this.api.getNetworkId()),
        };
    }

    private async callApiMethod(callback: () => any) {
        const isEnabled = await this.isEnabled();
        if (isEnabled) {
           return callback();
        }
        return undefined;
    }

    private requestAccessPromise;

    /**
     * Returns true if the dApp is already connected to the user's wallet.js, or if requesting access
     * would return true without user confirmation (e.g. the dApp is whitelisted), and false otherwise.
     *
     * If this function returns true, then any subsequent calls to wallet.js.enable()
     * during the current session should succeed and return the API object.
     *
     * Errors: `ApiError`
     */
    public async isEnabled() {
        return await fetchEnabled();
    }

    /**
     * This is the entrypoint to start communication with the user's wallet.js.
     *
     * The wallet.js should request the user's permission to connect the web page to the user's wallet.js,
     * and if permission has been granted, the full API will be returned to the dApp to use.
     *
     * The wallet.js can choose to maintain a whitelist to not necessarily ask the user's permission
     * every time access is requested, but this behavior is up to the wallet.js and should be transparent
     * to web pages using this API.
     *
     * If a wallet.js is already connected this function should not request access a second time,
     * and instead just return the API object.
     *
     * Errors: `ApiError`
     */
    public async enable() {
        // gain authorization from wallet.js owner
        if (!this.requestAccessPromise) {
            this.requestAccessPromise = this.requestAccess();
        }
        const isAuthed = await this.requestAccessPromise;

        if (!isAuthed) {
            throw new Error(APIError.Refused.info);
        }
        this.requestAccessPromise = undefined;
        // This is the real CIP-30 compatible wait to access private api
        return Promise.resolve(this.api);
    }
}
