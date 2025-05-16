import axios, { AxiosError, AxiosInstance } from 'axios';
import { parseHttpError } from '@/shared/utils/parser';
import { Blockchain, Network, Proof, Provider } from '@/models/types';

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
      baseURL: import.meta.env['VITE_BACKEND_URL'],
      timeout: 120000,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  async sync(from: number, to: any, address: string, rewards_sum: string, controlled_amount: string, withdrawable_amount: string): Promise<any> {
    try {
      const { data, status } = await this.axiosInstance.post(
        `/api/sync`, {
        chain: this.chain,
        network: this.network,
        provider: this.provider,
        from,
        to,
        address,
        rewards_sum,
        controlled_amount,
        withdrawable_amount
      }
      );
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async getAccountInfo(rewardAddress: string) {
    try {
      const { data, status } = await this.axiosInstance.get(
        `/api/account/info?chain=${this.chain}&network=${this.network}&provider=${this.provider}&stakeAddress=${rewardAddress}`
      );
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async getAccountRewards(rewardAddress: string) {
    try {
      const size = this.provider === Provider[Provider.BLOCKFROST] ? 100 : 1000;
      let page = 1;
      let allRewards: any[] = []; // Accumulator for all rewards
      let morePages = true; // Condition to control the loop

      while (morePages) {
        const { data, status } = await this.axiosInstance.get(
          `/api/account/rewards?chain=${this.chain}&network=${this.network}&provider=${this.provider}&stakeAddress=${rewardAddress}&page=${page}&size=${size}`
        );
        if (status === 200) {
          allRewards = allRewards.concat(data);

          // If the number of rewards returned is less than the page size, we've reached the last page
          if (data.length < size) {
            morePages = false; // No more pages to fetch
          } else {
            page++; // Otherwise, move to the next page
          }
        } else {
          throw parseHttpError(data);
        }
      }
      return allRewards;
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async getAccountTransactions(stakeAddress: string, fromBlockHeight: number) {
    try {
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

  async getAllDReps() {
    try {
      const { data, status } = await this.axiosInstance.get(
        `/api/dreps/all?chain=${this.chain}&network=${this.network}`
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
    return await this.axiosInstance.get(`/api/assets/detailedInfo?chain=${this.chain}&network=${this.network}&policyId=${policyId}&assetName=${assetName}`);
  }

  async getAssetNFTAddress(policyId: string, assetName: string): Promise<any> {
    try {
      const { data, status } = await this.axiosInstance.get(`/api/assets/NFTAddress?chain=${this.chain}&network=${this.network}&policyId=${policyId}&assetName=${assetName}`);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async getTip() {
    const { data, status } = await this.axiosInstance.get(
      `/api/blocks/latest?chain=${this.chain}&network=${this.network}&provider=${this.provider}`
    );
    if (status === 200) return data;
    return parseHttpError(data);
  }

  async getEpochParameters(epochNo: number): Promise<any> {
    return await this.axiosInstance.get(`/api/epoch_params?chain=${this.chain}&network=${this.network}&provider=${this.provider}&epoch_no=${epochNo}`);
  }

  async fetchTickerStatistics() {
    const { data, status } = await this.axiosInstance.get(`/api/price/ticker?chain=${this.chain}`);
    if (status === 200) return data;
    return parseHttpError(data);
  }

  async fetchFiatRates() {
    const { data, status } = await this.axiosInstance.get(`/api/price/fiatRates`);
    if (status === 200) return data;
    return parseHttpError(data);
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

  async submitTx(body: string): Promise<any> {
    const { data } = await this.axiosInstance.post(`/api/transactions/submit-tx?chain=${this.chain}&network=${this.network}&provider=BLOCKFROST`, body);
    return data
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

  async getAllBlacklistPolicies(): Promise<any> {
    return await this.axiosInstance.get(`/api/assets/blacklist`);
  }

  async getAllTokens(): Promise<any> {
    try {
      const { data, status } = await this.axiosInstance.get(`/api/v2/swap/tokens`);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async getAveragePrice(tokenIn: string, tokenOut: string): Promise<any> {
    try {
      const { data, status } = await this.axiosInstance.get(`/api/v2/swap/averagePrice/${tokenIn}/${tokenOut}`);
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
      const { data, status } = await this.axiosInstance.post(`/api/v2/swap/estimate`, requestBody);
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
      const { data, status } = await this.axiosInstance.post(`/api/v2/swap/reverseEstimate`, requestBody);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async swap(amount_in: number, buyer_address: string, token_in: string, token_out: string, slippage: number, referrer: string = 'DEXHUNTER'): Promise<any> {
    const requestBody = {
      amount_in,
      buyer_address,
      slippage,
      token_in,
      token_out,
      referrer,
    }
    const { data } = await this.axiosInstance.post(`/api/v2/swap`, requestBody);
    return data
  }

  async swapSign(Signatures: number, txCbor: string): Promise<any> {
    const requestBody = {
      Signatures,
      txCbor,
    }
    const { data } = await this.axiosInstance.post(`/api/v2/swap/sign`, requestBody);
    return data
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
      const { data, status } = await this.axiosInstance.post(`/api/v2/charts`, requestBody);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async mcap(unit: string): Promise<any> {
    return await this.axiosInstance.get(`/api/v2/mcap/${unit}`);
  }

  async dailyPriceChange(unit: string): Promise<any> {
    try {
      const { data, status } = await this.axiosInstance.get(`/api/token/prices/chg?unit=${unit}`);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async assetRisk(fingerprint: string): Promise<any> {
    const { data, status } = await this.axiosInstance.get(`/api/risk/score/asset?fingerprint=${fingerprint}`);
    if (status === 200) return data;
    return parseHttpError(data);
  }

  async getBlogPosts(pageSize: number, nextPage?: string): Promise<any> {
    try {
      let url = `/api/blog/posts?paging.limit=${pageSize}`
      if (nextPage) {
        url += `&paging.cursor=${nextPage}`
      }
      const { data, status } = await this.axiosInstance.get(url);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async getMember(memberId: string): Promise<any> {
    try {
      const { data, status } = await this.axiosInstance.get(`/api/members/${memberId}`);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async getPostMetrics(postId: string): Promise<any> {
    try {
      const { data, status } = await this.axiosInstance.get(`/api/blog/posts/${postId}/metrics`);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async getPortfolio(stakeAddress: string): Promise<any> {
    return await this.axiosInstance.get(`/api/wallet/portfolio/positions?address=${stakeAddress}`);
  }

  async getPortfolioTrendedValue(stakeAddress: string): Promise<any> {
    try {
      const { data, status } = await this.axiosInstance.get(`/api/wallet/value/trended?address=${stakeAddress}&timeframe=1y&quote=USD`);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  multiSig = {
    /**
     * Create a multisig wallet
     * @param multisig - The multisig wallet to create
     * @param parentWalletAddress - The address of the parent wallet
     * @returns The created multisig wallet or throws an error on failure
     */
    async createWallet(multisig: any, parentWalletAddress: string) {
      try {
        const { data, status } = await super.axiosInstance.post(
          `/api/multisig/add`,
          {
            multisig,
            parentWalletAddress
          }
        );
        console.log("data::::", data);
        console.log("status:::", status);
        if (status === 200) return data;
        throw parseHttpError(data);
      } catch (error: any | AxiosError) {
        if (error.response?.status === 404) {
          return []
        }
        console.log("FAILED:::");
        throw parseHttpError(error);
      }
    },

    /**
     * Submit a transaction
     * @param body - The body of the transaction to submit
     * @returns The submitted transaction or throws an error on failure
     */
    async submitTx(body: string): Promise<any> {
      try {
        const provider = super.provider ?? 'BLOCKFROST';
        const { data } = await super.axiosInstance.post(
          `/api/transactions/submit-tx?chain=${super.chain}&network=${super.network}&provider=${provider}`,
          body
        );
        return data;
      } catch (error) {
        throw parseHttpError(error);
      }
    },

    transactions: {
      // this would called as Wallet.api.multisig.transactions.create()
      /**
       * Create a transaction
       * @param body - The body of the transaction to create
       * body example:
       * {
            "txnId": "{txnId}",
            "multisigAddress": "{multisigAddress}",
            "txnCBOR": "{txnCBOR}",
            "requiredSignatures": {requiredSignatures}
        }
       * @returns The created transaction or throws an error on failure
       */
      async create(body: string): Promise<any> {
        try {
          const { data } = await super.axiosInstance.post(
            `/api/multisig/transactions`,
            body
          );
          return data;
        } catch (error) {
          throw parseHttpError(error);
        }
      },

      /**
       * Get a transaction by ID
       * @param id - The ID of the transaction to get
       * @returns The transaction or throws an error on failure
       */
      async getByID(id: string): Promise<any> {
        try {
          const { data } = await super.axiosInstance.get(`/api/multisig/transactions/${id}`);
          return data;
        } catch (error) {
          throw parseHttpError(error);
        }
      },

      /**
       * Get all transactions by wallet address
       * @param walletAddress - The address of the wallet to get the transactions for
       * @returns The transactions or throws an error on failure
       */
      async getByWallet(walletAddress: string): Promise<any> {
        try {
          const { data } = await super.axiosInstance.get(`/api/multisig/address/${walletAddress}/transactions`);
          return data;
        } catch (error) {
          throw parseHttpError(error);
        }
      },

      /**
       * Update a transaction by ID
       * @param id - The ID of the transaction to update
       * @param body - The body of the transaction to update 
       * body example:
       * {
            "multisigAddress": "{multisigAddress}",
            "txnCBOR": "{txnCBOR}",
            "requiredSignatures": 2
        }
       * @returns The updated transaction
       */

      async update(id: string, body: string): Promise<any> {
        try {
          const { data } = await super.axiosInstance.put(`/api/multisig/transactions/${id}`, body);
          return data;
        } catch (error) {
          throw parseHttpError(error);
        }
      },

      /**
       * Delete a transaction by ID
       * @param id - The ID of the transaction to delete
       * @returns The deleted transaction
       */
      async delete(id: string): Promise<any> {
        try {
          const { data } = await super.axiosInstance.delete(`/api/multisig/transactions/${id}`);
          return data;
        } catch (error) {
          throw parseHttpError(error);
        }
      },

      /**
       * Get the signers of a transaction
       * @param transactionId - The ID of the transaction to get the signers for
       * @returns The signers or throws an error on failure
       */
      async getSigners(transactionId: string): Promise<any> {
        try {
          const { data } = await super.axiosInstance.get(`/api/multisig/transactions/${transactionId}/signers`);
          return data;
        } catch (error) {
          throw parseHttpError(error);
        }
      },

      // TODO: Implement "Get Pending Signature Transactions"
      // TODO: Implement "Get Fully Signed Transactions"
    },

    signers: {
      /**
       * Add a signer or signers to a transaction
       * @param transactionId - The ID of the transaction to add the signer to
       * @param signerAddress - The address of the signer to add | array of addresses
       * @returns The updated transaction
       */
      async add(transactionId: string, signerAddress: string | string[]): Promise<any> {
        try {
          let data;

          if (Array.isArray(signerAddress)) {
            ({ data } = await super.axiosInstance.post(
              `/api/multisig/transactions/${transactionId}/signers`,
              signerAddress
            ));
          } else {
            ({ data } = await super.axiosInstance.post(
              `/api/multisig/transactions/${transactionId}/signers/${signerAddress}`
            ));
          }

          return data;
        } catch (error) {
          throw parseHttpError(error);
        }
      },

      /**
       * Record a signature for a signer
       * @param transactionId - The ID of the transaction to record the signature for
       * @param signerAddress - The address of the signer to record the signature for
       * @param signature - The signature to record
       * @returns The updated transaction
       */
      async recordSignature(transactionId: string, signerAddress: string, signature: string): Promise<any> {
        try {
          const { data } = await super.axiosInstance.post(
            `/api/multisig/transactions/${transactionId}/signers/${signerAddress}/signature`,
            { signature }
          );
          return data;
        } catch (error) {
          throw parseHttpError(error);
        }
      },

      /**
       * Get the transactions of a signer
       * @param signerAddress - The address of the signer to get the transactions for
       * @returns The transactions or throws an error on failure
       */
      async getTransactions(signerAddress: string): Promise<any> {
        try {
          const { data } = await super.axiosInstance.get(`/api/multisig/signers/${signerAddress}/transactions`);
          return data;
        } catch (error) {
          throw parseHttpError(error);
        }
      },


    },
  }
}
