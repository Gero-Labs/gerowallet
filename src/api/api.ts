import axios, { AxiosInstance } from 'axios';
import { parseHttpError } from '@/shared/utils/parser';
import { Blockchain, Network, Provider } from '@/models/types';

export class Api {
  public chain: string;
  public network: string;
  public provider: string;
  public axiosInstance: AxiosInstance;

  constructor(wallet, provider: Provider) {
    this.chain = Object.keys(Blockchain).find(key => Blockchain[key] === wallet?.chain);
    this.network = Object.keys(Network).find(key => Network[key] === wallet?.network);
    this.provider = Provider[provider];
    this.axiosInstance = axios.create({
      baseURL: import.meta.env['VITE_BACKEND_URL'],
      timeout: 120000,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
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
      const size = 100;
      let page = 1;
      let allRewards: unknown[] = []; // Accumulator for all rewards
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
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return [];
      }
      throw parseHttpError(error);
    }
  }

  async getTransactionsCbor(txHashes: string[]) {
    return this.axiosInstance.post(
      `/api/transactions/cbor?chain=${this.chain}&network=${this.network}&provider=${this.provider}`,
      txHashes
    );
  }

  async getAssetsInfo(units: string[]) {
    const url: string = `/api/assets/info?chain=${this.chain}&network=${this.network}&provider=${this.provider}`;
    return this.axiosInstance.post(url, units);
  }

  async getDetailedAssetsInfo(policyId: string, assetName: string) {
    return this.axiosInstance.get(
      `/api/assets/detailedInfo?chain=${this.chain}&network=${this.network}&policyId=${policyId}&assetName=${assetName}`
    );
  }

  async getAssetNFTAddress(policyId: string, assetName: string): Promise<unknown> {
    try {
      const { data, status } = await this.axiosInstance.get(
        `/api/assets/NFTAddress?chain=${this.chain}&network=${this.network}&policyId=${policyId}&assetName=${assetName}`
      );
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  }

  async getTip() {
    const { data, status } = await this.axiosInstance.get(
      `/api/blocks/latest?chain=${this.chain}&network=${this.network}&provider=BLOCKFROST`
    );
    if (status === 200) return data;
    return parseHttpError(data);
  }

  async getGenesis() {
    return this.axiosInstance.get(
      `/api/genesis?chain=${this.chain}&network=${this.network}&provider=${this.provider}`
    );
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

  async submitTx(body: string): Promise<string> {
    // Preview submits via Nexus → ogmios (self-hosted node). The legacy backend has no
    // cardano-preview provider block, so its Blockfrost path times out. Mainnet/preprod
    // keep the existing Blockfrost-backed legacy path (already working).
    if (this.network === 'PREVIEW') {
      const { data } = await axios.post(
        `${import.meta.env['VITE_NEXUS_URL']}/api/transactions/submit?network=cardano-preview`,
        body,
        { headers: { 'Content-Type': 'text/plain' } }
      );
      return data;
    }
    const { data } = await this.axiosInstance.post(
      `/api/transactions/submit-tx?chain=${this.chain}&network=${this.network}&provider=BLOCKFROST`,
      body
    );
    return data;
  }

  mpc = {
    /** Store the login share after backend verifies the Google idToken (Plan B /enroll). */
    enroll: async (idToken: string, chain: string, network: string, loginShare: string): Promise<{ stored: boolean }> => {
      try {
        const { data, status } = await this.axiosInstance.post('/api/mpc/enroll',
          { idToken, chain, network, loginShare });
        if (status === 200) return data as { stored: boolean };
        throw parseHttpError(data);
      } catch (error) {
        throw parseHttpError(error);
      }
    },
    /** Retrieve the login share; backend verifies the Google idToken (Plan B /login-share). */
    getLoginShare: async (idToken: string, chain: string, network: string): Promise<string> => {
      try {
        const { data, status } = await this.axiosInstance.post('/api/mpc/login-share',
          { idToken, chain, network });
        if (status === 200) return (data as { loginShare: string }).loginShare;
        throw parseHttpError(data);
      } catch (error) {
        throw parseHttpError(error);
      }
    },
    /** Store the client-encrypted recovery blob (+ xpub anchor) after backend verifies the idToken. */
    storeRecovery: async (
      idToken: string, chain: string, network: string, encryptedRecovery: string, publicKey: string,
    ): Promise<{ stored: boolean }> => {
      try {
        const { data, status } = await this.axiosInstance.post('/api/mpc/recovery/store',
          { idToken, chain, network, encryptedRecovery, publicKey });
        if (status === 200) return data as { stored: boolean };
        throw parseHttpError(data);
      } catch (error) {
        throw parseHttpError(error);
      }
    },
    /** Fetch the client-encrypted recovery blob + xpub anchor; backend verifies the idToken. */
    fetchRecovery: async (
      idToken: string, chain: string, network: string,
    ): Promise<{ encryptedRecovery: string; publicKey: string }> => {
      try {
        const { data, status } = await this.axiosInstance.post('/api/mpc/recovery/fetch',
          { idToken, chain, network });
        if (status === 200) return data as { encryptedRecovery: string; publicKey: string };
        throw parseHttpError(data);
      } catch (error) {
        throw parseHttpError(error);
      }
    },
    /** Replace the login share (reset/re-split path); backend verifies the idToken. */
    rotate: async (
      idToken: string, chain: string, network: string, loginShare: string,
    ): Promise<{ rotated: boolean }> => {
      try {
        const { data, status } = await this.axiosInstance.post('/api/mpc/rotate',
          { idToken, chain, network, loginShare });
        if (status === 200) return data as { rotated: boolean };
        throw parseHttpError(data);
      } catch (error) {
        throw parseHttpError(error);
      }
    },
    /** Delete this Google account's login + recovery shares (onboarding "already
     *  enrolled" reset path); backend verifies the idToken. */
    deregister: async (
      idToken: string, chain: string, network: string,
    ): Promise<{ deregistered: boolean }> => {
      try {
        const { data, status } = await this.axiosInstance.post('/api/mpc/deregister',
          { idToken, chain, network });
        if (status === 200) return data as { deregistered: boolean };
        throw parseHttpError(data);
      } catch (error) {
        throw parseHttpError(error);
      }
    },
  };
}
