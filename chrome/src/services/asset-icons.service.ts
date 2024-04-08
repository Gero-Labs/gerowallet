/* eslint-disable prettier/prettier */
import { autoInjectable, singleton } from 'tsyringe';
import { CoinGecko } from "../../../angular/src/app/utils/coin-gecko";

@singleton()
@autoInjectable()
export class AssetIconService {

    public async getIcon(asset: string): Promise<string> {
        const normalizeAssetName = CoinGecko.normalizeId(asset);

        const response = await fetch(
            `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&price_change_percentage=24h&ids=${normalizeAssetName}`,
        );
        const data = await response.json();
        const temp = data.find(z => z.id.toLowerCase() === normalizeAssetName.toLowerCase());
        return temp?.image;
    }

}
