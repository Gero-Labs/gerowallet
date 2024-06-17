import axios, {AxiosError, AxiosInstance} from 'axios';
import { parseHttpError } from '@/shared/utils/parser';
import { resolveRewardAddress } from '@/shared/utils/resolver';
import { Blockchain, Network, Provider } from '@/models/types';
import { TxScanRequest, TxScanResponse } from '@/models/tx-scan';

export class Api {
  public chain: string;
  public network: string;
  public provider: string;
  public axiosInstance: AxiosInstance;

  constructor(provider) {
    this.chain = Object.keys(Blockchain).find(key => Blockchain[key] === provider.chain);
    this.network = Object.keys(Network).find(key => Network[key] === provider.network);
    this.provider = Object.keys(Provider).find(key => Provider[key] === provider.name);
    this.axiosInstance = axios.create({
      baseURL: process.env['VUE_APP_BACKEND_URL'],
      timeout: 120000,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  async getAccountInfo(address: string) {
    try {
      const rewardAddress = address.startsWith('addr') ? resolveRewardAddress(address) : address;
      const { data, status } = await this.axiosInstance.get(
        `/api/account/info?chain=${this.chain}&network=${this.network}&provider=${this.provider}&stakeAddress=${rewardAddress}`
      );
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async getAccountRewards(address: string, page: number = 1, size: number = 10000) {
    try {
      const rewardAddress = address.startsWith('addr') ? resolveRewardAddress(address) : address;
      const { data, status } = await this.axiosInstance.get(
        `/api/account/rewards?chain=${this.chain}&network=${this.network}&provider=${this.provider}&stakeAddress=${rewardAddress}&page=${page}&size=${size}`
      );
      if (status === 200) return data
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async getAccountAddresses(address: string) {
    try {
      const rewardAddress = address.startsWith('addr') ? resolveRewardAddress(address) : address;
      const { data, status } = await this.axiosInstance.get(
        `/api/account/addresses?chain=${this.chain}&network=${this.network}&provider=${this.provider}&stakeAddress=${rewardAddress}`
      );
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async getAccountTransactions(address: string, fromBlockHeight: number) {
    try {
      const stakeAddress = address.startsWith('addr') ? resolveRewardAddress(address) : address;
      const { data, status } = await this.axiosInstance.get(
        `/api/account/txs?chain=${this.chain}&network=${this.network}&provider=${this.provider}&stakeAddress=${stakeAddress}&from=${fromBlockHeight}`
      );
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error: any | AxiosError) {
      if (error.response?.status === 404) {
        return []
      }
      throw parseHttpError(error);
    }
  }

  async getTransactionsInfo(txHashes: string[]) {
    try {
      const { data, status } = await this.axiosInstance.post(`/api/transactions/info?chain=${this.chain}&network=${this.network}`, txHashes);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error: any | AxiosError) {
      console.log(error)
      if (error.response?.status === 404) {
        return []
      }
      throw parseHttpError(error);
    }
  }

  async getAllPools() {
    try {
      const { data, status } = await this.axiosInstance.get(
        `/api/pools/all?chain=${this.chain}&network=${this.network}`
      );
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error: any | AxiosError) {
      console.log(error)
      if (error.response?.status === 404) {
        return []
      }
      throw parseHttpError(error);
    }
  }

  async getTransactionUtxos(txHash: string) {
    try {
      const { data, status } = await this.axiosInstance.get(
        `/api/transactions/utxos?chain=${this.chain}&network=${this.network}&provider=${this.provider}&txHash=${txHash}`
      );
      if (status === 200) return {id: txHash, data: data};
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async getAddressTransactions(address: string, fromBlockHeight: number) {
    try {
      const { data, status } = await this.axiosInstance.get(`/api/address/txs?chain=${this.chain}&network=${this.network}&provider=${this.provider}&address=${address}&from=${fromBlockHeight}`);
      if (status === 200)
        return data
      if (status === 404) {
        return null
      }
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async getAssetsInfo(units) {
    try {
      const { data, status } = await this.axiosInstance.post(
        `/api/assets/info?chain=${this.chain}&network=${this.network}&provider=${this.provider}`,
        units
      );
      console.log(data)
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async getAssetInfo(unit: string) {
    try {
      const { data, status } = await this.axiosInstance.get(
        `/api/assets/info?chain=${this.chain}&network=${this.network}&provider=${this.provider}&unit=${unit}`
      );
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async getTip() {
    try {
      const { data, status } = await this.axiosInstance.get(
        `/api/blocks/latest?chain=${this.chain}&network=${this.network}&provider=${this.provider}`
      );
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async fetchHistory() {
    try {
      const { data, status } = await this.axiosInstance.get(`/crypto/history/ADAUSDT`);
      if (status === 200) {
        const chart = [];
        for (let i = 0; i < data.length; i++) {
          chart.push(Number(data[i][4]));
        }
        return chart;
      }
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async fetchADAStatistics() {
    try {
      const { data, status } = await this.axiosInstance.get('/crypto/ticker/ADAUSDT');
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async scanUrl(url: string) {
    try {
      const { data, status } = await this.axiosInstance.get(`/api/url/scan?url=${url}`);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async scanTx(txScanRequest: TxScanRequest): Promise<TxScanResponse> {
    try {
      const { data, status } = await this.axiosInstance.post(`/api/tx/scan`, txScanRequest);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }
}
