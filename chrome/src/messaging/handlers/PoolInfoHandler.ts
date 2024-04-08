import {AbstractMessageHandler} from "../core/AbstractMessageHandler";
import {MessageRequestInterface} from "../core/MessageRequestInterface";
import { PoolInfoService } from "../../api/pool-info.service";
import { PoolSummary } from "../../models/pool-summary";
import { autoInjectable, singleton } from "tsyringe";
import { CacheHandler, CacheType } from "./CacheHandler";

export interface PoolInfoIdsMessageRequest extends MessageRequestInterface {
  params: {
    poolId: string;
  }
}

@singleton()
@autoInjectable()
export class PoolInfoHandler extends AbstractMessageHandler {
  constructor(
    private cache?: CacheHandler,
    private poolInfoService?: PoolInfoService
  ) {
    super();
  }

  public async handle(request: PoolInfoIdsMessageRequest) {
    const poolId = request.params.poolId;
    const poolInfoCache = this.cache.get(poolId, CacheType.poolInfo);
    if (!!poolInfoCache) {
      request.cb(poolInfoCache);
    } else {
      try {
        const poolMetadata = await this.poolInfoService.getPoolMetadata(request.params.poolId);
        this.cache.set(poolId, CacheType.poolInfo, poolMetadata);
        request.cb(poolMetadata);
      } catch (error) {
        request.cb(undefined);
      }
    }
  }
}
