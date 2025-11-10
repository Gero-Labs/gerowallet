import { createHttpClient } from '@/api/httpClient';

const axiosInstance = createHttpClient({ timeout: 10000 });

export default {
  async assetRisk(fingerprint: string): Promise<any> {
    if (fingerprint === 'asset12ffdj8kk2w485sr7a5ekmjjdyecz8ps2cm5zed') {
      throw new Error('Asset not found')
    }
    return axiosInstance.get(`/api/risk/score/asset?fingerprint=${fingerprint}`);
  }
}
