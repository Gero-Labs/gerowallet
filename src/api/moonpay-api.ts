import { parseHttpError } from '@/shared/utils/parser';
import { createHttpClient } from '@/api/httpClient';

const axiosInstance = createHttpClient();

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
      return parseHttpError(error);
    }
  }
}
