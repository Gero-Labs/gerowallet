import axios from 'axios';

const axiosInstance = axios.create({
  baseURL: import.meta.env['VITE_BACKEND_URL'],
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  },
});

export default {
  async assetRisk(fingerprint: string): Promise<any> {
    if (fingerprint === 'asset12ffdj8kk2w485sr7a5ekmjjdyecz8ps2cm5zed') {
      throw new Error('Asset not found')
    }
    return await axiosInstance.get(`/api/risk/score/asset?fingerprint=${fingerprint}`);
  }
}
