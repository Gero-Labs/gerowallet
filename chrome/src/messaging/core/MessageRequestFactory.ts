import MessageSender = chrome.runtime.MessageSender;
import { autoInjectable } from 'tsyringe';
import { MessageRequestInterface } from './MessageRequestInterface';
import { AbstractMessageHandler } from './AbstractMessageHandler';
import {
    BuildDelegationHandler,
    CardanoScanHandler,
    ContactHandler,
    CreateWalletHandler,
    DAppGetInfoHandler,
    DAppGetUtxoHandler,
    DAppSubmitTXHandler,
    DAppSignTXHandler,
    EmptyTabHander,
    PoolInfoHandler,
    RewardsHandler,
    FetchRatesHandler,
    GenerateMnemonicsHandler,
    GetUserSettingsHandler,
    ImportWalletHandler,
    HardwareOptionsHandler,
    LastSyncInfoHandler,
    ListPoolsHandler,
    MaxAmountHandler,
    MoonPayBuyHandler,
    NewTransactionHandler,
    RegisterPathHandler,
    RemoveWalletHandler,
    RestoreWalletHandler,
    SignTransactionHandler,
    StatusHandler,
    TransactionsHandler,
    UpdateUserSettingsHandler,
    ValidateAddressHandler,
    ValidateMnemonicsHandler,
    WalletDetailsHandler,
    HardwareWalletSignTransactionHandler,
    InitTrezorWalletHandler,
    TxScanHandler, AngularErrorHandler,
} from '../handlers';
import { GetWalletsListHandler } from '../handlers/GetWalletsListHandler';
import { TabInfo } from './tabInfo';
import { UpdateWalletHandler } from '../handlers/UpdateWalletHandler';
import { AssetsIconHandler } from '../handlers/AssetsIconHandler';
import { ConnectionGetSitesHandler } from '../handlers/ConnectionGetSitesHandler';
import { ConnectionRemoveSiteHandler } from '../handlers/ConnectionRemoveSiteHandler';
import { DAppConnectionHandler } from '../handlers/dAppConnectionHandler';
import { ConnectionWalletsSiteHandler } from '../handlers/ConnectionWalletSiteHandler';
import { DAppGetChangeAddressHandler } from '../handlers/dAppGetChangeAddressHandler';
import { GetBlockfrostApiKeyHandler } from '../handlers/GetBlockfrostApiKeyHandler';
import { ConnectionWebsiteConnectedHandler } from '../handlers/ConnectionWebsiteConnectedHandler';
import { DAppGetCollateralHandler } from '../handlers/dAppGetCollateral';
import { DAppSetCollateralHandler } from '../handlers/dAppSetCollateral';
import { DAppIsEnabledHandler } from '../handlers/dAppIsEnabledHandler';
import { DAppGetNetworkHander } from '../handlers/dAppGetNetworkHandler';
import { DAppSignDataHandler } from '../handlers/dAppSignDataHandler';
import { DAppFetchTxInfoHandler } from '../handlers/dAppFetchTxInfoHandler';
import { RestoreHardWareWalletHandler } from '../handlers/RestoreHardwareWalletHandler';
import { TransactionsHistoryHandler } from '../handlers/TransactionsHistoryHandler';
import { NFTMediaHandler } from '../handlers/NFTMediaHandler';
import { AssetsInfoHandler } from '../handlers/AssetsInfoHandler';
import { DAppRemoveCollateralHandler } from '../handlers/dAppRemoveCollateralHandler';
import { DAppAccountChanged } from '../handlers/DAppAccountChanged';
import { SetPendingTransactionHandler } from '../handlers/SetPendingTransactionHandler';
import { FetchPendingTransactionsHandler } from '../handlers/FetchPendingTransactionsHandler';
import { UpdatePendingTransactionHandler } from '../handlers/UpdatePendingTransactionHandler';
import { GetHandleAddressHandler } from '../handlers/GetHandleAddressHandler';
import { DAppGetBalanceHandler } from '../handlers/DAppGetBalanceHandler';
import { MinAdaHandler } from '../handlers/MinAdaHandler';

// Specifies where the message comes from.
export type MessageOrigin = 'dapp' | 'extension' | '*';

interface MessageMapItem {
    origin: MessageOrigin;
    handler: AbstractMessageHandler;
}

@autoInjectable()
export class MessageRequestFactory {
    private readonly messageMappers: Map<string, MessageMapItem> = new Map();

    constructor(
        private statusHandler?: StatusHandler,
        private poolInfoHandler?: PoolInfoHandler,
        private rewardsHandler?: RewardsHandler,
        private contactHandler?: ContactHandler,
        private hardwareOptionsHandler?: HardwareOptionsHandler,
        private importWalletHandler?: ImportWalletHandler,
        private createWalletHandler?: CreateWalletHandler,
        private generateMnemonicsHandler?: GenerateMnemonicsHandler,
        private validateMnemonicsHandler?: ValidateMnemonicsHandler,
        private removeWalletHandler?: RemoveWalletHandler,
        private restoreWalletHandler?: RestoreWalletHandler,
        private restoreHardWareWalletHandler?: RestoreHardWareWalletHandler,
        private initTrezorWalletHandler?: InitTrezorWalletHandler,
        private walletDetailsHandler?: WalletDetailsHandler,
        private transactionsHandler?: TransactionsHandler,
        private newTransactionHandler?: NewTransactionHandler,
        private signTransactionHandler?: SignTransactionHandler,
        private hardwareWalletSignTransactionHandler?: HardwareWalletSignTransactionHandler,
        private cardanoScanHandler?: CardanoScanHandler,
        private moonPayBuyHandler?: MoonPayBuyHandler,
        private listPoolsHandler?: ListPoolsHandler,
        private lastSyncInfoHandler?: LastSyncInfoHandler,
        private fetchRatesHandler?: FetchRatesHandler,
        private maxAmountHandler?: MaxAmountHandler,
        private emptyTabHandler?: EmptyTabHander,
        private validateAddressHandler?: ValidateAddressHandler,
        private getUserSettingsHandler?: GetUserSettingsHandler,
        private updateUserSettingsHandler?: UpdateUserSettingsHandler,
        private getWalletsListHandler?: GetWalletsListHandler,
        private updateWalletHandler?: UpdateWalletHandler,
        private buildDelegationHander?: BuildDelegationHandler,
        private registerPathHandler?: RegisterPathHandler,
        private assetsInfoHandler?: AssetsInfoHandler,
        private assetsIconHandler?: AssetsIconHandler,
        private nftMediaHandler?: NFTMediaHandler,
        private blockfrostApiKeyHandler?: GetBlockfrostApiKeyHandler,
        private transactionsHistoryHandler?: TransactionsHistoryHandler,
        private dAppGetUtxosHandler?: DAppGetUtxoHandler,
        private dAppSignTXHandler?: DAppSignTXHandler,
        private dAppSubmitTXHandler?: DAppSubmitTXHandler,
        private dAppSignData?: DAppSignDataHandler,
        private dAppFetchTxInfo?: DAppFetchTxInfoHandler,
        private dAppGetInfoHandler?: DAppGetInfoHandler,
        private dAppGetBalanceHandler?: DAppGetBalanceHandler,
        private connectionGetSitesHandler?: ConnectionGetSitesHandler,
        private connectionRemoveSiteHandler?: ConnectionRemoveSiteHandler,
        private connectionWalletsSiteHandler?: ConnectionWalletsSiteHandler,
        private connectionWebsiteConnectedHandler?: ConnectionWebsiteConnectedHandler,
        private dAppConnectionHandler?: DAppConnectionHandler,
        private dAppGetChangeAddressHandler?: DAppGetChangeAddressHandler,
        private dAppGetCollateralHandler?: DAppGetCollateralHandler,
        private dAppSetCollateralHandler?: DAppSetCollateralHandler,
        private dAppIsEnabledHandler?: DAppIsEnabledHandler,
        private dAppGetNetworkHandler?: DAppGetNetworkHander,
        private dAppRemoveCollateralHandler?: DAppRemoveCollateralHandler,
        private dAppAccountChanged?: DAppAccountChanged,
        private pendingTransactionshandler?: SetPendingTransactionHandler,
        private fetchPendingTransactionshandler?: FetchPendingTransactionsHandler,
        private updatePendingTransactionHandler?: UpdatePendingTransactionHandler,
        private getHandleAddressHandler?: GetHandleAddressHandler,
        private minAdaHandler?: MinAdaHandler,
        private txScanHandler?: TxScanHandler,
        private angularErrorHandler?: AngularErrorHandler,
    ) {
        this.messageMappers = new Map([
            ['server-status', { origin: 'extension', handler: this.statusHandler }],
            ['pool-info', { origin: 'extension', handler: this.poolInfoHandler }],
            ['rewards', { origin: 'extension', handler: this.rewardsHandler }],
            ['contact', { origin: 'extension', handler: this.contactHandler }],
            ['hardware-options', { origin: 'extension', handler: this.hardwareOptionsHandler }],
            ['import', { origin: 'extension', handler: this.importWalletHandler }],
            ['create', { origin: 'extension', handler: this.createWalletHandler }],
            ['generate-mnemonics', { origin: 'extension', handler: this.generateMnemonicsHandler }],
            ['validate-mnemonics', { origin: 'extension', handler: this.validateMnemonicsHandler }],
            ['remove-wallet.js', { origin: 'extension', handler: this.removeWalletHandler }],
            ['restore-wallet.js', { origin: 'extension', handler: this.restoreWalletHandler }],
            ['restore-HW-wallet.js', { origin: 'extension', handler: this.restoreHardWareWalletHandler }],
            ['init-trezor-wallet.js', { origin: 'extension', handler: this.initTrezorWalletHandler }],
            ['get-wallet.js-details', { origin: 'extension', handler: this.walletDetailsHandler }],
            ['get-transactions', { origin: 'extension', handler: this.transactionsHandler }],
            ['get-transactions-history', { origin: 'extension', handler: this.transactionsHistoryHandler }],
            ['create-new-transaction', { origin: 'extension', handler: this.newTransactionHandler }],
            ['sign-transaction', { origin: 'extension', handler: this.signTransactionHandler }],
            ['HW-sign-transaction', { origin: 'extension', handler: this.hardwareWalletSignTransactionHandler }],
            ['get-pools', { origin: 'extension', handler: this.listPoolsHandler }],
            ['build-delegation', { origin: 'extension', handler: this.buildDelegationHander }],
            ['cardanoscan', { origin: 'extension', handler: this.cardanoScanHandler }],
            ['moonpay-buy', { origin: 'extension', handler: this.moonPayBuyHandler }],
            ['last-sync-info', { origin: 'extension', handler: this.lastSyncInfoHandler }],
            ['fetch-rates', { origin: 'extension', handler: this.fetchRatesHandler }],
            ['get-max-amount', { origin: 'extension', handler: this.maxAmountHandler }],
            ['empty', { origin: 'extension', handler: this.emptyTabHandler }],
            ['validate-address', { origin: 'extension', handler: this.validateAddressHandler }],
            ['load-user-settings', { origin: 'extension', handler: this.getUserSettingsHandler }],
            ['update-user-settings', { origin: 'extension', handler: this.updateUserSettingsHandler }],
            ['get-wallets-list', { origin: 'extension', handler: this.getWalletsListHandler }],
            ['update-wallet.js', { origin: 'extension', handler: this.updateWalletHandler }],
            ['register-path', { origin: 'extension', handler: this.registerPathHandler }],
            ['assets-info', { origin: 'extension', handler: this.assetsInfoHandler }],
            ['assets-icon', { origin: 'extension', handler: this.assetsIconHandler }],
            ['nft-media', { origin: 'extension', handler: this.nftMediaHandler }],
            ['get-blockfrost-api-key', { origin: 'extension', handler: this.blockfrostApiKeyHandler }],
            ['dapp-get-utxos', { origin: 'dapp', handler: this.dAppGetUtxosHandler }],
            ['dapp-sign-tx', { origin: 'dapp', handler: this.dAppSignTXHandler }],
            ['dapp-submit-tx', { origin: 'dapp', handler: this.dAppSubmitTXHandler }],
            ['dapp-get-info', { origin: 'dapp', handler: this.dAppGetInfoHandler }],
            ['dapp-get-balance', { origin: 'dapp', handler: this.dAppGetBalanceHandler }],
            ['dapp-get-change-address', { origin: 'dapp', handler: this.dAppGetChangeAddressHandler }],
            ['dapp-connection-wallets-site', { origin: 'dapp', handler: this.dAppConnectionHandler }],
            ['connection-get-sites', { origin: '*', handler: this.connectionGetSitesHandler }],
            ['connection-remove-site', { origin: '*', handler: this.connectionRemoveSiteHandler }],
            ['connection-wallets-site', { origin: '*', handler: this.connectionWalletsSiteHandler }],
            ['connection-website-connected', { origin: '*', handler: this.connectionWebsiteConnectedHandler }],
            ['get-blockfrost-api-key', { origin: 'dapp', handler: this.blockfrostApiKeyHandler }],
            ['dApp-get-collateral', { origin: 'dapp', handler: this.dAppGetCollateralHandler }],
            ['dapp-set-collateral', { origin: 'dapp', handler: this.dAppSetCollateralHandler }],
            ['dapp-is-enabled', { origin: 'dapp', handler: this.dAppIsEnabledHandler }],
            ['dapp-get-network', { origin: 'dapp', handler: this.dAppGetNetworkHandler }],
            ['dapp-sign-data', { origin: 'dapp', handler: this.dAppSignData }],
            ['dapp-fetch-tx-info', { origin: 'dapp', handler: this.dAppFetchTxInfo }],
            ['dapp-remove-collateral', { origin: 'dapp', handler: this.dAppRemoveCollateralHandler }],
            ['dapp-account-changed', { origin: 'dapp', handler: this.dAppAccountChanged }],
            ['set-pending-transaction', { origin: 'extension', handler: this.pendingTransactionshandler }],
            ['get-pending-transactions', { origin: 'extension', handler: this.fetchPendingTransactionshandler }],
            ['update-pending-transaction', { origin: 'extension', handler: this.updatePendingTransactionHandler }],
            ['get-handle-address', { origin: 'extension', handler: this.getHandleAddressHandler }],
            ['min-ada', { origin: 'extension', handler: this.minAdaHandler }],
            ['tx-scan', { origin: 'extension', handler: this.txScanHandler }],
            ['angular-error', { origin: 'extension', handler: this.angularErrorHandler }],
        ]);
    }

    public prepareRequest(
        message: any,
        sender: MessageSender,
        response: any,
        tabInfo: TabInfo,
    ): MessageRequestInterface {
        let title: string;
        let params: any = {};
        if (typeof message === 'string') {
            title = message;
        } else {
            title = message?.title;
            params = { ...message };
        }
        return {
            message: title,
            sender,
            cb: response,
            params,
            tabFound: tabInfo.tabFound,
            tabToUpdate: tabInfo.tabToUpdate,
        };
    }

    public async createHandler(message: MessageRequestInterface) {
        const mapper = this.messageMappers.get(message.message);
        if (mapper) {
            if (mapper.origin === 'extension' && !this.isExtensionMessage(message)) {
                // Ignore extension messages emitted by dapps or any other website
                return;
            }
            await mapper.handler.handle(message);
            message.cb();
        }
    }

    public isExtensionMessage(message: MessageRequestInterface): boolean {
        return message.sender.origin === `chrome-extension://${chrome.runtime.id}`;
    }
}
