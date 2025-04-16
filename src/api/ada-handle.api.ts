import axios from 'axios';

const axiosInstance = axios.create({
  baseURL: import.meta.env['VITE_ADA_HANDLE_BASE_URL'],
  timeout: 120000,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  },
});

export default {
  async resolve(handle: string) {
    return await axiosInstance.get(`/handles/${handle}`);
  }
}
