import { toAddress, toBaseAddress } from '@/shared/utils/converter';
import { buildRewardAddress } from '@/shared/utils/builder';
import {Address, BaseAddress, Ed25519KeyHash} from "@emurgo/cardano-serialization-lib-browser";

export const resolveRewardAddress = (bech32: string) => {
  try {
    const address: Address = toAddress(bech32);
    const baseAddress: BaseAddress = toBaseAddress(bech32);
    const stakeKeyHash: Ed25519KeyHash = baseAddress?.stake_cred().to_keyhash();

    if (stakeKeyHash) return buildRewardAddress(address.network_id(), stakeKeyHash).to_address().to_bech32();

    throw new Error(`Couldn't resolve reward address from address: ${bech32}`);
  } catch (error) {
    throw new Error(`An error occurred during resolveRewardAddress: ${error}.`);
  }
};
