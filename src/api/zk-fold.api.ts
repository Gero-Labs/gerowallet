import { createHttpClient } from '@/api/httpClient';

const axiosInstance = createHttpClient();

export default {
  async walletAddress(gmail: string) {
    return axiosInstance.get(`/api/zkfold/walletAddress/${encodeURIComponent(gmail)}`);
  }
}
