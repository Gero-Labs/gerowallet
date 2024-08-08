import axios, {AxiosError, AxiosInstance} from 'axios';
import { parseHttpError } from '@/shared/utils/parser';
import { resolveRewardAddress } from '@/shared/utils/resolver';
import {Blockchain, Network, Proof, Provider} from '@/models/types';
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
      if (error.response?.status === 404) {
        return []
      }
      throw parseHttpError(error);
    }
  }

  async getAssetsInfo(units) {
    try {
      const { data, status } = await this.axiosInstance.post(
        `/api/assets/info?chain=${this.chain}&network=${this.network}&provider=${this.provider}`,
        units
      );
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async getDetailedAssetsInfo(policyId: string, assetName: string) {
    try {
      const { data, status } = await this.axiosInstance.get(`/api/assets/detailedInfo?chain=${this.chain}&network=${this.network}&policyId=${policyId}&assetName=${assetName}`);
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

  async submitTx(body: string): Promise<any> {
    try {
      const { data, status } = await this.axiosInstance.post(`/api/transactions/submit-tx?chain=${this.chain}&network=${this.network}&provider=${this.provider}`, body);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async getBankAccountId(userId: number): Promise<number> {
    try {
      const { data, status } = await this.axiosInstance.get(`/api/zk-snark/accountId/${userId}`);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async verifyProof(proof: Proof, publicSignals: string[]): Promise<boolean> {
    try {
      const response = await this.axiosInstance.post("api/zk-snark/verify-proof", {
        proof,
        publicSignals
      });
      return response.data;
    } catch (error) {
      console.error('Error verifying proof:', error);
      return false;
    }
  }

  async checkAvailability(): Promise<boolean> {
    try {
      const { data, status } = await this.axiosInstance.get("/api/bring/check-availability?country=us"); //TODO
      if (status === 200) return data?.isAvailable;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async categories(): Promise<any> {
    try {
      const { data, status } = await this.axiosInstance.get("/api/bring/categories");
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async searchTerms(): Promise<any> {
    try {
      const { data, status } = await this.axiosInstance.get("/api/bring/search-terms");
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async retailers(category?: number, search?: string): Promise<any> {
    try {
      const requestBody = {
        type: 'all',
        country: "us", //TODO
        page: 0,
        pageSize: 250
      }
      if (category) {
        requestBody['category'] = category
      } else if (search) {
        requestBody['search'] = search
      }
      const { data, status } = await this.axiosInstance.post(`/api/bring/retailers`, requestBody);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }
}
