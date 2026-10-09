// Synthetic public DTOs only. No CMS drafts, real posts, credentials, wallet keys, or real images.
const zlib = require('node:zlib');
const topics = ['start', 'send', 'card', 'earn', 'security', 'fix'];
const paragraph = value => ({ nodeType: 'paragraph', data: {}, content: [{ nodeType: 'text', value, data: {}, marks: [] }] });
const heading = value => ({ nodeType: 'heading-2', data: {}, content: [{ nodeType: 'text', value, data: {}, marks: [] }] });
const steps = () => ({ nodeType: 'ordered-list', data: {}, content: Array.from({ length: 4 }, (_, step) => ({ nodeType: 'list-item', data: {}, content: [paragraph(`Fixture step ${step + 1}`)] })) });
const guides = Array.from({ length: 25 }, (_, i) => {
  const id = ['create', 'restore', 'backup', 'midnight-proof'][i] || `fixture-${i}`;
  const topic = id === 'midnight-proof' ? 'send' : topics[i % topics.length];
  return {
    id, slug: id, title: `Fixture wallet guide ${id}`, summary: 'Synthetic content for browser verification.', kind: 'guide', topic,
    applicability: { chains: id === 'midnight-proof' ? ['midnight'] : topic === 'card' || topic === 'earn' ? ['cardano'] : [], networks: [], walletTypes: [], requiredFeatures: [], testedWalletVersion: '2.7.2' },
    // midnight-proof carries two h2 headings so the reader rail shows "On this page"; the other guides are steps only.
    body: { nodeType: 'document', data: {}, content: id === 'midnight-proof'
      ? [heading('Fixture overview'), paragraph('Synthetic overview text.'), heading('Fixture steps'), steps()]
      : [steps()] },
    relatedArticleIds: id === 'midnight-proof' ? ['create', 'restore'] : [], assets: {}, locale: 'en-US', source: 'gero-help', revision: 1, lastVerifiedAt: '2026-01-01T00:00:00Z', readingMinutes: 2,
  };
});

// Mirrored-media paths exactly as updateImage() accepts them: a blog thumbnail and one Help asset per X account.
const BLOG_THUMB = '/api/blog/assets/fixture-blog_thumb_0a1b2c3d';
const X_IMAGES = { 'gero-x': '/api/help/assets/' + 'a'.repeat(64), 'nexus-x': '/api/help/assets/' + 'b'.repeat(64) };
const COLOURS = { [BLOG_THUMB]: [226, 109, 53], [X_IMAGES['gero-x']]: [53, 143, 226], [X_IMAGES['nexus-x']]: [140, 70, 210] };

const updates = [
  { id: 'gero-blog:1', source: 'gero-blog', chain: 'all', kind: 'blog', title: 'Fixture Gero blog post', summary: 'Synthetic blog summary with a thumbnail.',
    destination: { type: 'blog', slug: 'fixture-blog-post' }, publisher: 'Gero', locale: 'en-US', publishedAt: '2026-01-03T00:00:00Z', media: [{ url: BLOG_THUMB, alt: 'Synthetic blog thumbnail' }] },
  { id: 'gero-blog:2', source: 'gero-blog', chain: 'all', kind: 'blog', title: 'Fixture Gero blog post without image', summary: 'Synthetic blog summary.',
    destination: { type: 'blog', slug: 'fixture-blog-plain' }, publisher: 'Gero', locale: 'en-US', publishedAt: '2026-01-02T00:00:00Z', media: [] },
  ...Array.from({ length: 40 }, (_, i) => ['cardano-news', 'cardano', 'cardano.org', i]),
  ...Array.from({ length: 3 }, (_, i) => ['midnight-news', 'midnight', 'midnight.network', i]),
  ...Array.from({ length: 2 }, (_, i) => ['bitcoin-news', 'bitcoin', 'bitcoincore.org', i]),
].map(entry => !Array.isArray(entry) ? entry : ({ id: `${entry[0]}:${entry[3]}`, source: entry[0], chain: entry[1], kind: 'news', title: `Fixture ${entry[0]} ${entry[3]}`, canonicalUrl: `https://${entry[2]}/blog/fixture-${entry[3]}`, publisher: entry[2], locale: 'en-US', publishedAt: '2026-01-01T00:00:00Z', media: [] }));
for (const source of ['gero-x', 'nexus-x']) for (let i = 1; i <= 2; i++) updates.push({
  id: `${source}:${i}`, source, chain: 'all', kind: 'social', title: `Fixture ${source} post`, text: `Synthetic ${source} post ${i}; no live X request.`,
  canonicalUrl: `https://x.com/i/web/status/${i}`, publisher: 'x.com', locale: 'en-US', publishedAt: null, timestampStatus: 'unknown',
  media: i === 1 ? [{ url: X_IMAGES[source], alt: `Synthetic ${source} post image` }] : [],
});

/** Source freshness as the backend reports it. Midnight is a stale, manually reviewed snapshot; call again for an independent copy. */
function updateSources() {
  return ['gero-blog', 'cardano-news', 'midnight-news', 'bitcoin-news', 'gero-x', 'nexus-x'].map(source => ({
    source, status: source === 'midnight-news' ? 'stale' : 'fresh', mode: source === 'midnight-news' ? 'manual' : 'automatic',
    lastReviewedAt: '2026-09-01T00:00:00Z', lastSuccessfulSyncAt: '2026-10-08T20:00:00Z',
  }));
}

/** One page of /api/help/updates for a request's query string. `empty` withdraws everything. */
function updatesPage(params, sources, empty = false) {
  const source = params.get('source'), chain = params.get('chain'), limit = Number(params.get('limit')) || 20;
  const items = empty ? [] : updates.filter(i => (source === 'all' || i.source === source || source === 'ecosystem-news' && i.kind === 'news') && (chain === 'all' || i.chain === 'all' || i.chain === chain));
  const offset = params.has('cursor') ? limit : 0;
  return { items: items.slice(offset, offset + limit), total: items.length, nextCursor: offset + limit < items.length ? 'page-two' : null, sources };
}

// Solid-colour PNGs built in memory, so the mirrored-media paths above resolve without any real image.
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buffer => { let c = 0xffffffff; for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]), head = Buffer.alloc(4), tail = Buffer.alloc(4);
  head.writeUInt32BE(data.length); tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}
function solidPng(width, height, [red, green, blue]) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [red, green, blue]).flat())]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const pngs = Object.fromEntries(Object.entries(COLOURS).map(([path, colour]) => [path, solidPng(path === BLOG_THUMB ? 160 : 320, path === BLOG_THUMB ? 90 : 180, colour)]));
/** Playwright fulfil options for a mirrored fixture image path, or null when the path is not one of the fixtures. */
function mediaResponse(pathname) {
  const body = pngs[pathname];
  return body ? { status: 200, contentType: 'image/png', body, headers: { 'access-control-allow-origin': '*' } } : null;
}

module.exports = { guides, updates, updateSources, updatesPage, mediaResponse, BLOG_THUMB, X_IMAGES };
