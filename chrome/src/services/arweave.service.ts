/* eslint-disable prettier/prettier */
import { autoInjectable, singleton } from 'tsyringe';
import { CacheHandler, CacheType } from '../messaging/handlers';
import { FileUtils } from '../shared/file-utils';

@singleton()
@autoInjectable()
export class ArweaveService {

  constructor(
    private cache: CacheHandler
  ) { }

  public async getInfo(path: string): Promise<string | ArrayBuffer> {
    const data = this.cache.get(path, CacheType.Arweave);
    if (data !== null) {
      return data;
    }
    const chunks = path.split('//');
    // used to prevent simultaneous requests
    let requestId: Blob = this.cache.get(path, CacheType.ArweaveRequest);

    if (!requestId) {
      requestId = await this.getFromArweave(chunks[1]);
      this.cache.set(path, CacheType.ArweaveRequest, requestId);
    }
    const base64 = await FileUtils.blobToBase64(await requestId);
    this.cache.set(path, CacheType.Arweave, base64);
    return base64;
  }

  private async getFromArweave(id: string) {
    const response = await fetch(`https://arweave.net/${id}`, {
      method: 'GET',
    })
    .then(res => res.blob())
    .catch(error => {
        throw new Error(`some error for fetchIPFSInfo: ${error}`);
    });

    return response;
  }
}
