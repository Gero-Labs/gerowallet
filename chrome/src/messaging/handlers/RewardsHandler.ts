import {AbstractMessageHandler} from "../core/AbstractMessageHandler";
import {MessageRequestInterface} from "../core/MessageRequestInterface";
import { GERO_CARDANO_SERVER } from "../../constants";
import { NextReward, StakingRewards } from "../../shared/types";

export interface RewardsRequest extends MessageRequestInterface {
  params: {
      rewardAddress: string;
  }
}

export class RewardsHandler extends AbstractMessageHandler {
  async getRewards(rewardAddress: string): Promise<StakingRewards> {
    const result = await fetch(`${GERO_CARDANO_SERVER}/rewards/${rewardAddress}`, {
      method: 'GET',
    }).catch((error) => {
        throw new Error(`some error for getRewards: ${error}`);
    });

    return result?.json().then((stakingRewards: StakingRewards) => {
      const rewardsHistory = stakingRewards.rewardsHistory && stakingRewards.rewardsHistory.length > 0 ?
        stakingRewards.rewardsHistory.filter(rewards => {
          if (rewards.reward_date) {
            return new Date(rewards.reward_date).getTime() < new Date().getTime();
          }
          return true;
        }).reverse(): [];
      const nextRewards: NextReward[] = stakingRewards.rewardsHistory && stakingRewards.rewardsHistory.length > 0 ?
      stakingRewards.rewardsHistory.filter(rewards => {
        if (rewards.reward_date) {
          return new Date(rewards.reward_date).getTime() >= new Date().getTime();
        }
        return false;
      }).map(history => ({
        epochNo: +history.spendable_epoch,
        poolId: history.pool_id,
        rewardDate: history.reward_date,
      })).reverse() : [];
      return {
        nextRewards,
        rewardsHistory,
      };
    });
  }

  public async handle(request: RewardsRequest) {
    const rewards = await this.getRewards(request.params.rewardAddress);
    request.cb(rewards);
  }
}
