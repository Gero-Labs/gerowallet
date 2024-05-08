import {toAddress, toBaseAddress} from "@/shared/utils/converter";
import {buildRewardAddress} from "@/shared/utils/builder";

export const resolveRewardAddress = (bech32) => {
    try {
        const address = toAddress(bech32)
        const baseAddress = toBaseAddress(bech32)
        const stakeKeyHash = baseAddress?.stake_cred().to_keyhash();

        if (stakeKeyHash !== undefined)
            return buildRewardAddress(address.network_id(), stakeKeyHash)
                .to_address().to_bech32();

        throw new Error(`Couldn't resolve reward address from address: ${bech32}`);
    } catch (error) {
        throw new Error(`An error occurred during resolveRewardAddress: ${error}.`);
    }
};