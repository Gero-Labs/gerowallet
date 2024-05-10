import axios from 'axios'

import {resolveRewardAddress} from "@/shared/utils/resolver";
import {parseHttpError} from "@/shared/utils/parser";
import {Blockchain, Network, Provider} from "@/models/types";
import {useStore} from "@/store";
export class Api {

    constructor(provider, address) {
        this.address = address
        this.chain =  Object.keys(Blockchain).find(key => Blockchain[key] === provider.chain)
        this.network = Object.keys(Network).find(key => Network[key] === provider.network)
        this.provider = Object.keys(Provider).find(key => Provider[key] === provider.name)
        this.axiosInstance = axios.create({
            baseURL: process.env.VUE_APP_BACKEND_URL,
            timeout: 60000,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
        })
    }

    async getAccountInfo() {
        try {
            const rewardAddress = this.address.startsWith('addr') ? resolveRewardAddress(this.address) : this.address;
            const {data, status} = await this.axiosInstance.get(`/api/account/info?chain=${this.chain}&network=${this.network}&provider=${this.provider}&stakeAddress=${rewardAddress}`, {
                _stake_addresses: [rewardAddress],
            });
            if (status === 200)
                return data
            throw parseHttpError(data);
        } catch (error) {
            throw parseHttpError(error);
        }
    }
    async getTip() {
        try {
            const {data, status} = await this.axiosInstance.get(`/api/blocks/latest?chain=${this.chain}&network=${this.network}&provider=${this.provider}`);
            if (status === 200) {
                return data
            }
            throw parseHttpError(data);
        } catch (error) {
            throw parseHttpError(error);
        }
    }
    async fetchHistory() {
        try {
            const {data, status} = await this.axiosInstance.get(`/crypto/history/ADAUSDT`);
            if (status === 200) {
                let chart = []
                for (let i = 0 ; i<data.length ; i++) {
                    chart.push(Number(data[i][4]))
                }
                return chart
            }
            throw parseHttpError(data);
        } catch (error) {
            throw parseHttpError(error);
        }
    }

    async fetchExchangeRate() {
        try {
            const {data, status} = await this.axiosInstance.get('https://openexchangerates.org/api/latest.json?app_id=dbffdd0541a3481e93b8f5cd0b0ee214');
            if (status === 200) {
                return data.rates.ILS;
            }
            throw parseHttpError(data);
        } catch (error) {
            throw parseHttpError(error);
        }
    }

    async fetchADAStatistics() {
        try {
            const {data, status} = await this.axiosInstance.get('/crypto/ticker/ADAUSDT');
            if (status === 200) {
                return data
            }
            throw parseHttpError(data);
        } catch (error) {
            throw parseHttpError(error);
        }
    }
}