/**
 * Blog source (Gero backend).
 *
 * The wallet used to read Contentful's delivery API directly from each user's browser,
 * which billed every reader against a single monthly quota and, once that ran out, took the
 * blog offline for everybody. The backend now snapshots the CMS once a day and serves both
 * the posts and their images, so this client talks to one origin we control.
 *
 * The body is still a Contentful rich-text document: only the transport moved.
 */
import axios from 'axios';
import type { Document } from '@contentful/rich-text-types';

const axiosInstance = axios.create({
  baseURL: import.meta.env['VITE_BACKEND_URL'],
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

/** The normalized post the blog views render. */
export interface BlogPost {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  /** Rich-text document. Null in list responses, which do not carry bodies. */
  content: Document | null;
  publishDate: string;
  readingTime: number;
  /** Card thumbnail. */
  image?: string;
  /** Full-width hero, already sized by the backend. Do not strip its query. */
  heroImage?: string;
  tags: string[];
  /** Assets embedded in the rich-text body, by id. Empty in list responses. */
  assets: Record<string, { url?: string; title?: string; contentType?: string }>;
}

export interface BlogListResult {
  posts: BlogPost[];
  total: number;
  hasMore: boolean;
}

/** One page of posts, newest first. Bodies are omitted; fetch a post by slug for its body. */
export async function getBlogPosts(page = 1, limit = 10): Promise<BlogListResult> {
  const { data } = await axiosInstance.get<BlogListResult>('/api/blog/articles', {
    params: { page, limit },
  });
  return {
    posts: (data.posts ?? []).map(normalize),
    total: data.total ?? 0,
    hasMore: Boolean(data.hasMore),
  };
}

/** A single post by slug, with its rich-text body. Null if not found. */
export async function getBlogPostBySlug(slug: string): Promise<BlogPost | null> {
  try {
    const { data } = await axiosInstance.get<BlogPost>(`/api/blog/articles/${encodeURIComponent(slug)}`);
    return data ? normalize(data) : null;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) return null;
    throw error;
  }
}

/** Fills in the optional fields the views index into unconditionally. */
function normalize(post: BlogPost): BlogPost {
  return {
    ...post,
    excerpt: post.excerpt ?? '',
    content: post.content ?? null,
    readingTime: post.readingTime ?? 1,
    tags: post.tags ?? [],
    assets: post.assets ?? {},
  };
}
