import { documentToHtmlString } from '@contentful/rich-text-html-renderer';
import { BLOCKS, INLINES } from '@contentful/rich-text-types';
import type { PublishedHelpArticle } from '@/api/help.api';

const escape = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Reject CMS-supplied asset origins, executable links, and unresolved embedded entries. */
export function renderHelpArticle(article: PublishedHelpArticle, baseUrl: string): string {
  return documentToHtmlString(article.body, { renderNode: {
    [BLOCKS.EMBEDDED_ASSET]: node => {
      const id = (node.data?.target as { sys?: { id?: string } })?.sys?.id;
      const asset = id ? article.assets[id] : undefined;
      if (!asset || !/^\/api\/help\/assets\/[a-f0-9]{64}$/.test(asset.url)
        || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(asset.contentType)) return '';
      const url = new URL(asset.url, baseUrl);
      if (!['https:', 'http:'].includes(url.protocol)) return '';
      return `<img src="${escape(url.href)}" alt="${escape(asset.title)}" loading="lazy" />`;
    },
    [INLINES.HYPERLINK]: (node, next) => {
      const uri = String(node.data?.uri ?? '');
      const label = next(node.content);
      if (!/^(https:\/\/|mailto:)[^\s\x00-\x1f]+$/i.test(uri)) return label;
      return `<a href="${escape(uri)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    },
    [BLOCKS.EMBEDDED_ENTRY]: () => '',
    [INLINES.EMBEDDED_ENTRY]: () => '',
    [INLINES.ENTRY_HYPERLINK]: (_node, next) => next(_node.content),
    [INLINES.ASSET_HYPERLINK]: (_node, next) => next(_node.content),
  } });
}
