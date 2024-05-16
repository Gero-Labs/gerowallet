import { RewardAddress, StakeCredential } from '@emurgo/cardano-serialization-lib-browser';

export const buildRewardAddress = (networkId, stakeKeyHash) => {
  return RewardAddress.new(networkId, StakeCredential.from_keyhash(stakeKeyHash));
};
