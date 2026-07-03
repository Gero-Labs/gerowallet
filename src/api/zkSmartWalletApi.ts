import axios from 'axios';
import { Cardano } from '@cardano-sdk/core';

const axiosInstance = axios.create({
  baseURL: import.meta.env['VITE_ZK_SMART_WALLET_API_URL'] || 'https://wallet-api.zkfold.io', // legacy zkFold hosted endpoint — unused, retained for reference
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    ...(import.meta.env['VITE_ZK_SMART_WALLET_API_KEY'] ? { 'api-key': import.meta.env['VITE_ZK_SMART_WALLET_API_KEY'] } : {}),
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
