import { AbstractMessageHandler } from '../core/AbstractMessageHandler';
import { MessageRequestInterface } from '../core/MessageRequestInterface';
import { AsyncLoader } from '../../shared/AsyncLoader';
import { Buffer } from 'buffer';
import { Transaction } from '@emurgo/cardano-serialization-lib-nodejs';
import { WalletAddressesService } from '../../shared/wallet-addresses.service';
import { autoInjectable, singleton } from 'tsyringe';
import { ConceptualWalletService } from '../../api/conceptual-wallet.service';
import { AddressUtxoResponse, SwapDetails, SwapToken, SwapTokenCurrency } from '../../shared/types';
import { UtxosService } from '../../services/utxos.service';
import { MultiAssetToAssetMapper } from '../../mappers/multiasset-to-asset-mapper';
import { AssetWithQuantity } from '../../models/asset-quantity';
import { TransactionBody, Value } from '@emurgo/cardano-serialization-lib-browser';
import { AssetsService } from '../../services/assets.service';
import { TxMetadataService } from '../../services/tx-metadata.service';

interface DAppSignTXHandlerRequestParams extends MessageRequestInterface {
    params: {
        tx: string;
        currency: string;
    };
}

interface DiffAssets {
  assetName: string;
  quantity: bigint,
  policy?: string,
  id: string;
}

interface TokenInfo {
  name: string;
  image: string;
  current_price: number;
}

@singleton()
@autoInjectable()
export class DAppFetchTxInfoHandler extends AbstractMessageHandler {
  constructor(
      private walletAddressesService?: WalletAddressesService,
      private conceptualWalletService?: ConceptualWalletService,
      private utxosService?: UtxosService,
      private multiAssetToAssetMapper?: MultiAssetToAssetMapper,
      private assetsService?: AssetsService,
      private txMetadataService?: TxMetadataService
  ) {
    super();
  }

  async handle(request: DAppSignTXHandlerRequestParams) {
    const rawTx: Transaction = AsyncLoader.Serialization.Transaction.from_bytes(
      Buffer.from(request.params.tx, 'hex')
    );
    const txBody = rawTx.body();
    const txMetadata = this.txMetadataService.parseMetadata(rawTx);

    const fee = +this.getFee(txBody);
    const utxos: AddressUtxoResponse[] = await this.utxosService.getUtxosResponse();
    const conceptualWalletId = this.conceptualWalletService.getCurrentActiveWalletId();
    const changeAddress = await this.walletAddressesService.getMainAddress(+conceptualWalletId);

    const inputValue = this.calculateInputValue(txBody, utxos);
    const inputValueAssets = this.multiAssetToAssetMapper.getAssetsFromMultiAsset(inputValue.multiasset());
    inputValueAssets.push(new AssetWithQuantity('cardano', inputValue.coin().to_str()));

    const outputValue = this.calculateOutputValue(txBody, changeAddress);
    const outputValueAssets = this.multiAssetToAssetMapper.getAssetsFromMultiAsset(outputValue.multiasset());
    outputValueAssets.push(new AssetWithQuantity('cardano', outputValue.coin().to_str()));

    const diff = this.diffAssetsFromIncomingToOutgoing(inputValueAssets, outputValueAssets);
    const recipient = this.getTo(txBody, changeAddress);

    const { payTokens, receiveTokens } = this.getPayAndReceiveTokens(diff);
  
    const distinctAssetNames = Array.from(new Set([
      'cardano',
      ...payTokens.map(token => token.name.toLowerCase()),
      ...receiveTokens.map(token => token.name.toLowerCase()),
    ]));
    const infoPerToken = await this.getInfoPerToken(distinctAssetNames, request.params.currency);

    let feeInCurrency = undefined;
    if (request.params.currency) {
      const infoInCardano = this.getTokenInfo('cardano', infoPerToken);
      feeInCurrency = infoInCardano ? (fee / 1000000) * infoInCardano.current_price : undefined;  
    }

    const payTokensInCurrency: SwapTokenCurrency[] = await this.getTokenWithCurrency(payTokens, infoPerToken, request.params.currency);
    const receiveTokensInCurrency: SwapTokenCurrency[] = await this.getTokenWithCurrency(receiveTokens, infoPerToken, request.params.currency);

    const swapDetails: SwapDetails = {
      fee,
      feeInCurrency: feeInCurrency ? feeInCurrency.toString() : '',
      payTokens: payTokensInCurrency,
      receiveTokens: receiveTokensInCurrency,
      recipient,
      txCbor: request.params.tx,
      txMetadata,
    }
    request.cb(swapDetails);
  }

  private getFee(txBody): string {
    return txBody.fee().to_str();
  }

  private getMetadata(tx: Transaction): object | undefined {
    let metadata = tx.auxiliary_data()?.metadata();
    if (metadata && metadata.keys()) {
      const jsonMetadata = {};
      const keys = metadata.keys();
      for (let i = 0; i < keys.len(); i++) {
        const key = keys.get(i);
        jsonMetadata[key.to_str()] = AsyncLoader.Serialization.decode_metadatum_to_json_str(
          metadata.get(key),
          AsyncLoader.Serialization.MetadataJsonSchema.BasicConversions
        );
      }
      return jsonMetadata;
    }
    return undefined;
  }

  private calculateInputValue(txBody: TransactionBody, utxos: AddressUtxoResponse[]): Value {
    let inputValue = AsyncLoader.Serialization.Value.new(
      AsyncLoader.Serialization.BigNum.from_str('0')
    );
    for (let i = 0; i < txBody.inputs().len(); i++) {
      const input = txBody.inputs().get(i);
      const inputTxHash = Buffer.from(
          input.transaction_id().to_bytes()
      ).toString('hex');
      const inputTxIndex = input.index();
      const utxo = utxos.find((utxo) => {
          return inputTxHash === utxo.tx_hash && utxo.tx_index === inputTxIndex;
      }); 
      if (utxo) {
          inputValue = inputValue.checked_add(this.cardanoValueFromRemoteFormat(utxo));
      }
    }
    return inputValue;
  }

  private calculateOutputValue(txBody: TransactionBody, changeAddress: string) {
    let walletsOutputValue = AsyncLoader.Serialization.Value.new(
      AsyncLoader.Serialization.BigNum.from_str('0')
    );

    for (let i = 0; i < txBody.outputs().len(); i++) {
      const output = txBody.outputs().get(i);
      const bech32Address = output.address().to_bech32();
      if (bech32Address === changeAddress) {
        walletsOutputValue = walletsOutputValue.checked_add(output.amount());
      }
    }

    return walletsOutputValue;
  }

  private getTo(txBody, changeAddress): string {
    for (let i = 0; i < txBody.outputs().len(); i++) {
        const keyAddress = txBody.outputs().get(i).address();
        const bech32Address = keyAddress.to_bech32();
        if (changeAddress !== bech32Address) {
            return bech32Address;
        }
    }
    return changeAddress;
  }

  private normalizeTokenName(token: string): string {
    return token.toLowerCase() === 'cardano' ? 'ADA' : token;
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

  private getTokenInfo(token: string, tokensDetails: TokenInfo[]): TokenInfo | undefined {
    if (tokensDetails && tokensDetails.length > 0) {
      return tokensDetails.find((x) => x.name.toLowerCase() === token.toLowerCase());
    }
    return undefined;
  }

  private getTokenWithCurrency(tokens: SwapToken[], infoPerToken: TokenInfo[], currency: string) {
    return Promise.all(tokens.map(async (token) => {
      const infoInToken = this.getTokenInfo(token.name, infoPerToken);
      const properAmount = token.name === 'cardano' ? +token.amount / 1000000 : +token.amount;

      let decimals = 0;
      let image = infoInToken?.image;
      if (!image && token.name !== 'cardano') {
        const assetInfo = await this.assetsService.fetchAssetInfo(token.id);
        image = await this.assetsService.getIcon(assetInfo, token.name);
        decimals = this.assetsService.getDecimals(assetInfo);
      }

      return {
        name: this.normalizeTokenName(token.name),
        amount: token.amount,
        id: token.id,
        currency,
        current_price: infoInToken?.current_price,
        amountInCurrency: infoInToken ? properAmount * infoInToken.current_price : undefined,
        image: image ?? undefined,
        decimals: decimals ?? 0,
      };
    }));
  }

  private diffAssetsFromIncomingToOutgoing(inputAssets: AssetWithQuantity[], outputAssets: AssetWithQuantity[]): DiffAssets[] {
    const allAssets = new Set<string>([
      ...inputAssets.map((input) => input.asset.name),
      ...outputAssets.map((output) => output.asset.name),
    ]);
    return Array.from(allAssets).map(assetName => {
      const inValue = inputAssets.find((input) => input.asset.name === assetName);
      const outValue = outputAssets.find((output) => output.asset.name === assetName);
      const difference =
      BigInt(inValue ? inValue.quantity : '') -
      BigInt(outValue ? outValue.quantity : '');
      if (assetName === 'cardano') {
        return { assetName, quantity: difference, id: 'cardano' };
      }
      const policy = assetName.slice(0, 56);
      return {
          assetName,
          quantity: difference,
          policy,
          id: inValue ? inValue.asset.id : outValue?.asset.id,
      };
    }).filter(asset => asset.quantity !== BigInt(0));
  }

  private getPayAndReceiveTokens(diff: DiffAssets[]): { payTokens: SwapToken[], receiveTokens: SwapToken[] } {
    const payTokens: SwapToken[] = [];
    const receiveTokens: SwapToken[] = [];
    for (let i = 0; i<diff.length; i++) {
      if (diff[i].quantity > BigInt(0) ) {
        payTokens.push({
          name: diff[i].assetName,
          amount: diff[i].quantity.toString(),
          id: diff[i].id,
        });
      } else if (diff[i].quantity < BigInt(0)) {
        receiveTokens.push({
          name: diff[i].assetName,
          amount: (diff[i].quantity * BigInt(-1)).toString(),
          id: diff[i].id,
        });
      }
    }
    return { payTokens, receiveTokens };
  }

  private async getInfoPerToken(assets: string[], currency: string): Promise<TokenInfo[]> {
    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=${currency}&price_change_percentage=24h&ids=${assets.join(',')}`;
    return await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    }).then((res) => res.json())
      .catch(() => undefined
    );
  }

}
