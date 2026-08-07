import axios from 'axios';
import { parseHttpError } from '@/shared/utils/parser';
import { TxScanRequest, TxScanResponse } from '@/models/cardano-shield-types';

const axiosInstance = axios.create({
  baseURL: import.meta.env['VITE_BACKEND_URL'],
  // Shield is advisory (risk badges). Keep the timeout short so a slow/down
  // Shield fails fast to 'unknown' instead of spinning — it must never gate or
  // delay the connect/sign UX. Callers already treat failures as fail-open.
  timeout: 8000,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  },
});

export default {
  async scanUrl(url: string) {
    try {
      const { data, status } = await axiosInstance.get(`/api/url/scan?url=${url}`);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  },
  async scanTx(txScanRequest: TxScanRequest): Promise<TxScanResponse> {
    try {
      const { data, status } = await axiosInstance.post(`/api/tx/scan`, txScanRequest);
      if (status === 200) return data;
      throw parseHttpError(data);
    } catch (error) {
      throw parseHttpError(error);
    }
  },
  async submitReport(formData: FormData): Promise<void> {
    const { data } = await axiosInstance.post(`/api/report`, formData, {
      headers: {
        "Content-Type": "multipart/form-data"
      }
    });
    return data;
  }
}
