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
  async getDaoDetails(address: string) {
    return axiosInstance.get(`/api/clarity/account-info?address=${address}`);
  },
  async getDaoMembers() {
    return axiosInstance.get(`/api/clarity/dao/members`);
  },
  async getGeroDetails() {
    return axiosInstance.get(`/api/clarity/dao/details`);
  },
  // async getGeroGovernance() {
  //   return axiosInstance.get(`/api/clarity/dao/governance`);
  // },
  // async getGeroTreasury() {
  //   return axiosInstance.get(`/api/clarity/dao/treasury`);
  // },
};
