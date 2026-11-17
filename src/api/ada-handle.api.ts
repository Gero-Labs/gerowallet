import axios from 'axios';
import { installSignedResponses } from './signedResponses';

const axiosInstance = axios.create({
  baseURL: import.meta.env['VITE_BACKEND_URL'],
  timeout: 120000,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  },
});
installSignedResponses(axiosInstance, 'gero-backend');

export default {
  async resolve(handle: string) {
    return axiosInstance.get(`/api/assets/handle`, { params: { handle } });
  }
}
