/* eslint-disable prettier/prettier */
import { AbstractMessageHandler } from "../core/AbstractMessageHandler";
import { MessageRequestInterface } from "../core/MessageRequestInterface";
import { autoInjectable, singleton } from "tsyringe";
import { AssetIconService } from "../../services/asset-icons.service";
import { CacheHandler, CacheType } from "./CacheHandler";
import { config } from "../../config";

export interface AssetsIconMessageRequest extends MessageRequestInterface {
  params: {
    asset: string;
    url: string;
  }
}

@singleton()
@autoInjectable()
export class AssetsIconHandler extends AbstractMessageHandler {

  constructor(
    private assetIconService: AssetIconService,
    private cache: CacheHandler,
  ) {
    super();
  }

  // depending if it's a url it downloads the image specified on the url, otherwise it returns the source of the image
  public async handle(request: AssetsIconMessageRequest) {
    const key = this.generateKey(request.params.asset.toLowerCase());
    const data = this.cache.get(key, CacheType.assetsIcons);
    if (data!== null) {
      request.cb(data);
    } else {
      if (request.params.asset === 'Cardano') {
        request.cb('https://assets.coingecko.com/coins/images/975/large/cardano.png');
      } else if (request.params.url === '') {
        this.assetIconService.getIcon(request.params.asset.toLowerCase()).then((url: string) => {
          this.cache.set(key, CacheType.assetsIcons, url? url : '');
          request.cb(url);
        }).catch(() => {
          this.cache.set(key, CacheType.assetsIcons, '');
          request.cb('');
        });
      } else if (request.params.url.startsWith("ipfs://")) {
        const baseUrl = config.baseUrl;
        const paths = request.params.url.split('//');
        request.cb(`${baseUrl}/ipfs/${paths[1]}`);
      } else {
        request.cb(request.params.url);
      }
    }
  }

  private generateKey = (asset: string): string => `${asset}`;
}
