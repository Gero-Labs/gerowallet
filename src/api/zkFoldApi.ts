import axios from 'axios';
import { Cardano } from '@cardano-sdk/core';

const axiosInstance = axios.create({
  baseURL: 'https://wallet-api.zkfold.io',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'api-key': '123456'
  },
});

/**
 * Return wallet's address by email. The wallet can be not initialized, i.e.,
 * this function will return the address for any email.
 *
 * @async
 * @param {string} email
 * @returns {Cardano.Address}
 */
export default {
  async walletAddress(email: string): Promise<Cardano.Address> {
    const { data } = await axiosInstance.post(`/v0/wallet/address`, {
      'email': email
    });

    return Cardano.Address.fromBech32(data.address)
  }
}
