import { autoInjectable, singleton } from 'tsyringe';
import { BlockFrostService } from '../api/blockfrost.service';
import { CacheHandler, CacheType } from '../messaging/handlers';
import { BlockfrostAssetInfoResponse, TransactionAssetsAmount } from '../models';
import { FileUtils } from '../shared/file-utils';
import { AddressUtxoResponse, AssetModel, AssetModelExtended, BlockfrostTransactionInfo, TransactionDirection } from '../shared/types';
import { flatten, groupBy } from '../shared/utils';
import { AdaHandleUtils } from '../shared/ada-handle.utils';

declare const Buffer;

@singleton()
@autoInjectable()
export class AssetsService {
    private cache = new CacheHandler();

    constructor(private blockFrostService: BlockFrostService) {}
    
    public handleUtxosAssets(utxos: AddressUtxoResponse[]): AssetModel[] {
        const allAssets: Array<AssetModel> = [];

        utxos.forEach((utxo: any) => {
            utxo?.assets.forEach(asset => {
                allAssets.push({
                    ...asset,
                    ticker: this.getTickerFromName(asset.name)
                });
            });
        });

        const assets = [];
        this.getAssetsMap(allAssets).forEach(value => assets.push(value));
        return assets;
    }

    public getTickerFromName(name: string): string {
        const utf8Encoded = Buffer.from(name || '', 'hex').toString('utf-8');
        const specialCharactersRegex = /�/g;
        if (utf8Encoded && !specialCharactersRegex.test(utf8Encoded)) {
            return utf8Encoded;
        }
        return name || '?';
    }

    public getTxAssetsAmount(
        transaction: BlockfrostTransactionInfo,
        addressesArray: string[],
        transactionDirection: TransactionDirection,
    ): TransactionAssetsAmount[] {
        const groupByAssetName = (assets: TransactionAssetsAmount[]) =>
            Object.entries<TransactionAssetsAmount[]>(groupBy(assets, a => a.name));
        const formatAssetName = (asset: TransactionAssetsAmount) => ({
            name: this.getTickerFromName(asset.name),
            assetId: asset.assetId,
            amount: Math.abs(asset.amount),
        });

        const calcAssetTotalAmount = (totalAmount, asset) => totalAmount + Number(asset.amount);
        const calcAssetsTotalAmount = (acc, [key, value]) => [
            ...acc,
            { name: key, assetId: value[0].assetId, amount: value.reduce(calcAssetTotalAmount, 0) },
        ];
        const getAssetsTotalAmount = entries =>
            entries.map(entry => groupByAssetName(entry.assets).reduce(calcAssetsTotalAmount, []));
        const getTxTotalAssetsAmount = (assets: TransactionAssetsAmount[]) =>
            groupByAssetName(assets).map(([key, value]) => ({
                name: key,
                assetId: value[0].assetId,
                amount: value.reduce(calcAssetTotalAmount, 0),
            }));
        const filterByAddresses = entries => entries.filter(entry => addressesArray.includes(entry.address));
        const calcIOTotalAmount = entries => 
            getTxTotalAssetsAmount(flatten(getAssetsTotalAmount(filterByAddresses(entries))));

        const calcTxAmount = (inputAssets, outputAssets) => {
            const subtract = data => (acc, curr) => {
                const assets = [curr, ...data.filter(asset => asset.name === curr.name)];
                return [
                    ...acc,
                    assets.reduce((acc, curr) => ({ ...curr, amount: curr.amount - acc.amount }), { amount: 0 }),
                ];
            };

            if (inputAssets.length === 0 && outputAssets.length === 0) {
                return [];
            }

            return transactionDirection === TransactionDirection.Send
                ? inputAssets.reduce(subtract(outputAssets), [])
                : outputAssets.reduce(subtract(inputAssets), []);
        };

        return calcTxAmount(calcIOTotalAmount(transaction.inputs), calcIOTotalAmount(transaction.outputs))
            .filter(asset => Math.abs(asset.amount) > 0)
            .map(formatAssetName);
    }

    private getAssetsMap(assets: Array<AssetModel>): Map<string, AssetModel> {
        const assetsMap = new Map<string, AssetModel>();
        assets.forEach(asset => {
            const assetFound = assetsMap.get(asset.assetId);
            if (assetFound) {
                assetFound.amount = Number(assetFound.amount) + Number(asset.amount);
            } else {
                assetsMap.set(asset.assetId, asset);
            }
        });

        return assetsMap;
    }

    public async resolveIconAndDecimals(asset: AssetModel): Promise<AssetModelExtended> {
        const assetInfo = await this.fetchAssetInfo(asset.assetId);
        const icon = this.getIcon(assetInfo, asset.name);
        const decimals = this.getDecimals(assetInfo);
        return {
            ...asset,
            decimals: decimals,
            icon: icon,
            metadata: assetInfo.onchain_metadata,
            isNFT: this.isNFT(assetInfo),
        };
    }

    public resolveTicker(asset: AssetModelExtended): AssetModelExtended {
        if (!AdaHandleUtils.isHandle(asset.policyId)) {
            return asset
        }

        return {
            ...asset,
            ticker: AdaHandleUtils.getHandleName(asset.ticker)
        }
    }

    public async fetchAssetInfo(assetId: string): Promise<BlockfrostAssetInfoResponse> {
        const info = this.cache.get(assetId, CacheType.assetInfo);

        if (!!info) {
            return info;
        }
        const result = await this.blockFrostService.fetchSpecificAssetInfo(assetId);
        const assetsPerPolicyId = await this.blockFrostService.fetchSpecificPolicyIdAssets(result.policy_id);
        const data = { ...result, assetsPerPolicyId };
        this.cache.set(assetId, CacheType.assetInfo, data);
        return data;
    }

    private isNFT(assetInfo: BlockfrostAssetInfoResponse): boolean {
        try {
            const ruleA =
                !!assetInfo?.onchain_metadata &&
                assetInfo?.onchain_metadata?.tokenType !== 'token' &&
                !!assetInfo?.onchain_metadata?.image &&
                !assetInfo?.metadata;

            return ruleA && (assetInfo.assetsPerPolicyId > 1 || assetInfo?.onchain_metadata?.files?.length > 0);
        } catch (e) {
            return false;
        }
    }

    private getAssetImage(image: string | string[]): string {
        if (Array.isArray(image)) {
            // join all string parts (NFT Metadata Standard)
            return (image as string[]).join('');
        }
        return image as string;
    }

    public getIcon(assetInfo: BlockfrostAssetInfoResponse, assetTicker: string): string {
        try {
            const image = assetInfo?.onchain_metadata?.image
                ? this.getAssetImage(assetInfo.onchain_metadata.image)
                : this.getAssetImage(assetInfo?.metadata?.logo);
            const imagePath = image && image.split('//').length > 0 ? image.split('//')[0] : '';
            if (image.startsWith('data:image')) {
                return image;
            }
            if (imagePath === 'ipfs:') {
                return image;
            }
            if (imagePath === 'https:' || imagePath === 'http:') {
                return image;
            }
            if (assetInfo.metadata !== null) {
                return FileUtils.getEncodedBase64String(assetInfo.metadata.logo);
            }

            return ``;
        } catch (error) {
            return ``;
        }
    }

    public getDecimals(assetInfo: BlockfrostAssetInfoResponse): number | undefined {
        return assetInfo?.metadata?.decimals;
    }
}
