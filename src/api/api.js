import axios from 'axios'

import {resolveRewardAddress} from "@/shared/utils/resolver";
import {parseHttpError} from "@/shared/utils/parser";
export class Api {

    constructor(baseUrl) {
        this.axiosInstance = axios.create({
            baseURL: baseUrl,
            timeout: 60000,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
        })
    }

    async fetchAccountInfo(chain, network, address) {
        try {
            const rewardAddress = address.startsWith('addr') ? resolveRewardAddress(address) : address;
            const {data, status} = await this.axiosInstance.post('account_info', {
                _stake_addresses: [rewardAddress],
            });
            if (status === 200)
                return {
                    poolId: data[0].delegated_pool,
                    active: data[0].status === 'registered',
                    balance: data[0].total_balance.toString(),
                    rewards: data[0].rewards_available,
                    withdrawals: data[0].withdrawals,
                };
            throw parseHttpError(data);
        } catch (error) {
            throw parseHttpError(error);
        }
    }
    async getTip() {
        try {
            const {data, status} = await this.axiosInstance.get('tip');
            if (status === 200)
                return data;
            throw parseHttpError(data);
        } catch (error) {
            throw parseHttpError(error);
        }
    }
}