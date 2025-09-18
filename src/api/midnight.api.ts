import axios from 'axios';

const axiosInstance = axios.create({
  baseURL: import.meta.env['VITE_BACKEND_URL'],
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  },
});

export default {
  async checkClaim(address: string) {
    return axiosInstance.get(`/api/claim/check/cardano/${address}`);
  },
}
