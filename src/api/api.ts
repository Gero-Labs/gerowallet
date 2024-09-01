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

  constructor(wallet, provider: Provider) {
    this.chain = Object.keys(Blockchain).find(key => Blockchain[key] === wallet.chain);
    this.network = Object.keys(Network).find(key => Network[key] === wallet.network);
    this.provider = Provider[provider]
    this.axiosInstance = axios.create({
      baseURL: process.env['VUE_APP_BACKEND_URL'],
      timeout: 120000,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  async sync(fromBlockHeight, address: string, prevAccountInfo: any) {
    try {
      const rewardAddress = address.startsWith('addr') ? resolveRewardAddress(address) : address;
      const { data, status } = await this.axiosInstance.get(
        `/api/sync?chain=${this.chain}&network=${this.network}&provider=${this.provider}&from=${fromBlockHeight}&address=${rewardAddress}&rewards_sum=${prevAccountInfo.rewards_sum}&controlled_amount=${prevAccountInfo.controlled_amount}`
      );
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
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

  async retailers(category: number, search?: string, page?: number): Promise<any> {
    try {
      const requestBody = {
        type: 'all',
        category: category,
        country: "us", //TODO
        page: page ? page : 0,
        pageSize: 28
      }
      if (search) {
        requestBody['search'] = search
      }
      const { data, status } = await this.axiosInstance.post(`/api/bring/retailers`, requestBody);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async cache(walletAddress: string): Promise<any> {
    try {
      const requestBody = {
        walletAddress,
      }
      const { data, status } = await this.axiosInstance.post(`/api/bring/cache`, requestBody);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async activate(itemId: string, walletAddress: string, tokenSymbol: string, search: string): Promise<any> {
    try {
      const requestBody = {
        itemId,
        walletAddress,
        tokenSymbol,
        search
      }
      const { data, status } = await this.axiosInstance.post(`/api/bring/activate`, requestBody);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async claimInit(walletAddress: string, targetWalletAddress: string, tokenSymbol: string, tokenAmount: number): Promise<any> {
    try {
      const requestBody = {
        walletAddress,
        targetWalletAddress,
        tokenSymbol,
        tokenAmount
      }
      const { data, status } = await this.axiosInstance.post(`/api/bring/claim-init`, requestBody);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async claimSubmit(walletAddress: string, targetWalletAddress: string, tokenSymbol: string, tokenAmount: number, message: string, signature: string, key: string): Promise<any> {
    try {
      const requestBody = {
        walletAddress,
        targetWalletAddress,
        tokenSymbol,
        tokenAmount,
        message,
        signature,
        key
      }
      const { data, status } = await this.axiosInstance.post(`/api/bring/claim-submit`, requestBody);
      if (status === 202) return status;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async getAllTokens(): Promise<any> {
    try {
      const { data, status } = await this.axiosInstance.get(`/api/swap/tokens`);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async moonPaySign(url: string): Promise<any> {
    try {
      const { data, status } = await this.axiosInstance.post(`/api/moonpay/sign`, url, {
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async getAveragePrice(tokenIn: string, tokenOut: string): Promise<any> {
    try {
      const { data, status } = await this.axiosInstance.get(`/api/swap/averagePrice/${tokenIn}/${tokenOut}`);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async estimate(amount_in: number, token_in: string, token_out: string, slippage: number, blacklisted_dexes: string[], referrer: string = 'DEXHUNTER'): Promise<any> {
    try {
      const requestBody = {
        amount_in,
        referrer,
        slippage,
        token_in,
        token_out,
        blacklisted_dexes,
      }
      const { data, status } = await this.axiosInstance.post(`/api/swap/estimate`, requestBody);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async reverseEstimate(amount_out: number, token_in: string, token_out: string, slippage: number, blacklisted_dexes: string[], referrer: string = 'DEXHUNTER'): Promise<any> {
    try {
      const requestBody = {
        amount_out,
        referrer,
        slippage,
        token_in,
        token_out,
        blacklisted_dexes
      }
      const { data, status } = await this.axiosInstance.post(`/api/swap/reverseEstimate`, requestBody);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async swap(amount_in: number, buyer_address: string, token_in: string, token_out: string, slippage: number, referrer: string = 'DEXHUNTER'): Promise<any> {
    try {
      const requestBody = {
        amount_in,
        buyer_address,
        slippage,
        token_in,
        token_out,
        referrer,
      }
      const { data, status } = await this.axiosInstance.post(`/api/swap`, requestBody);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async swapSign(Signatures: number, txCbor: string): Promise<any> {
    try {
      const requestBody = {
        Signatures,
        txCbor,
      }
      const { data, status } = await this.axiosInstance.post(`/api/swap/sign`, requestBody);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async charts(tokenIn: string, tokenOut: string, period: string, from: number, to: number): Promise<any> {
    try {
      const requestBody = {
        tokenIn,
        tokenOut,
        period,
        from,
        to,
      }
      const { data, status } = await this.axiosInstance.post(`/api/charts`, requestBody);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async mcap(unit: string): Promise<any> {
    try {
      const { data, status } = await this.axiosInstance.get(`/api/mcap/${unit}`);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async dailyPriceChange(tokenIn: string, tokenOut: string): Promise<any> {
    try {
      const { data, status } = await this.axiosInstance.get(`/api/stats/dailyPriceChange/${tokenIn}/${tokenOut}`);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async assetRisk(fingerprint: string): Promise<any> {
    try {
      const { data, status } = await this.axiosInstance.get(`/api/risk/score/asset?fingerprint=${fingerprint}`);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }
}
