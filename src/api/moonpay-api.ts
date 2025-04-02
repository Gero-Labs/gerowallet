import axios from 'axios';
import { parseHttpError } from '@/shared/utils/parser';

const axiosInstance = axios.create({
  baseURL: import.meta.env['VITE_BACKEND_URL'],
  timeout: 120000,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  },
});

export default {
  async moonPaySign(url: string): Promise<any> {
    try {
      const { data, status } = await axiosInstance.post(`/api/moonpay/sign`, url, {
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (status === 200) return data;
      return parseHttpError(data);
    } catch (error) {
      console.log(error)
      return parseHttpError(error);
    }
  }
}
