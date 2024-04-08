/* eslint-disable prettier/prettier */
import { AbstractMessageHandler } from "../core/AbstractMessageHandler";
import { MessageRequestInterface } from "../core/MessageRequestInterface";
import { autoInjectable, singleton } from "tsyringe";
import { ArweaveService } from "../../services/arweave.service";
import { config } from "../../config";

export interface IPFSIconMessageRequest extends MessageRequestInterface {
  params: {
    url: string | string[],
  }
}

@singleton()
@autoInjectable()
export class NFTMediaHandler extends AbstractMessageHandler {

  constructor(
    private arweaveService: ArweaveService
  ) {
    super();
  }

  public async handle(request: IPFSIconMessageRequest) {
    const url = this.getNFTUrl(request.params.url);
    if (url.startsWith("ar://")) {
      const response = await this.arweaveService.getInfo(url);
      request.cb(response);
    } else if (url.startsWith("ipfs://")) {
      const baseUrl = config.baseUrl;
      const paths = url.split('//');
      request.cb(`${baseUrl}/ipfs/${paths[1]}`);
    } else if (url.startsWith("http")) {
      request.cb(url);
    } else {
      const baseUrl = config.baseUrl;
      request.cb(`${baseUrl}/ipfs/${url}`);
    }
  }

  private getNFTUrl(url: string | string[]) {
    if (Array.isArray(url)) {
      return url.join('');
    }
    return url;
  }

}
