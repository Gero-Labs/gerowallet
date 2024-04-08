import { MessageRequestInterface } from '../core/MessageRequestInterface';
import { autoInjectable, singleton } from 'tsyringe';
import { AbstractMessageHandler } from '../core/AbstractMessageHandler';
import { BlockFrostService } from '../../api/blockfrost.service';
import { HandleApiService } from '../../api/handle-api.service';

export interface UpdateTransactionsMessageRequest extends MessageRequestInterface {
  params: {
    policyId: string;
    handleName: string;
  };
}


@singleton()
@autoInjectable()
export class GetHandleAddressHandler extends AbstractMessageHandler {
  constructor(
    private blockFrostService?: BlockFrostService,
    private handleApiService?: HandleApiService
  ) {
    super();
  }

  async handle(request: UpdateTransactionsMessageRequest) {
    const handle = request.params.handleName.slice(1, Infinity);
    const policyId = request.params.policyId;

    let address: string;

    address = await this.resolveCIP68HandleAddress(handle);

    if (address) {
      request.cb(address);
      return;
    }

    address = await this.resolveClassicHandleAddress(handle, policyId);

    if (address) {
      request.cb(address);
      return;
    }

    request.cb(undefined);
  }

  private async resolveCIP68HandleAddress(handle: string): Promise<string | undefined> {
    const res = await this.handleApiService.getHandle(handle);

    return res ? res.resolved_addresses.ada : undefined;
  }

  private async resolveClassicHandleAddress(handle: string, policyId: string): Promise<string | undefined> {
    const hex = Buffer.from(handle).toString('hex');
    const res = await this.blockFrostService.getAssetAddress(`${policyId}${hex}`);

    return res ? res[0]?.address : undefined;
  }
}
