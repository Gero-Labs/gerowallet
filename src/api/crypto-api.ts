import { parseHttpError } from '@/shared/utils/parser';
import { createHttpClient } from '@/api/httpClient';

const axiosInstance = createHttpClient();

export default {
  async fetchHistory() {
    const { data, status } = await axiosInstance.get(`/crypto/history/ADAUSDT`);
    if (status === 200) {
      const chart = [];
      for (let i = 0; i < data.length; i++) {
        chart.push(Number(data[i][4]));
      }
      return chart;
    }
    return parseHttpError(data);
  },
  async fetchReleases(page: number) {
    return axiosInstance.get(`/api/github/releases?page=${page}&size=10`);
  }
}
