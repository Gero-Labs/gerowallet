import type { HelpHome, HelpSource } from '@/api/help.api';
import { applies, asAnswer, featuredAnswers, topics, type HelpAnswer, type HelpContext } from './helpContent';
import type { SupportNotice } from './supportIntent';

/** The Most viewed list never shows more than this many rows. */
export const MOST_VIEWED_MAX = 10;

export interface MostViewed {
  items: HelpAnswer[];
  /** True only when the backend ranked these by views; the fallback must not claim a ranking. */
  ranked: boolean;
}

/**
 * Backend ranking first (`popularArticles`). Without one: the featured list, then the catalog in
 * topic order, up to ten rows, every entry filtered by `applies()`.
 */
export function mostViewed(input: { home: HelpHome | null; basic: boolean; featured: HelpAnswer[]; catalog: HelpAnswer[]; context: HelpContext }): MostViewed {
  const { home, basic, featured, catalog, context } = input;
  if (!basic) {
    const popular = (home?.popularArticles ?? []).map(asAnswer).filter(answer => applies(answer, context)).slice(0, MOST_VIEWED_MAX);
    if (popular.length) return { items: popular, ranked: true };
  }
  const items: HelpAnswer[] = [];
  const seen = new Set<string>();
  const add = (answer: HelpAnswer): void => {
    if (seen.has(answer.id) || !applies(answer, context)) return;
    seen.add(answer.id);
    items.push(answer);
  };
  featured.forEach(add);
  for (const topic of topics) catalog.filter(answer => answer.topic === topic.id).forEach(add);
  return { items: items.slice(0, MOST_VIEWED_MAX), ranked: false };
}

export interface LatestTutorial { answer: HelpAnswer; remote: boolean }
const verifiedAt = (answer: HelpAnswer): number => {
  const time = Date.parse(answer.lastVerifiedAt ?? '');
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
};

/** Newest published tutorial by verification date; otherwise the first bundled featured answer. */
export function latestTutorial(input: { home: HelpHome | null; basic: boolean; context: HelpContext }): LatestTutorial | null {
  const { home, basic, context } = input;
  if (!basic && home) {
    const newest = home.topics.flatMap(topic => topic.articles).filter(article => article.kind === 'tutorial')
      .map(asAnswer).filter(answer => applies(answer, context))
      .reduce<HelpAnswer | null>((best, answer) => !best || verifiedAt(answer) > verifiedAt(best) ? answer : best, null);
    if (newest) return { answer: newest, remote: true };
  }
  const fallback = featuredAnswers(context.chain).find(answer => applies(answer, context));
  return fallback ? { answer: fallback, remote: false } : null;
}

export type SupportWidgetAction = 'unlock' | 'setup' | 'contact';
/** Live-chat status copy and the one action offered, for each state `supportNoticeFor()` reports. */
export function supportWidgetFor(notice: SupportNotice): { statusKey: string; action: SupportWidgetAction } {
  if (notice === 'locked') return { statusKey: 'help.home.liveChatLocked', action: 'unlock' };
  if (notice === 'noWallets') return { statusKey: 'help.home.liveChatNoWallets', action: 'setup' };
  if (notice === 'ineligible') return { statusKey: 'support.unavailable.notice', action: 'contact' };
  return { statusKey: `help.notice.${notice}`, action: 'contact' };
}

/** Sources shown by the Ecosystem news card and the Updates pills for the active chain. */
export function relevantNewsSources(sources: HelpSource[], chain: string): HelpSource[] {
  return sources.filter(item => item.source.endsWith('-news') && (chain === 'all' || item.source === chain + '-news'));
}
/** The freshness dot is green only when every relevant news source is fresh. */
export function newsIsFresh(sources: HelpSource[], chain: string): boolean {
  const relevant = relevantNewsSources(sources, chain);
  return relevant.length > 0 && relevant.every(item => item.status === 'fresh');
}
