// Synthetic public DTOs only. No CMS drafts, real posts, credentials, or wallet keys.
const topics = ['start', 'send', 'card', 'earn', 'security', 'fix'];
const paragraph = value => ({ nodeType: 'paragraph', data: {}, content: [{ nodeType: 'text', value, data: {}, marks: [] }] });
const guides = Array.from({ length: 25 }, (_, i) => {
  const id = ['create', 'restore', 'backup', 'midnight-proof'][i] || `fixture-${i}`;
  const topic = topics[i % topics.length];
  return {
    id, slug: id, title: `Fixture wallet guide ${id}`, summary: 'Synthetic content for browser verification.', kind: 'guide', topic,
    applicability: { chains: topic === 'card' || topic === 'earn' ? ['cardano'] : id === 'midnight-proof' ? ['midnight'] : [], networks: [], walletTypes: [], requiredFeatures: [], testedWalletVersion: '2.7.2' },
    body: { nodeType: 'document', data: {}, content: [{ nodeType: 'ordered-list', data: {}, content: Array.from({ length: 4 }, (_, step) => ({ nodeType: 'list-item', data: {}, content: [paragraph(`Fixture step ${step + 1}`)] })) }] },
    relatedArticleIds: [], assets: {}, locale: 'en-US', source: 'gero-help', revision: 1, lastVerifiedAt: '2026-01-01T00:00:00Z', readingMinutes: 2,
  };
});
const updates = [
  ...Array.from({ length: 40 }, (_, i) => ['cardano-news', 'cardano', 'cardano.org', i]),
  ...Array.from({ length: 3 }, (_, i) => ['midnight-news', 'midnight', 'midnight.network', i]),
  ...Array.from({ length: 2 }, (_, i) => ['bitcoin-news', 'bitcoin', 'bitcoincore.org', i]),
].map(([source, chain, host, i]) => ({ id: `${source}:${i}`, source, chain, kind: 'news', title: `Fixture ${source} ${i}`, canonicalUrl: `https://${host}/blog/fixture-${i}`, publisher: host, locale: 'en-US', publishedAt: '2026-01-01T00:00:00Z', media: [] }));
for (const source of ['gero-x', 'nexus-x']) for (let i = 1; i <= 2; i++) updates.push({
  id: `${source}:${i}`, source, chain: 'all', kind: 'social', title: `Fixture ${source} post`, text: 'Synthetic post; no live X request.',
  canonicalUrl: `https://x.com/i/web/status/${i}`, publisher: 'x.com', locale: 'en-US', publishedAt: null, timestampStatus: 'unknown', media: [],
});
module.exports = { guides, updates };
