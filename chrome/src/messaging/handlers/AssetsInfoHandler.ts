/* eslint-disable prettier/prettier */
import { AbstractMessageHandler } from "../core/AbstractMessageHandler";
import { MessageRequestInterface } from "../core/MessageRequestInterface";
import { autoInjectable, singleton } from "tsyringe";
import { AssetsService } from "../../services/assets.service";
import { AssetModel, AssetModelExtended } from "../../shared/types";

export interface AssetsInfoMessageRequest extends MessageRequestInterface {
  params: {
    assets: AssetModel[];
  }
}

@singleton()
@autoInjectable()
export class AssetsInfoHandler extends AbstractMessageHandler {

  constructor(
    private assetsService: AssetsService
  ) {
    super();
  }

  public async handle(request: AssetsInfoMessageRequest) {
    const assets = request.params.assets;
    const response: AssetModelExtended[] = await Promise.all(assets.map(async (asset) => {
      if (asset.name === 'Cardano') {
        return {
          ...asset,
          decimals: 6,
          icon: 'https://assets.coingecko.com/coins/images/975/large/cardano.png',
        }
      }

      return this.assetsService.resolveTicker(
        await this.assetsService.resolveIconAndDecimals(asset)
      );
    }));
    request.cb(response);
  }

}
