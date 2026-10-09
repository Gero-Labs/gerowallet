import type { HelpUpdate } from '@/api/help.api';
export const updateSources = ['all', 'gero-blog', 'ecosystem-news', 'gero-x', 'nexus-x'] as const;
export function updateSource(value: unknown): string {
  if (value === 'blog') return 'gero-blog';
  return typeof value === 'string' && [...updateSources, 'cardano-news', 'midnight-news', 'bitcoin-news'].includes(value) ? value : 'all';
}
export function updateLink(item: HelpUpdate): string | null {
  if (item.kind === 'blog' && item.destination?.type === 'blog' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.destination.slug)) return '/blog/' + item.destination.slug;
  try {
    const uri = new URL(item.canonicalUrl ?? '');
    const host = ({ 'cardano-news': 'cardano.org', 'midnight-news': 'midnight.network', 'bitcoin-news': 'bitcoincore.org', 'gero-x': 'x.com', 'nexus-x': 'x.com' } as Record<string, string>)[item.source];
    if (uri.protocol !== 'https:' || uri.hostname !== host || uri.username || uri.password || uri.port) return null;
    if (item.kind === 'social' && !/^\/i\/web\/status\/[1-9][0-9]{0,19}$/.test(uri.pathname)) return null;
    return uri.href;
  } catch { return null; }
}
export function updateImage(path: string, backend: string): string | null {
  if (!/^\/api\/help\/assets\/[a-f0-9]{64}$/.test(path)
    && !/^\/api\/blog\/assets\/[A-Za-z0-9_-]{1,100}_thumb_[a-f0-9]{8}$/.test(path)) return null;
  try { const uri = new URL(path, backend); return ['https:', 'http:'].includes(uri.protocol) ? uri.href : null; } catch { return null; }
}
/** Source pills on the Updates page. `ecosystem-news` stays valid in URLs but has no pill of its own. */
export const updatePillSources = ['gero-blog', 'cardano-news', 'midnight-news', 'bitcoin-news', 'gero-x', 'nexus-x'] as const;
/** With a chain filter active only that chain's news pill is offered. */
export function updatePills(chain: string): string[] {
  return updatePillSources.filter(source => chain === 'all' || !source.endsWith('-news') || source === chain + '-news');
}
/** Icon well for a source: the Gero or Nexus mark, or an MDI glyph for the chain feeds. */
export function updateSourceIcon(source: string): { mark: 'gero' | 'nexus' } | { icon: string } {
  if (source === 'nexus-x') return { mark: 'nexus' };
  if (source.startsWith('gero-')) return { mark: 'gero' };
  if (source === 'midnight-news') return { icon: 'mdi-weather-night' };
  if (source === 'bitcoin-news') return { icon: 'mdi-bitcoin' };
  return { icon: 'mdi-web' };
}
/** The item's media that resolves to a safe mirrored image, in order. Anything else is dropped, never framed empty. */
export function updateImages(item: HelpUpdate, backend: string): { src: string; alt: string }[] {
  return (item.media ?? []).flatMap(media => {
    const src = updateImage(media.url, backend);
    return src ? [{ src, alt: media.alt }] : [];
  });
}
