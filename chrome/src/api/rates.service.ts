/* eslint-disable prettier/prettier */
import { AbstractModel } from '../database/models/AbstractModel';
import { PriceData } from '../database/models/PriceData';
import { validateSync } from 'class-validator';
import { IDataPayload } from '../database/GeroWalletDatabase';
import { LogService } from '../services/log.service';
import { CoinGecko } from "../../../angular/src/app/utils/coin-gecko";


interface Response {
    id: string;
    current_price: number;
    last_updated: string;
    price_change_percentage_24h_in_currency: number;
}
export class RatesService extends AbstractModel {
    constructor(
        public fromCurrency: string[],
        public toCurrency: string,
        private logService: LogService
    ) {
        super('priceData');
    }

    public async getLatestRateFromApi() {
        const normalizeAssetName = this.fromCurrency.map(x => CoinGecko.normalizeId(x)) ;
        try {
            const result = await fetch(
                `https://api.coingecko.com/api/v3/coins/markets?vs_currency=${this.toCurrency}&price_change_percentage=24h&ids=${normalizeAssetName.join(',')}`
            );
            const data = await result.json()
            const revertAssetName = data.map(x=>{
                x.id = CoinGecko.revertId(x.id);
                return x;    
            });

            this.fromCurrency.forEach(async x => {
                const temp = revertAssetName.find(z => z.id.toLowerCase() === x);
                const priceData = temp ? this.toPriceData(temp, x): undefined ;
                if (priceData) {
                    await this.addToDatabase(priceData);
                }
            })
            return true;
        } catch (e) {
            this.logService.log(`getLatestRateFromApi error: ${JSON.stringify(e)}`);
            return false;
        }
    }

    private toPriceData(rate: Response, fromCurrency: string) {
        const price: number = rate.current_price;
        const time = new Date(rate.last_updated);
        const percentage = rate.price_change_percentage_24h_in_currency;
        const priceData = new PriceData(fromCurrency, this.toCurrency, price, time, percentage);
        const errors = validateSync(priceData);
        if (errors.length === 0) {
            return priceData;
        }
        return undefined;
    }

    private async addToDatabase(priceData: PriceData) {
        const existingRate: Partial<PriceData> = {
            from: priceData.from,
            to: priceData.to,
        };
        const result = await this.getBy(existingRate);
        const data = result.payload as IDataPayload[];
        if (data.length === 1) {
            this.put({
                ...priceData,
                id: (data[0] as any).id,
            });
        } else if (data.length === 0) {
            this.saveNew(priceData);
        } else {
            // do a complete cleanup and add a new entry, since we need to have one entry/currency-pair
            if (data && Array.isArray(data)) {
                data.forEach((entry) => this.delete((entry as any).id));
                this.saveNew(priceData);
            }
        }
    }
}
