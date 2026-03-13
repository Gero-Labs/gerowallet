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
  async resolve(handle: string) {
    return axiosInstance.get(`/api/assets/handle`, { params: { handle } });
  }
}
