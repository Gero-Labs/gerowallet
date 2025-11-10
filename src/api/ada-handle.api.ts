import { createHttpClient } from '@/api/httpClient';

const axiosInstance = createHttpClient({
  baseURL: import.meta.env['VITE_ADA_HANDLE_BASE_URL'],
});

export default {
  async resolve(handle: string) {
    return axiosInstance.get(`/handles/${handle}`);
  }
}
