import { environment } from '../../../angular/src/environments/environment';
import { GERO_CARDANO_SERVER } from '../constants';
import { LogService } from './log.service';

export enum EnabledPaymentMethods {
    credit_debit_card = 'credit_debit_card',
    apple_pay = 'apple_pay',
    google_pay = 'google_pay',
    samsung_pay = 'samsung_pay',
    sepa_bank_transfer = 'sepa_bank_transfer',
    gbp_bank_transfer = 'gbp_bank_transfer',
    gbp_open_banking_payment = 'gbp_open_banking_payment',
}

/**
 * This method's instance will construct the MoonPay's url.
 * When instance created, use getURLConstructed method to receive the URL
 */
export class MoonPayBuilder {
    private readonly MOONPAY_SERVER = environment.MOONPAY_URL;
    private readonly enabledPaymentMethods!: EnabledPaymentMethods;
    private readonly currencyCode = 'ada';
    private readonly walletAddress!: string;
    private readonly colorCode = '%2300c77a';
    private readonly url!: string;

    constructor(
        enabledPaymentMethods: EnabledPaymentMethods,
        walletAddress: string,
        baseCurrency: string,
        private logService: LogService
    ) {
        this.enabledPaymentMethods = enabledPaymentMethods;
        this.walletAddress = walletAddress;

        const paymentMethodParam = `&enabledPaymentMethods=${this.enabledPaymentMethods}`;
        const currencyParam = `&currencyCode=${this.currencyCode}`;
        const walletAddressParam = `&walletAddress=${this.walletAddress}`;
        const colorCodeParam = `&colorCode=${this.colorCode}`;
        const baseCurrencyParam = `&baseCurrencyCode=${baseCurrency}`;
        this.url =
            this.MOONPAY_SERVER +
            paymentMethodParam +
            currencyParam +
            walletAddressParam +
            colorCodeParam +
            baseCurrencyParam;
    }

    public async getURLConstructed(): Promise<string> {
        const result = await fetch(`${GERO_CARDANO_SERVER}/moonpay/sign`, {
            headers: {
                'Content-Type': 'application/json',
            },
            method: 'POST',
            body: JSON.stringify({ moonpayURL: this.url }),
        });

        return result
            .json()
            .then((sign) => {
                return `${this.url}&signature=${encodeURIComponent(sign.signature)}`;
            })
            .catch((error) => {
                this.logService.log(`Moonpay getURLConstructed error: ${JSON.stringify(error)}`);
                return this.url;
            });
    }
}
