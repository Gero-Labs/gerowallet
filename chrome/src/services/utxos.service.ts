import { Paginate } from '../dAppConnector/types';
import { autoInjectable, singleton } from 'tsyringe';
import { ConceptualWalletService } from '../api/conceptual-wallet.service';
import { AsyncLoader } from '../shared/AsyncLoader';
import { WalletInfoService } from './wallet-info.service';
import { db } from '../database/GeroWalletDatabase';
import { TransactionsService } from '../api/transactions.service';
import { COLLATERAL_AMOUNT } from '../constants';

@singleton()
@autoInjectable()
export class UtxosService {
    constructor(
        private transactionsService?: TransactionsService,
        private walletInfoService?: WalletInfoService,
        private conceptualWalletService?: ConceptualWalletService,
    ) {}

    public async getUtxos(amount: string | undefined = undefined, paginate: Paginate | undefined = undefined) {
        const utxosResponse = await this.getUtxosResponse();
        let utxos = utxosResponse
            .map((utxo) => {
                return AsyncLoader.Serialization.TransactionUnspentOutput.new(
                    AsyncLoader.Serialization.TransactionInput.new(
                        AsyncLoader.Serialization.TransactionHash.from_bytes(Buffer.from(utxo.tx_hash, 'hex')),
                        utxo.tx_index,
                    ),
                    AsyncLoader.Serialization.TransactionOutput.new(
                        AsyncLoader.Serialization.Address.from_bech32(utxo.receiver),
                        this.cardanoValueFromRemoteFormat(utxo),
                    ),
                )}
            );
        if (amount) {
            const amountToFilter = AsyncLoader.Serialization.Value.from_bytes(Buffer.from(amount, 'hex'));

            utxos = utxos.filter(
                (utxo) =>
                    !utxo.output().amount().compare(amountToFilter) ||
                    utxo.output().amount().compare(amountToFilter) !== -1,
            );
        }
        const cborUtxos = utxos.map((utxo) => Buffer.from(utxo.to_bytes()).toString('hex'));
        return cborUtxos;
    }

    private cardanoValueFromRemoteFormat(utxo) {
        const cardanoValue = AsyncLoader.Serialization.Value.new(
            AsyncLoader.Serialization.BigNum.from_str(utxo.amount),
        );

        if (!utxo.assets || utxo.assets.length === 0) {
            return cardanoValue;
        }

        const assets = AsyncLoader.Serialization.MultiAsset.new();

        utxo.assets.forEach((asset) => {
            const policyId = AsyncLoader.Serialization.ScriptHash.from_bytes(Buffer.from(asset.policyId, 'hex'));
            const assetName = AsyncLoader.Serialization.AssetName.new(Buffer.from(asset.name || '', 'hex'));
            const quantity = AsyncLoader.Serialization.BigNum.from_str(asset.amount);

            const policyContent = assets.get(policyId) ?? AsyncLoader.Serialization.Assets.new();

            policyContent.insert(assetName, quantity);
            assets.insert(policyId, policyContent);
        });

        if (assets.len() > 0) {
            cardanoValue.set_multiasset(assets);
        }

        return cardanoValue;
    }

    public async getUtxosResponse() {
        const conceptualWalletId = this.conceptualWalletService.getCurrentActiveWalletId();
        const walletInfo = await this.walletInfoService.getData(+conceptualWalletId);
        const utxosResponse = await this.transactionsService.getUTXOsForRewardAddress(walletInfo.rewardAddress);
        const storedCollaterals = await db.collateral.where({ conceptualWalletId: +conceptualWalletId }).toArray();
        if (storedCollaterals && storedCollaterals.length > 0) {
            return utxosResponse.filter(
                (utxo) =>
                    utxo.tx_hash !== storedCollaterals[storedCollaterals.length - 1].txHash ||
                    (utxo.tx_hash === storedCollaterals[storedCollaterals.length - 1].txHash && utxo.amount !== COLLATERAL_AMOUNT)
            )
        }
        return utxosResponse;
    }
}
