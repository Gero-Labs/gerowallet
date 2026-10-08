import axios from 'axios';
import type { Document } from '@contentful/rich-text-types';

export interface HelpArticleSummary {
  id: string; slug: string; title: string; summary: string; kind: string; topic: string;
  source: 'gero-help' | 'gero-blog'; locale: string; revision: number; readingMinutes: number;
  lastVerifiedAt?: string; resolvedLocale?: string; isLocaleFallback?: boolean;
  applicability: { chains: string[]; networks: string[]; walletTypes: string[]; requiredFeatures: string[]; testedWalletVersion?: string };
}
export interface PublishedHelpArticle extends HelpArticleSummary {
  body: Document; relatedArticleIds: string[];
  assets: Record<string, { url: string; title: string; contentType: string }>;
}
export interface HelpSource { source: string; status: 'fresh' | 'stale' | 'unavailable'; lastSuccessfulSyncAt: string | null; mode?: 'manual' | 'automatic'; lastReviewedAt?: string | null }
export interface HelpUpdate {
  id: string; source: string; kind: 'blog' | 'news' | 'social'; chain: string; title: string; summary: string;
  text?: string; canonicalUrl?: string; publishedAt: string | null; timestampStatus?: string;
  publisher: string; locale: string; isLocaleFallback?: boolean; destination?: { type: 'blog'; slug: string };
  media: { url: string; alt: string }[];
}
export interface HelpUpdatesPage { items: HelpUpdate[]; total: number; nextCursor: string | null; sources: HelpSource[] }
export interface HelpHome {
  topics: { id: string; articles: HelpArticleSummary[] }[];
  publicFeaturedArticles: HelpArticleSummary[];
  walletFeaturedArticles: Record<string, HelpArticleSummary[]>;
  sources: HelpSource[];
  updatePreviews?: HelpUpdate[];
}
export interface HelpResult extends HelpArticleSummary {
  snippet?: string; destination?: { type: 'help-article' | 'blog'; slug: string };
}
export interface HelpPage { items?: HelpResult[]; results?: HelpResult[]; total: number; nextCursor: string | null; sources: HelpSource[] }
export interface HelpArticleResponse { article: PublishedHelpArticle; resolvedLocale: string; isLocaleFallback: boolean; sources: HelpSource[] }
const client = axios.create({ baseURL: import.meta.env['VITE_BACKEND_URL'], timeout: 12000, withCredentials: false });
export const helpLocale = (locale: string): string => locale === 'de' ? 'de-DE' : locale === 'es' ? 'es-ES' : 'en-US';
export async function getHelpHome(locale: string, signal: AbortSignal): Promise<HelpHome> {
  return (await client.get<HelpHome>('/api/help/home', { params: { locale }, signal })).data;
}
export async function getHelpArticle(slug: string, locale: string, signal: AbortSignal): Promise<HelpArticleResponse | null> {
  try { return (await client.get<HelpArticleResponse>(`/api/help/articles/${encodeURIComponent(slug)}`, { params: { locale }, signal })).data; }
  catch (error) { if (axios.isAxiosError(error) && error.response?.status === 404) return null; throw error; }
}
export async function getHelpPage(params: { locale: string; chain: string; topic?: string; q?: string; cursor?: string }, search: boolean, signal: AbortSignal): Promise<HelpPage> {
  return (await client.get<HelpPage>(search ? '/api/help/search' : '/api/help/articles', { params: { ...params, limit: 20 }, signal })).data;
}
export function isChangedHelpSnapshot(error: unknown): boolean { return axios.isAxiosError(error) && error.response?.status === 409; }
export async function getHelpUpdates(params: { source: string; chain: string; locale: string; cursor?: string }, signal: AbortSignal): Promise<HelpUpdatesPage> {
  return (await client.get<HelpUpdatesPage>('/api/help/updates', { params: { ...params, limit: 20 }, signal })).data;
}
