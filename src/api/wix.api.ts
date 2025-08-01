import axios from 'axios';

const axiosInstance = axios.create({
  baseURL: import.meta.env['VITE_BACKEND_URL'],
  timeout: 120000,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  },
});

export default {
  async getBlogPosts(pageSize: number, nextPage?: string): Promise<any> {
    let url = `/api/blog/posts?paging.limit=${pageSize}`
    if (nextPage) {
      url += `&paging.cursor=${nextPage}`
    }
    return await axiosInstance.get(url);
  },
  async getPostMetrics(postId: string): Promise<any> {
    return await axiosInstance.get(`/api/blog/posts/${postId}/metrics`);
  }
}
