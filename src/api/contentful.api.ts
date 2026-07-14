/**
 * Contentful blog source (Content Delivery API).
 *
 * A thin fetch against the CDA REST endpoint rather than the `contentful` SDK,
 * to keep the extension bundle small. The token is a PUBLIC read-only delivery
 * token (safe to ship); connect-src allows https://cdn.contentful.com.
 *
 * The blog content model is owned by the Gero SEO control panel; the field
 * shape here mirrors Gero-Control-Panel/src/lib/contentful.ts.
 */
import type { Document } from '@contentful/rich-text-types';

const SPACE = import.meta.env['VITE_CONTENTFUL_SPACE_ID'] as string | undefined;
const TOKEN = import.meta.env['VITE_CONTENTFUL_ACCESS_TOKEN'] as string | undefined;
const ENVIRONMENT = (import.meta.env['VITE_CONTENTFUL_ENVIRONMENT'] as string | undefined) || 'master';

/** Blog post content type ID (from the Contentful space). */
const BLOG_CONTENT_TYPE = '4qqC1iYxJyBZOFbYISxUev';

/** Raw Contentful field shape (only what the wallet consumes). */
interface RawBlogFields {
  title: string;
  slug: string;
  excerpt?: string;
  content?: Document;
  publishDate: string;
  category?: string;
  tags?: string[];
  featured?: boolean;
  featuredImage?: { sys: { id: string } };
  readingTime?: number;
}

interface RawAsset {
  sys: { id: string };
  fields: { file?: { url?: string; contentType?: string } };
}

interface RawEntry {
  sys: { id: string };
  fields: RawBlogFields;
}

interface RawEntriesResponse {
  total: number;
  skip: number;
  limit: number;
  items: RawEntry[];
  includes?: { Asset?: RawAsset[] };
}

/** The normalized post the blog views render. */
export interface BlogPost {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  /** Rich-text document; rendered in the in-app post view. */
  content: Document | null;
  publishDate: string;
  readingTime: number;
  image?: string;
  tags: string[];
  /** Assets referenced by the rich-text body (embedded-asset-block), by id. */
  assets: Record<string, { url?: string; title?: string; contentType?: string }>;
}

export interface BlogListResult {
  posts: BlogPost[];
  total: number;
  hasMore: boolean;
}

export function isContentfulConfigured(): boolean {
  return Boolean(SPACE && TOKEN);
}

/** `//...` -> `https://...`. Optional card thumbnail transform for list images. */
function absoluteUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return url.startsWith('//') ? `https:${url}` : url;
}
function cardThumb(asset: RawAsset | undefined): string | undefined {
  const abs = absoluteUrl(asset?.fields?.file?.url);
  if (!abs) return undefined;
  return abs.includes('images.ctfassets.net') ? `${abs}?w=480&h=300&fit=fill&fm=webp` : abs;
}

/** ~200 wpm reading-time estimate, used when the CMS field is absent. */
function estimateReadingTime(doc: Document | null): number {
  if (!doc) return 1;
  let words = 0;
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as { nodeType?: string; value?: string; content?: unknown[] };
    if (n.nodeType === 'text' && typeof n.value === 'string') {
      words += n.value.trim().split(/\s+/).filter(Boolean).length;
    }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(doc);
  return Math.max(1, Math.ceil(words / 200));
}

function normalize(entry: RawEntry, assetsById: Map<string, RawAsset>): BlogPost {
  const f = entry.fields;
  const content = f.content ?? null;
  const asset = f.featuredImage ? assetsById.get(f.featuredImage.sys.id) : undefined;
  const assets: BlogPost['assets'] = {};
  assetsById.forEach((a, id) => {
    assets[id] = {
      url: absoluteUrl(a.fields?.file?.url),
      title: (a as { fields?: { title?: string } }).fields?.title,
      contentType: a.fields?.file?.contentType,
    };
  });
  return {
    id: entry.sys.id,
    title: f.title,
    slug: f.slug,
    excerpt: f.excerpt ?? '',
    content,
    publishDate: f.publishDate,
    readingTime: f.readingTime ?? estimateReadingTime(content),
    image: cardThumb(asset),
    tags: f.tags ?? [],
    assets,
  };
}

function assetMap(res: RawEntriesResponse): Map<string, RawAsset> {
  const map = new Map<string, RawAsset>();
  (res.includes?.Asset ?? []).forEach((a) => map.set(a.sys.id, a));
  return map;
}

async function cdaGet(params: Record<string, string | number>): Promise<RawEntriesResponse> {
  if (!isContentfulConfigured()) {
    throw new Error('Contentful is not configured (missing VITE_CONTENTFUL_SPACE_ID / _ACCESS_TOKEN).');
  }
  const url = new URL(`https://cdn.contentful.com/spaces/${SPACE}/environments/${ENVIRONMENT}/entries`);
  url.searchParams.set('access_token', TOKEN as string);
  url.searchParams.set('content_type', BLOG_CONTENT_TYPE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const resp = await fetch(url.toString());
  if (!resp.ok) throw new Error(`Contentful ${resp.status}`);
  return resp.json();
}

/** One page of posts, newest first. */
export async function getBlogPosts(page = 1, limit = 10): Promise<BlogListResult> {
  const res = await cdaGet({ order: '-fields.publishDate', limit, skip: (page - 1) * limit });
  const assets = assetMap(res);
  return {
    posts: res.items.map((e) => normalize(e, assets)),
    total: res.total,
    hasMore: res.skip + res.items.length < res.total,
  };
}

/** A single post by slug, with its rich-text body. Null if not found. */
export async function getBlogPostBySlug(slug: string): Promise<BlogPost | null> {
  const res = await cdaGet({ 'fields.slug': slug, limit: 1 });
  if (!res.items.length) return null;
  return normalize(res.items[0], assetMap(res));
}
