interface LoggerLikeInstance {
    info(...data: any[]): void;
    warn(...data: any[]): void;
    error(...data: any[]): void;
}
type WithLogger<T> = T & {
    logger?: Logger;
};
declare class Logger {
    private prefix;
    private logger;
    constructor({ logger, prefix, }: {
        logger: LoggerLikeInstance;
        prefix?: string[];
    });
    if(condition: boolean): Logger;
    info(...data: any[]): void;
    warn(...data: any[]): void;
    error(...data: any[]): void;
}

type OnIncomingMessage = (message: object) => void;
declare abstract class PostMessageClient {
    /**
     * onIncomingMessage is a callback that will be called when the message arrives and is parsed.
     * message type should be inferred from the callback type.
     */
    private onIncomingMessage;
    /**
     * Send a message to the other side of the post message channel.
     *
     * @param message JSON stringified message
     * @param target Optional target of the origin. Defaults to '*'.
     */
    abstract postMessage(message: string, target?: string): void;
    /**
     * Cleanup any event listeners or other resources
     * that were created by the client.
     * This method should be called when the client is no longer needed.
     */
    abstract cleanup(): void;
    /**
     * Method that will register the callback for the incoming messages.
     *
     * @param onIncomingMessage will be called when the message arrives and is parsed
     */
    subscribe<TOnIncomingMessage extends OnIncomingMessage>(onIncomingMessage: TOnIncomingMessage): void;
    /**
     * Handle a message received from the other side of the post message channel.
     * @param message JSON stringified message
     */
    protected handleMessage(stringifiedMessage: string): void;
}

type MoonpayMessageType = 'request' | 'resolve' | 'reject';
interface MoonpayMessageBase {
    appName: string;
    correlationId: string;
    moonpaySdk: true;
    type: MoonpayMessageType;
    version: number;
}
interface MoonpayRequestMessage extends MoonpayMessageBase {
    type: 'request';
    action: string;
    payload?: Record<string, unknown>;
}

type OnReadyCallback = (props: {
    appProtocolVersion: number;
}) => void;
type PostMessengerMode = 'parent' | 'child';
type AppProtocolVersion = number;
type AppProtocol = {
    versions: AppProtocolVersion[];
    name: string;
};
type VersionedRequestActionHandlers = Record<AppProtocolVersion, Record<string, (...args: any[]) => any>>;

type SendMessageParams = Pick<MoonpayRequestMessage, 'action' | 'payload'> & {
    timeout?: number;
};
declare class PostMessenger {
    /**
     * The version of the protocol that the app supports
     */
    private protocolVersion;
    appProtocolVersion: number;
    handshakeSuccessful: boolean;
    /**
     * The prefix for the correlation id.
     */
    private correlationIdPrefix;
    /**
     * The index of the latest message sent.
     */
    private messageIndex;
    /**
     * Callback that will be called when handshake is complete
     * and a valid communication path has been established
     * between the parent and the child
     */
    onReady?: OnReadyCallback;
    private appProtocol;
    private mode;
    postMessageClient: PostMessageClient;
    private requestActionHandlers?;
    /**
     *  Enables verbose logging
     */
    private verbose;
    private deferred;
    private logger?;
    constructor({ appProtocol, mode, postMessageClient, requestActionHandlers, verbose, }: {
        appProtocol: AppProtocol;
        mode: PostMessengerMode;
        postMessageClient: PostMessageClient;
        requestActionHandlers?: VersionedRequestActionHandlers;
        verbose?: boolean;
    });
    /**
     * Clean up event listeners and subscriptions.
     */
    shutdown(): void;
    /**
     * When invoked in child mode, this method will send a handshake request.
     * If called in the parent mode, the method will throw an error.
     *
     * Note:
     * In the future, if we want to allow initializing communication from the parent,
     * we can remove the `mode !== child` check, but we need to make sure that
     * the one side won't send a handshake if the other side is not ready yet,
     * or we have to implement some kind of retry mechanism.
     */
    initializeCommunication(): Promise<void>;
    /**
     * Sends a request message to the target window.
     * To see what the exact target window is,
     * and where the message will be sent,
     * check the `PostMessageClient` implementation.
     */
    sendMessage<T = unknown>({ action, payload, timeout, }: SendMessageParams): Promise<T>;
    private sendHandshake;
    private handleRequestMessage;
    private handleIncomingMessage;
    private handleHandshakeRequestMessage;
    private handleResponseMessage;
    private sendRequestMessage;
    private sendResolveMessage;
    private sendRejectMessage;
    private generateCorrelationId;
    private assertHandshakeSuccessful;
}

interface RampsMoonPayBalanceChildToParentInterface {
    /**
     * Fired when the user confirms balance has been deposited.
     */
    onBalanceDepositTransferConfirmed(): void;
}

interface RampsConsumerKycChildToParentInterface {
    /**
     * Fired when the Consumer KYC flow has completed signaling to the
     * parent app that the widget may now be closed.
     */
    onConsumerKycComplete(): Promise<void>;
}

type OnAuthTokenProps = {
    /** The customer's authentication token. Only provided to authorized integrations. */
    token: string;
    /** The customer's CSRF token. Only provided to authorized integrations. */
    csrfToken: string;
};
interface RampsSwapsKycChildToParentInterface {
    /**
     * Fired when the partner needs to receive an updated customer auth token so
     * they can perform authorized actions on behalf of the customer.
     */
    onAuthToken(props: OnAuthTokenProps): Promise<void>;
    /**
     * Fired when the Swaps Customer Setup flow has completed signaling to the
     * parent app that the widget may now be closed.
     */
    onSwapsCustomerSetupComplete(): Promise<void>;
}

type TransactionStatus = 'completed' | 'failed' | 'pending' | 'waitingAuthorization' | 'waitingPayment';
type SellTransactionStatus = 'completed' | 'failed' | 'pending' | 'waitingForDeposit';
/**
 * Represents a Fiat currency such as USD
 */
type FiatCurrency = {
    /** The identifier of the fiat currency */
    id: string;
    /** The human readable name of the currency such as "US Dollar" */
    name: string;
    /** The code of the currency such as "usd" */
    code: string;
};
/** Represents a Crypto currency such as ETH */
type CryptoCurrency = {
    /** The identifier of the crypto currency */
    id: string;
    /** The human readable name of the currency such as "Ethereum" */
    name: string;
    /** The code of the currency such as "eth" */
    code: string;
    /** The address location of the token contract on the blockchain */
    contractAddress: string | null;
    /** The chain's Chain ID */
    chainId: string | null;
    /** The coin type as defined in SLIP-0044 */
    coinType: string | null;
    /** The currency's network such as "bitcoin" or "ethereum" */
    networkCode: string | null;
};
type OnInitiateDepositProps = {
    /** The identifier of the transaction */
    transactionId: string;
    /** The crypto currency that is being off-ramped */
    cryptoCurrency: CryptoCurrency;
    /** The fiat currency that the customer will receive */
    fiatCurrency: FiatCurrency;
    /** Crypto amount in its base unit (0.123 ETH === "0.123") */
    cryptoCurrencyAmount: string;
    /** Crypto amount in its smallest unit (1 ETH === 1x10^18) */
    cryptoCurrencyAmountSmallestDenomination: string;
    /** Fiat amount in its base unit ($1.23 === "1.23"). Only set for fixed quotes. */
    fiatCurrencyAmount: string | null;
    /** The wallet address where the crypto amount needs to be deposited */
    depositWalletAddress: string;
};
type OnInitiateDepositReplyProps = {
    /**
     * The partner's identifier for a successful deposit. Can be any string, eg
     * the transaction hash.
     */
    depositId: string;
};
type OnLoginProps = {
    /** If true, the customer didn't actually log in but rather their authentication was refreshed. */
    isRefresh: boolean;
};
type OnTransactionCompletedProps = {
    /** The identifier of the transaction */
    id: string;
    /** When the transaction was created */
    createdAt: string;
    /** The base (fiat) currency */
    baseCurrency: FiatCurrency;
    /** The quote (crypto) currency */
    quoteCurrency: CryptoCurrency;
    /** The spent fiat amount */
    baseCurrencyAmount: number;
    /** The expected or received quote amount */
    quoteCurrencyAmount: number;
    /** The MoonPay fee amount, in the fiat currency */
    feeAmount: number;
    /** The partner's fee amount, in the fiat currency */
    extraFeeAmount: number;
    /** The network fees incurred in this transaction, in the fiat currency */
    networkFeeAmount: number;
    /** Whether the base currency amount includes fees */
    areFeesIncluded: boolean;
    /** The customer's destination wallet address */
    walletAddress: string;
    /** The customer's destination wallet address tag */
    walletAddressTag: string | null;
    /** The current status of the transaction */
    status: TransactionStatus;
};
type OnTransactionCreatedProps = {
    id: string;
    baseCurrencyAmount: number;
    baseCurrencyCode: string;
    status: TransactionStatus | SellTransactionStatus;
};
/**
 * This interface represents the events that the Widget SDK can trigger from
 * within the MoonPay Widget to partners' parent applications.
 *
 * This allows partner apps to be informed and adapt to certain widget
 * lifecycle events.
 * */
interface RampsChildToParentInterface extends RampsSwapsKycChildToParentInterface, RampsConsumerKycChildToParentInterface, RampsMoonPayBalanceChildToParentInterface {
    /**
     * Fired when the Unsupported Region screen is triggered, independently of
     * whether the widget redirects away from it.
     */
    onUnsupportedRegion(): Promise<void>;
    /**
     * Fired when KMS wallets have been created
     * Account doesn't have a need to get the wallet details, since it uses this
     * message as a signal that triggers a re-fetch of the KMS wallets from the backend.
     * @internal
     */
    onKmsWalletsCreated: () => Promise<void>;
    /**
     * Fired when the customer logs in or their authentication is refreshed.
     */
    onLogin(props: OnLoginProps): Promise<void>;
    /**
     * Called in the integrated sell flow, in the transaction tracker, when the
     * widget is waiting for the sell amount to be deposited by the customer.
     *
     * This allows the partner to trigger a deposit right from their wallet app.
     */
    onInitiateDeposit(props: OnInitiateDepositProps): Promise<OnInitiateDepositReplyProps>;
    /**
     * Fired when a buy, sell, or NFT transaction is created, just before
     * navigation to the transaction tracker.
     * Note: the customer may not have completed the transaction yet.
     */
    onTransactionCreated: (props: OnTransactionCreatedProps) => Promise<void>;
    /**
     * Fired when a transaction is detected as completed or if a previously
     * completed transaction is loaded again in the transaction tracker.
     */
    onTransactionCompleted(props: OnTransactionCompletedProps): Promise<void>;
}

declare const createBrowserMessenger: ({ allowedOrigins, handlers, mode, ownWindowProxy, targetWindowProxy, }: {
    allowedOrigins?: string[] | undefined;
    handlers?: Partial<RampsChildToParentInterface> | undefined;
    mode: PostMessenger['mode'];
    ownWindowProxy: WindowProxy;
    targetWindowProxy: WindowProxy;
}) => {
    postMessenger: PostMessenger;
    messageSender: RampsChildToParentInterface;
};

type PostMessengerHandlers = Parameters<typeof createBrowserMessenger>[0]['handlers'];
type WidgetPostMessengerHandlers = {
    [flow in WidgetFlow]: PostMessengerHandlers;
};

interface ThemeQueryParams {
    /**
     * Enable dark mode or light mode as the default appearance for the widget. Possible values are dark, light.
     */
    theme?: string;
    /**
     * Id of the created theme
     */
    themeId?: string;
    /**
     * The color code for the widget main color. It is used for buttons, links and highlighted text.
     * Only hexadecimal codes are accepted and must be URL encoded (#FF875B becomes %23FF875B).
     * You can also apply a different color for dark mode by adding a comma separated color code.
     */
    colorCode?: string;
}
interface BaseWidgetQueryParams extends ThemeQueryParams {
    /**
     * Your publishable API key.
     * This is used to assign customers and transactions to your MoonPay account.
     */
    apiKey: string;
    /**
     * The code of the cryptocurrency you would prefer the customer to purchase.
     * The customer can still select another currency.
     * If both currencyCode and defaultCurrencyCode are passed, currencyCode will take precedence.
     */
    defaultCurrencyCode?: string;
    /**
     * The cryptocurrency wallet address the purchased funds will be sent to.
     * If you pass a valid wallet address the customer won't be prompted to enter one.
     * This parameter will be skipped if currencyCode is not passed.
     * It is mandatory to sign the URL if you're using this parameter.
     * Values need to be URL encoded in order to generate a valid signature.
     */
    walletAddress?: string;
    /**
     * The secondary cryptocurrency wallet address identifier/memo for coins such as EOS, XLM, XRP and XMR.
     * This parameter will be skipped if walletAddress or currencyCode is not passed.
     */
    walletAddressTag?: string;
    /**
     * A JSON string representing the wallet addresses you want to use for multiple cryptocurrencies.
     * A URL encoded BTC & EOS example. %7B%22btc%22%3A%22tb1qst9rvjnhym6kwmdkwgfs4h5dtp7cau5346jp9x%22%2C%22eos%22%3A%22eosmoonpay23%22%7D.
     * If the customer selects a cryptocurrency for which you have passed a valid wallet address,
     * the customer won't be prompted to enter one. If you use this parameter,
     * only the cryptocurrencies for which you pass a wallet address will be shown to the customer,
     * unless you also pass the showAllCurrencies parameter.
     * If both walletAddresses and walletAddress are passed, walletAddresses takes precedence.
     * For ERC20 tokens, you only need to provide a wallet address for ETH.
     * It is mandatory to sign the URL if you're using this parameter.
     * Values need to be URL encoded in order to generate a valid signature.
     */
    walletAddresses?: string;
    /**
     * A JSON string representing the wallet address tags you want to use for various cryptocurrencies.
     * For example, a JSON string with EOS and XRP wallet address tags would resemble %7B\"eos\"%3A\"myeostag\"%2C\"xrp\"%3A\"0123456789\"%7D.
     * If the customer selects a cryptocurrency for which you have passed a valid wallet address tag,
     * the customer won't be prompted to enter one.
     * This parameter will be skipped if walletAddresses is not passed.
     * If both walletAddressTags and walletAddressTag are passed, walletAddressTags takes precedence.
     */
    walletAddressTags?: string;
    /**
     * The ISO 639-1 standard language code representing the language the widget should use.
     * If you pass a code for a language we do not support,
     * the widget will remain in the current default language.
     * This is usually the language of the customer's browser; if we do not offer that language, the widget will use English (en).
     */
    language?: string;
    /**
     * Configures the widget origin instead of inferring it from the environment.
     */
    baseOrigin?: string;
}
interface AdvancedWidgetQueryParams {
    /**
     * The signature of the widget url.
     */
    signature?: string;
    /**
     * The code of the fiat currency (e.g. usd, aud, gbp) you want the customer to purchase with.
     * Refer to our Currencies API to get a full list of supported currencies.
     */
    baseCurrencyCode?: string;
    /**
     * A positive integer representing how much fiat the customer wants to spend.
     * Best used together with the baseCurrencyCode & currencyCode parameters.
     * Refer to our Currencies API to get the minimum and maximum values for each currency.
     */
    baseCurrencyAmount?: string;
    /**
     * A positive integer representing how much crypto the customer wants to buy.
     * Best used together with the currencyCode & baseCurrencyCode parameters.
     * Refer to our Currencies API to get the minimum and maximum values for each currency.
     * Note that if you pass both baseCurrencyAmount and quoteCurrencyAmount,
     * the quote currency amount will take precedence.
     */
    quoteCurrencyAmount?: string;
    /**
     * Set this parameter to true to lock the baseCurrencyAmount set for the customer and prevent them from modifying it.
     * This parameter will be skipped if baseCurrencyAmount is not passed.
     */
    lockAmount?: string;
    /**
     * The customer's email address.
     * If you pass a valid email address, the customer won't be prompted to enter one.
     * If you are signing the URL, emails must be URL encoded (e.g. jane.doe%40email.com).
     * If a customer is already logged in and their e-mail address doesn't match with the URL address,
     * the customer will be logged out automatically.
     */
    email?: string;
    /**
     * An identifier you would like to associate with the transaction.
     * This identifier will be present whenever we pass you transaction data.
     */
    externalTransactionId?: string;
    /**
     * An identifier you would like to associate with the customer.
     * This identifier will be present whenever we pass you customer data, allowing you to match our data with your own existing customer data.
     */
    externalCustomerId?: string;
    /**
     * Pre-select the payment method you want the customer to use.
     * Available values for buy are listed under paymentMethod parameter here https://dev.moonpay.com/docs/ramps-sdk-buy-params
     * Available values for sell are under paymentMethod parameter here https://dev.moonpay.com/docs/ramps-sdk-sell-params
     */
    paymentMethod?: string;
    /**
     * A URL you'd like to redirect the customer to upon completion of the purchase.
     * We will append the transaction's ID and status as query parameters to your URL.
     * Must be URL encoded (e.g. https%3A%2F%2Fwww.myurl.com) MoonPay will add transactionId={{transactionId}}&transactionStatus=pending to the redirectURL.
     * We support deep links and appending your own custom parameters.
     */
    redirectURL?: string;
    /**
     * Set this parameter true to show all cryptocurrencies enabled on your account,
     * including those for which you did not pass any wallet address via the walletAddresses parameter.
     * You don't need to set this if you did not use the walletAddresses parameter.
     */
    showAllCurrencies?: string;
    /**
     * A comma-separated list of currency codes.
     * Set this parameter if you want to show only some of the cryptocurrencies enabled on your account,
     * without having to pass wallet addresses for those currencies.
     * If both the walletAddresses and showOnlyCurrencies parameters are passed
     * we will only show matching currencies present in both fields.
     * All other currencies will not be included.
     */
    showOnlyCurrencies?: string;
    /**
     * Set this parameter true to show the wallet address form,
     * even though you've already passed a valid wallet address via the walletAddress or walletAddresses parameters.
     * The customer will be able to see the valid wallet address,
     * but will not be able to change it.
     */
    showWalletAddressForm?: string;
    /**
     * A URL you'd like to redirect the customer upon coming from unsupported region.
     * After the user lands on an unsupported region screen, they will be redirected to provided URL after 3 seconds.
     */
    unsupportedRegionRedirectUrl?: string;
    /**
     * Set this parameter to true if you want to skip the widget's unsupported region screen and immediately redirect the customer.
     * If you set this parameter, you also need to set unsupportedRegionRedirectUrl.
     */
    skipUnsupportedRegionScreen?: string;
}
interface OnrampCommonWidgetQueryParams {
    /**
     * The code of the cryptocurrency (e.g., btc, eth, matic) you want the customer to purchase.
     * The customer will not be able to select another currency.
     */
    currencyCode?: string;
}
interface OfframpCommonWidgetQueryParams {
    /**
     * The default currency code of the currency you want the customer to sell.
     * For example, `defaultCurrencyCode=eth` will pre-select Ethereum
     * as the currency to sell.
     */
    defaultBaseCurrencyCode?: string;
    /**
     * The id of the MoonPay wallet used to start the sell transaction.
     * If you pass a valid wallet id the form will be pre-filled with the wallet address
     * and the balance will be shown for each selected currency.
     */
    mpWalletId?: string;
    /**
     * A wallet address to refund to if something goes wrong.
     */
    refundWalletAddress?: string;
    /**
     * An object with keys as currency codes and backup refund wallet addresses for those currencies as values.
     */
    refundWalletAddresses?: string;
    /**
     * The signature of the widget url.
     */
    quoteCurrencyCode?: string;
}
type OnrampWidgetQueryParams = BaseWidgetQueryParams & AdvancedWidgetQueryParams & OnrampCommonWidgetQueryParams;
type OfframpWidgetQueryParams = BaseWidgetQueryParams & AdvancedWidgetQueryParams & OfframpCommonWidgetQueryParams;
interface ClaimWidgetQueryParams {
    /**
     * Your publishable API key.
     * This is used to assign customers and transactions to your MoonPay account.
     */
    apiKey: string;
    /**
     * This is the ID of your HyperMint contract.
     * You can find this in the developers section under your contract configuration.
     */
    contractId: string;
    /**
     * This is the ID of the token that belongs to your contract.
     * You can find this under the 'tokens' section in the HyperMint dashboard.
     */
    tokenId: string;
    /**
     * The signature of the widget url.
     */
    signature?: string;
    /**
     * Override what screen is shown to the user first. Allows more flexibility in the widget flow.
     */
    initialScreen?: string;
}
interface SwapsCustomerSetupWidgetQueryParams extends ThemeQueryParams {
    /**
     * Your publishable API key.
     * This is used to assign customers and transactions to your MoonPay account.
     */
    apiKey: string;
    /**
     * The amount the customer wishes to swap -- the base currency amount in fiat.
     */
    amount: string;
    /**
     * The fiat currency code of the `amount` parameter, usually `usd`.
     */
    amountCurrencyCode: string;
    /**
     * An identifier you would like to associate with the customer.
     * This identifier will be present whenever we pass you customer data,
     * allowing you to match our data with your own existing customer data.
     */
    externalCustomerId?: string;
}
interface NftWidgetQueryParams extends ThemeQueryParams {
    /**
     * Your publishable API key.
     * This is used to assign customers and transactions to your MoonPay account.
     */
    apiKey: string;
    /**
     * NFT contract address for the NFT the customer wants to buy.
     */
    contractAddress: string;
    /**
     * The token id of the NFT the customer wants to buy.
     */
    tokenId: string;
    /**
     * The signature of the widget url. This parameter is required in production.
     */
    signature?: string;
    /**
     * The listing ID of the NFT the customer wants to buy.
     */
    listingId?: string;
    /**
     * An identifier associated with the transaction that is provided by you.
     */
    externalTransactionId?: string;
    /**
     * The fiat currency used by the customer for purchasing the NFT.
     */
    baseCurrencyCode?: string;
    /**
     * An optional URL.
     * You can pass a URL in this parameter
     * and the MoonPay widget will link to it on the transaction tracker page.
     */
    redirectURL?: string;
    /**
     * Your customer's NFT wallet address to which the NFT will be delivered.
     * Passing this parameter will pre-fill the wallet address in the form,
     * streamlining your customer's journey.
     */
    walletAddress?: string;
    /**
     * The name of the sub-partner.
     * If provided, the transaction will be created in the name of sub-partner
     * and the fees will be calculated based on the sub-partner's settings.
     */
    subPartnerName?: string;
    /**
     * JSON stringified object
     * containing additional metadata about the nft and/or transaction.
     * If provided will be passed to all NFT specific API calls.
     * Required in the Reservoir flow.
     */
    metadata?: string;
    /**
     * If you pass dynamicAssetInfo=true and walletAddress, the wallet address will be included in the request MoonPay makes to your /asset_info endpoint.
     * This will also be used in gas price estimation step. So if your smart contract has an allowlist of any kind please be sure to use this query param.
     * If you pass dynamicAssetInfo=true but no walletAddress, the widget will prompt the user to enter a wallet address at the beginning of the widget journey.
     */
    dynamicAssetInfo?: boolean;
    /**
     * The transaction sell Type (Primary or Secondary)
     * Primary Sell Type: Nft is minted and sent to your customer. `
     * Secondary Sell Type: Nft is sent to your customer from seller on the market.
     */
    sellType?: 'Primary' | 'Secondary';
    /**
     * Your customers email address.
     * If this is provided, login form will be prefilled and triggered. The buyer would be asked for an OTP code.
     */
    email?: string;
    /**
     * The quantity of NFTs the customer wants to buy. This parameter refers to multiples of the same NFT.
     * If you pass quantity, you must also return the correct available quantity in your /asset_info response.
     */
    quantity?: number;
}
interface LegacyWidgetQueryParams {
    /**
     * Full URL of the widget
     *
     * @example
     * ```
     * new MoonPayWebSdk({
     *  variant: 'overlay',
     *  params: {
     *    url: 'https://buy-sandbox.moonpay.com?apiKey=pk_test_123&currencyCode=btc'
     *  }
     * })
     * ```
     */
    url: string;
}
interface BalanceLedgerWidgetQueryParams extends ThemeQueryParams {
    /**
     * Your publishable API key.
     * This is used to assign customers and transactions to your MoonPay account.
     */
    apiKey: string;
    /**
     * An identifier you would like to associate with the customer.
     * This identifier will be present whenever we pass you customer data,
     * allowing you to match our data with your own existing customer data.
     */
    externalCustomerId: string;
    /**
     * The signature of the widget url.
     */
    signature?: string;
    /**
     * Configures the widget origin instead of inferring it from the environment.
     */
    baseOrigin?: string;
}
interface TopUpBalanceLedgerWidgetQueryParams extends BalanceLedgerWidgetQueryParams {
    /**
     * The code of the cryptocurrency (e.g., btc, eth, matic) you want the customer to topup.
     * The customer will not be able to select another currency.
     */
    currencyCode: string;
}
interface WithdrawBalanceLedgerWidgetQueryParams extends BalanceLedgerWidgetQueryParams {
    /**
     * The code of the cryptocurrency (e.g., btc, eth, matic) you want the customer to withdraw.
     * The customer will not be able to select another currency.
     */
    baseCurrencyCode: string;
}
interface SwapQueryParamsBase extends ThemeQueryParams {
    /**
     * Your publishable API key.
     * This is used to assign customers and transactions to your MoonPay account.
     */
    apiKey: string;
    /**
     * The cryptocurrency wallet address the purchased funds will be sent to.
     * If you pass a valid wallet address the customer won't be prompted to enter one.
     * This parameter will be skipped if currencyCode is not passed.
     * It is mandatory to sign the URL if you're using this parameter.
     * Values need to be URL encoded in order to generate a valid signature.
     */
    walletAddress?: string;
    /**
     * The secondary cryptocurrency wallet address identifier/memo for coins such as EOS, XLM, XRP and XMR.
     * This parameter will be skipped if walletAddress or currencyCode is not passed.
     */
    walletAddressTag?: string;
    /**
     * A wallet address compatible with the base cryptocurrency to be used in case of any issues with the swap.
     */
    refundWalletAddress?: string;
    /**
     * The signature of the widget url.
     */
    signature?: string;
    /**
     * Represents the quantity of cryptocurrency the customer intends to exchange.
     * It's a positive number and is best utilized in conjunction with both `baseCurrencyCode` and `quoteCurrencyCode`.
     * To determine the acceptable minimum and maximum values for each currency, consult our Currencies API.
     */
    baseCurrencyAmount?: string;
    /**
     * Represents the quantity of cryptocurrency the customer expects to receive after the exchange.
     * It's a positive number and is best utilized in conjunction with both `baseCurrencyCode` and `quoteCurrencyCode`.
     * To determine the acceptable minimum and maximum values for each currency, consult our Currencies API.
     */
    quoteCurrencyAmount?: string;
    /**
     * An identifier you would like to associate with the customer.
     * This identifier will be present whenever we pass you customer data,
     * allowing you to match our data with your own existing customer data.
     */
    externalCustomerId?: string;
    /**
     * Configures the widget origin instead of inferring it from the environment.
     */
    baseOrigin?: string;
}
interface SwapQueryParamsWithCurrencyCodes extends SwapQueryParamsBase {
    /**
     * The code of the cryptocurrency (e.g., eth, matic, aave) from which you want the customer to swap.
     */
    baseCurrencyCode?: string;
    /**
     * The code of the cryptocurrency (e.g., btc, eth, matic) to which you want the customer to swap.
     */
    quoteCurrencyCode?: string;
    /**
     * The currency codes of the pair to swap, separated by a hyphen (e.g. 'eth-aave').
     * Note: you cannot use this param and `baseCurrencyCode` and `quoteCurrencyCode` at the same time.
     */
    pair?: never;
}
interface SwapQueryParamsWithPair extends SwapQueryParamsBase {
    /**
     * The currency codes of the pair to swap, separated by a hyphen (e.g. 'eth-aave').
     * Note: you cannot use this param and `baseCurrencyCode` and `quoteCurrencyCode` at the same time.
     */
    pair?: string;
    /**
     * The code of the cryptocurrency (e.g., eth, matic, aave) from which you want the customer to swap.
     */
    baseCurrencyCode?: never;
    /**
     * The code of the cryptocurrency (e.g., btc, eth, matic) to which you want the customer to swap.
     */
    quoteCurrencyCode?: never;
}
type SwapQueryParams = SwapQueryParamsWithCurrencyCodes | SwapQueryParamsWithPair;
interface TransactionTrackerWidgetQueryParams extends ThemeQueryParams {
    /**
     * The id of the transaction to show the transaction tracker for.
     */
    transactionId: string;
    /**
     * Configures the widget origin instead of inferring it from the environment.
     */
    baseOrigin?: string;
}
interface MoonPayBalanceWidgetQueryParams extends ThemeQueryParams {
    /**
     * Configures the widget origin instead of inferring it from the environment.
     */
    baseOrigin?: string;
}
type MoonPayBalanceDepositWidgetQueryParams = MoonPayBalanceWidgetQueryParams;
type MoonPayBalanceWithdrawWidgetQueryParams = MoonPayBalanceWidgetQueryParams;
/**
 * @deprecated
 */
interface ConsumerKycWidgetQueryParams extends ThemeQueryParams {
    /**
     * Your publishable API key.
     * This is used to assign customers and transactions to your MoonPay account.
     */
    apiKey: string;
    /**
     * The amount the customer wishes to swap -- the base currency amount in fiat.
     */
    amount: string;
    /**
     * The fiat currency code of the `amount` parameter, usually `usd`.
     */
    amountCurrencyCode: string;
}

type WidgetEnvironment = 'production' | 'sandbox';
type WidgetFlow = Pick<MoonPayCoreSdkConfig, 'flow'>['flow'];
type MoonPaySdkPlatform = 'web' | 'rn';
interface MoonPayCoreSdkEnvironment {
    version: string;
    flow: WidgetFlow;
    environment: WidgetEnvironment;
    platform: MoonPaySdkPlatform;
}
interface MoonPayCoreSdkConfigCommon<TFlow extends WidgetFlow, TParams extends OnrampWidgetQueryParams | OfframpWidgetQueryParams | SwapsCustomerSetupWidgetQueryParams | NftWidgetQueryParams | LegacyWidgetQueryParams | ClaimWidgetQueryParams | TopUpBalanceLedgerWidgetQueryParams | WithdrawBalanceLedgerWidgetQueryParams | SwapQueryParams | TransactionTrackerWidgetQueryParams | ConsumerKycWidgetQueryParams | MoonPayBalanceDepositWidgetQueryParams | MoonPayBalanceWithdrawWidgetQueryParams> {
    /**
     * If true, SDK will show logs in the console.
     */
    debug?: boolean;
    /**
     * Environment widget is targeting. Used to determine hostname of the widget.
     */
    environment: WidgetEnvironment;
    /**
     * Determines what will be the flow of the widget.
     */
    flow: TFlow;
    /**
     * If provided, the SDK will open the widget in the single auth token mode.
     * The one-time token will be swapped for the real one.
     */
    auth?: {
        token: string;
        tokenType: string;
    };
    /**
     * Query parameters appended to the widget's URL hostname.
     */
    params: TParams;
    /**
     * Callbacks for events emitted by the widget.
     */
    handlers?: WidgetPostMessengerHandlers[TFlow];
    /**
     * Allows to configure specific widget origin
     * instead of inferring it from the environment.
     */
    baseOrigin?: string;
}
type MoonPayCoreSdkLegacyConfig = MoonPayCoreSdkConfigCommon<'legacy', LegacyWidgetQueryParams>;
type MoonPayCoreSdkBuyConfig = MoonPayCoreSdkConfigCommon<'buy', OnrampWidgetQueryParams>;
type MoonPayCoreSdkSellConfig = MoonPayCoreSdkConfigCommon<'sell', OfframpWidgetQueryParams>;
type MoonPayCoreSdkSwapsCustomerSetupConfig = MoonPayCoreSdkConfigCommon<'swapsCustomerSetup', SwapsCustomerSetupWidgetQueryParams>;
type MoonPayCoreSdkNftConfig = MoonPayCoreSdkConfigCommon<'nft', NftWidgetQueryParams>;
type MoonPayCoreSdkClaimConfig = MoonPayCoreSdkConfigCommon<'claim', ClaimWidgetQueryParams>;
type MoonpayCoreSdkMoonPayBalanceDepositConfig = MoonPayCoreSdkConfigCommon<'moonPayBalanceDeposit', MoonPayBalanceDepositWidgetQueryParams>;
type MoonpayCoreSdkMoonPayBalanceWithdrawConfig = MoonPayCoreSdkConfigCommon<'moonPayBalanceWithdraw', MoonPayBalanceWithdrawWidgetQueryParams>;
type MoonPayCoreSdkTopUpConfig = MoonPayCoreSdkConfigCommon<'topup', TopUpBalanceLedgerWidgetQueryParams>;
type MoonPayCoreSdkWithdrawConfig = MoonPayCoreSdkConfigCommon<'withdraw', WithdrawBalanceLedgerWidgetQueryParams>;
type MoonPayCoreSdkSwapConfig = MoonPayCoreSdkConfigCommon<'swap', SwapQueryParams>;
type MoonPayCoreSdkTransactionTrackerConfig = MoonPayCoreSdkConfigCommon<'transactionTracker', TransactionTrackerWidgetQueryParams>;
/**
 * @deprecated
 */
type MoonPayCoreSdkConsumerKycConfig = MoonPayCoreSdkConfigCommon<'consumerKyc', ConsumerKycWidgetQueryParams>;
type MoonPayCoreSdkConfig = MoonPayCoreSdkBuyConfig | MoonPayCoreSdkSellConfig | MoonPayCoreSdkSwapsCustomerSetupConfig | MoonPayCoreSdkNftConfig | MoonPayCoreSdkLegacyConfig | MoonPayCoreSdkClaimConfig | MoonPayCoreSdkTopUpConfig | MoonPayCoreSdkWithdrawConfig | MoonPayCoreSdkSwapConfig | MoonPayCoreSdkTransactionTrackerConfig | MoonpayCoreSdkMoonPayBalanceDepositConfig | MoonpayCoreSdkMoonPayBalanceWithdrawConfig | MoonPayCoreSdkConsumerKycConfig;
type MoonPayCoreSdkConfigWithLogger = WithLogger<MoonPayCoreSdkConfig>;

declare abstract class MoonPayCoreSdk {
    protected config: MoonPayCoreSdkConfigWithLogger;
    constructor(config: MoonPayCoreSdkConfig);
    /**
     * Closes widget and clears subscribed events.
     */
    abstract close(): void;
    /**
     * Shows widget in specified variant.
     */
    abstract show(options?: unknown): unknown;
    /**
     * Returns merged common config and flow-specific config.
     */
    protected abstract getConfig(options?: unknown): MoonPayCoreSdkConfigWithLogger & unknown;
    /**
     * Registers postMessage handlers and listens for the handshake message.
     */
    protected abstract registerPostMessageHandlers(): void;
    /**
     * Returns current SDK environment.
     * This object will be appended to the widget URL.
     */
    protected abstract getSdkEnvironment(options?: unknown): MoonPayCoreSdkEnvironment & unknown;
    /**
     * Updates signature in the config's params.
     * Useful when you send widget URL to the server for signing.
     */
    updateSignature(signature: string): this;
    /**
     * Returns URL that can be sent to the server for signing.
     * When you sign URL, you can use `updateSignature`.
     */
    generateUrlForSigning(props?: unknown): string;
    private initiateLogger;
}

type WidgetVariant = 'overlay' | 'embedded' | 'newTab' | 'newWindow';
interface MoonPayWebSdkEnvironment extends MoonPayCoreSdkEnvironment {
    platform: 'web';
    variant: WidgetVariant;
}
type CrossFrameMessagingHandlers = MoonPayCoreSdkConfig['handlers'];
type LocalEventHandlers = Partial<{
    onCloseOverlay?: () => void;
}>;
type MoonPayCoreSdkConfigWithoutHandlers = MoonPayCoreSdkConfig extends {
    handlers: any;
} ? Omit<MoonPayCoreSdkConfig, 'handlers'> : MoonPayCoreSdkConfig;
type MoonPayWebSdkConfig = MoonPayCoreSdkConfigWithoutHandlers & {
    /**
     * Determines how will widget be shown:
     * 1. overlay - modal with semi-transparent background behind it
     * 2. embedded - iframe will be appended to the DOM node itself
     * 3. newTab - as a standalone page in the new tab
     * 4. newWindow - as a standalone window
     */
    variant: WidgetVariant;
    /**
     * Selector for the node where the widget will be embedded.
     * Required when the variant is "embedded".
     *
     * @example
     * ```
     * new MoonPayWebSdk({
     *  environment: 'sandbox',
     *  variant: 'embedded',
     *  containerNodeSelector: '#moonpay-widget',
     *  params: {
     *    apiKey: 'pk_test_123'
     *  }
     * })
     * ```
     */
    containerNodeSelector?: string;
    /**
     * Used when variant is newTab or newWindow.
     * If false, those variants won't show the overlay.
     *
     * Default: true
     */
    useOverlay?: boolean;
    /**
     * Node or string to be shown while the widget is loading.
     * If not present, the MoonPay logo and "Loading your gateway to Web3..." text will be shown.
     */
    overlayNode?: Node | string;
    /**
     * Flag indicating whether to show a warning before refreshing the page.
     * If true, the widget will show a warning before refreshing the page.
     * If false, the widget will refresh the page without showing a warning.
     * Default: true
     */
    useWarnBeforeRefresh?: boolean;
    /**
     * Object containing handlers for the widget events.
     */
    handlers?: CrossFrameMessagingHandlers & LocalEventHandlers;
};
type MoonPayWebSdkExtendedConfig = WithLogger<MoonPayWebSdkConfig> & {
    sdkEnvironment: MoonPayWebSdkEnvironment;
};

declare class MoonPayWebSdk extends MoonPayCoreSdk {
    private variant;
    private containerNodeSelector?;
    private useOverlay;
    /**
     * Object containing reference to the widget window and a cleanup function.
     */
    private widgetInstance;
    /**
     * Reference to the postMessenger instance used to communicate with the widget.
     */
    private postMessenger;
    /**
     * Flag indicating whether to show a warning before refreshing the page.
     */
    private useWarnBeforeRefresh;
    constructor({ useOverlay, variant, containerNodeSelector, useWarnBeforeRefresh, ...coreConfig }: MoonPayWebSdkConfig);
    /**
     * Closes widget and clears subscribed events.
     */
    close(): void;
    /**
     * Shows widget in specified variant.
     */
    show(): this;
    protected getSdkEnvironment(): MoonPayWebSdkEnvironment;
    protected getConfig(): MoonPayWebSdkExtendedConfig;
    protected registerPostMessageHandlers(): void;
    private cleanUpEventListeners;
    private handleEscPress;
    private handleBeforeUnload;
    private handleCloseOverlay;
}

type MoonPayWebSdkInitFn = (config: MoonPayWebSdkConfig) => MoonPayWebSdk | null;

declare function loadMoonPay(version?: string | null): Promise<MoonPayWebSdkInitFn | undefined>;

export { loadMoonPay };
