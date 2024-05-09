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
                'Access-Control-Allow-Origin': '*',
                'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhZGRyIjoic3Rha2UxdXltd2t6MnpsbjQwMDU3NGR1cjdkcnhmcHB2amFxbWNhNnc5OGswcW1scjc0bmcyZjVxY2wiLCJleHAiOjE3MjYxNjkwNjksInRpZXIiOjEsInByb2pJRCI6Ikdlcm8gV2FsbGV0In0.4sbiXIWJjqsNgC1oqRn3u8_Mj0qkSq3ODCnxQMGE7jE'
            },
        })
    }

    async getAccountInfo(chain, network, address) {
        console.log('getAcc')
        try {
            const rewardAddress = address.startsWith('addr') ? resolveRewardAddress(address) : address;
            const {data, status} = await this.axiosInstance.post('account_info', {
                _stake_addresses: [rewardAddress],
            });
            if (status === 200)
                return data
            throw parseHttpError(data);
        } catch (error) {
            throw parseHttpError(error);
        }
    }
    async getTip(chain, network) {
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