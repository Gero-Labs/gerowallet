import axios from 'axios';

const axiosInstance = axios.create({
  baseURL: import.meta.env['VITE_BACKEND_URL'],
  timeout: 120000,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  },
});

export default {
  async walletAddress(gmail: string) {
    return axiosInstance.get(`/api/zkfold/walletAddress/${encodeURIComponent(gmail)}`);
  }
}
