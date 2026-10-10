import { describe, expect, it } from 'vitest';
import type { HelpArticleSummary, HelpHome, HelpSource } from '@/api/help.api';
import { answers, asAnswer, featuredAnswers, kindLabelKey, type HelpContext } from './helpContent';
import { latestTutorial, mostViewed, newsIsFresh, relevantNewsSources, supportWidgetFor, MOST_VIEWED_MAX } from './helpHome';

const all: HelpContext = { chain: 'all', features: {} };
const summary = (id: string, values: Partial<HelpArticleSummary> = {}): HelpArticleSummary => ({
  id, slug: id, title: id, summary: id + ' summary', kind: 'guide', topic: 'start', source: 'gero-help', locale: 'en-US', revision: 1, readingMinutes: 2,
  applicability: { chains: [], networks: [], walletTypes: [], requiredFeatures: [], testedWalletVersion: '2.7.2' }, ...values,
});
const home = (values: Partial<HelpHome> = {}): HelpHome => ({ topics: [], publicFeaturedArticles: [], walletFeaturedArticles: {}, sources: [], ...values });

describe('Most viewed', () => {
  it('uses the backend ranking, in order, when it is present', () => {
    const popular = [summary('b'), summary('a'), summary('c', { applicability: { chains: ['bitcoin'], networks: [], walletTypes: [], requiredFeatures: [] } })];
    const result = mostViewed({ home: home({ popularArticles: popular }), basic: false, featured: [], catalog: [], context: { chain: 'cardano', features: {} } });
    expect(result.ranked).toBe(true);
    expect(result.items.map(item => item.id)).toEqual(['b', 'a']);
  });
  it('caps a long ranking at ten rows', () => {
    const popular = Array.from({ length: 14 }, (_, index) => summary('p' + index));
    expect(mostViewed({ home: home({ popularArticles: popular }), basic: false, featured: [], catalog: [], context: all }).items).toHaveLength(MOST_VIEWED_MAX);
  });
  it('falls back to the featured list, then the catalog in topic order, without claiming a ranking', () => {
    const result = mostViewed({ home: home({ popularArticles: [] }), basic: false, featured: [asAnswer(summary('feat', { topic: 'fix' }))], context: all,
      catalog: [asAnswer(summary('x-fix', { topic: 'fix' })), asAnswer(summary('x-send', { topic: 'send' })), asAnswer(summary('x-start', { topic: 'start' })), asAnswer(summary('feat', { topic: 'fix' }))] });
    expect(result.ranked).toBe(false);
    expect(result.items.map(item => item.id)).toEqual(['feat', 'x-start', 'x-send', 'x-fix']);
  });
  it('fills the bundled catalog up to ten rows, filtered by the active chain', () => {
    const context: HelpContext = { chain: 'midnight', features: {} };
    const result = mostViewed({ home: null, basic: true, featured: featuredAnswers('midnight'), catalog: answers, context });
    expect(result.ranked).toBe(false);
    expect(result.items).toHaveLength(MOST_VIEWED_MAX);
    expect(result.items.slice(0, 3).map(item => item.id)).toEqual(['midnight-start', 'midnight-dust', 'midnight-proof']);
    expect(result.items.every(item => !item.chains.length || item.chains.includes('midnight'))).toBe(true);
    expect(new Set(result.items.map(item => item.id)).size).toBe(result.items.length);
  });
  it('ignores a published ranking in basic mode and when it holds nothing for this chain', () => {
    const popular = [summary('only-bitcoin', { applicability: { chains: ['bitcoin'], networks: [], walletTypes: [], requiredFeatures: [] } })];
    const context: HelpContext = { chain: 'cardano', features: {} };
    expect(mostViewed({ home: home({ popularArticles: popular }), basic: true, featured: [], catalog: [], context }).ranked).toBe(false);
    expect(mostViewed({ home: home({ popularArticles: popular }), basic: false, featured: [], catalog: [], context }).ranked).toBe(false);
  });
});

describe('Latest tutorial', () => {
  const dated = (id: string, kind: string, lastVerifiedAt?: string) => summary(id, { kind, lastVerifiedAt });
  it('picks the newest published tutorial by verification date and ignores other kinds', () => {
    const topics = [{ id: 'start', articles: [dated('old', 'tutorial', '2026-08-01T00:00:00Z'), dated('guide', 'guide', '2026-10-05T00:00:00Z'), dated('undated', 'tutorial')] },
      { id: 'fix', articles: [dated('new', 'tutorial', '2026-10-02T00:00:00Z')] }];
    const result = latestTutorial({ home: home({ topics }), basic: false, context: all });
    expect(result).toMatchObject({ remote: true, answer: { id: 'new', kind: 'tutorial', testedWalletVersion: '2.7.2' } });
  });
  it('falls back to the first bundled featured answer when there is no tutorial', () => {
    const result = latestTutorial({ home: home({ topics: [{ id: 'start', articles: [dated('guide', 'guide')] }] }), basic: false, context: all });
    expect(result).toMatchObject({ remote: false, answer: { id: 'create' } });
    expect(latestTutorial({ home: null, basic: true, context: { chain: 'bitcoin', features: {} } })).toMatchObject({ remote: false, answer: { id: 'bitcoin-start' } });
  });
  it('skips tutorials that do not apply to the active chain', () => {
    const bitcoinOnly = summary('btc', { kind: 'tutorial', lastVerifiedAt: '2026-10-09T00:00:00Z', applicability: { chains: ['bitcoin'], networks: [], walletTypes: [], requiredFeatures: [] } });
    const result = latestTutorial({ home: home({ topics: [{ id: 'start', articles: [bitcoinOnly] }] }), basic: false, context: { chain: 'cardano', features: {} } });
    expect(result?.remote).toBe(false);
  });
  it('labels kinds: tutorial, guide, quick answer', () => {
    expect(kindLabelKey(asAnswer(summary('t', { kind: 'tutorial' })))).toBe('help.home.tutorialKind');
    expect(kindLabelKey(asAnswer(summary('g', { kind: 'faq' })))).toBe('help.guide');
    expect(kindLabelKey(answers[0])).toBe('help.quickAnswer');
  });
});

describe('Support widget states', () => {
  it.each([
    ['locked', 'help.home.liveChatLocked', 'unlock'],
    ['noWallets', 'help.home.liveChatNoWallets', 'setup'],
    ['eligible', 'help.notice.eligible', 'contact'],
    ['syncing', 'help.notice.syncing', 'contact'],
    ['disabled', 'help.notice.disabled', 'contact'],
    ['ineligible', 'support.unavailable.notice', 'contact'],
  ] as const)('%s shows %s and offers %s', (notice, statusKey, action) => {
    expect(supportWidgetFor(notice)).toEqual({ statusKey, action });
  });
});

describe('Ecosystem news freshness', () => {
  const source = (name: string, status: HelpSource['status']): HelpSource => ({ source: name, status, lastSuccessfulSyncAt: null });
  const sources = [source('gero-blog', 'stale'), source('cardano-news', 'fresh'), source('midnight-news', 'stale'), source('bitcoin-news', 'fresh')];
  it('considers only news sources, narrowed to the chain', () => {
    expect(relevantNewsSources(sources, 'all').map(item => item.source)).toEqual(['cardano-news', 'midnight-news', 'bitcoin-news']);
    expect(relevantNewsSources(sources, 'midnight').map(item => item.source)).toEqual(['midnight-news']);
  });
  it('is fresh only when every relevant source is fresh', () => {
    expect(newsIsFresh(sources, 'all')).toBe(false);
    expect(newsIsFresh(sources, 'cardano')).toBe(true);
    expect(newsIsFresh([], 'all')).toBe(false);
  });
});
