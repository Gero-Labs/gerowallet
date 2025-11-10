import { createHttpClient } from '@/api/httpClient';

const axiosInstance = createHttpClient();

export default {
  async getBlogPosts(pageSize: number, nextPage?: string): Promise<any> {
    let url = `/api/blog/posts?paging.limit=${pageSize}`
    if (nextPage) {
      url += `&paging.cursor=${nextPage}`
    }
    return axiosInstance.get(url);
  },
  async getPostMetrics(postId: string): Promise<any> {
    return axiosInstance.get(`/api/blog/posts/${postId}/metrics`);
  }
}
