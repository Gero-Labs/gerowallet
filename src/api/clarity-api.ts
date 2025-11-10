import { createHttpClient } from '@/api/httpClient';

const axiosInstance = createHttpClient();

export default {
  async getDaoDetails(address: string) {
    return axiosInstance.get(`/api/clarity/account-info?address=${address}`);
  },
  async getDaoMembers() {
    return axiosInstance.get(`/api/clarity/dao/members`);
  },
  async getGeroDetails() {
    return axiosInstance.get(`/api/clarity/dao/details`);
  },
};
