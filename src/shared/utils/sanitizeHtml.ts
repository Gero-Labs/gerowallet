import DOMPurify from 'dompurify';

/**
 * Sanitize untrusted rich text (e.g. DAO descriptions / welcome messages served
 * by the backend) before rendering it with `v-html`.
 *
 * Uses DOMPurify instead of a hand-rolled allow/deny walker: DOMPurify normalizes
 * scheme obfuscations (leading whitespace, embedded control chars, HTML entities)
 * that defeat naive `href.startsWith('javascript')`-style checks, and it only
 * permits safe URI schemes by default (http, https, mailto, tel, …) — so
 * `javascript:` / `data:` links cannot slip through.
 */

// Force external links to be safe (no reverse-tabnabbing). Registered once at
// module load — DOMPurify is a singleton, and this is the only sanitizer.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.nodeName === 'A' && node.getAttribute('href')) {
    node.setAttribute('rel', 'noopener noreferrer');
    node.setAttribute('target', '_blank');
  }
});

const ALLOWED_TAGS = ['p', 'br', 'b', 'strong', 'i', 'em', 'a', 'ul', 'ol', 'li', 'span', 'div'];
const ALLOWED_ATTR = ['href', 'rel', 'target'];

export function sanitizeRichText(html: string): string {
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR });
}

// Richer allow-list for rendered Markdown (e.g. GitHub release notes in the
// changelog): headings, code, tables, blockquotes and images, on top of the
// rich-text tags. showdown does NOT sanitize its HTML output (raw <script> /
// on*=… handlers pass straight through), so every Markdown→HTML result MUST go
// through here before `v-html`. DOMPurify still strips event handlers and
// unsafe URI schemes regardless of what is allow-listed.
const MARKDOWN_TAGS = [
  ...ALLOWED_TAGS,
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'blockquote', 'pre', 'code', 'del', 'sub', 'sup',
  'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
];
const MARKDOWN_ATTR = [...ALLOWED_ATTR, 'src', 'alt', 'title', 'align'];

export function sanitizeMarkdownHtml(html: string): string {
  return DOMPurify.sanitize(html, { ALLOWED_TAGS: MARKDOWN_TAGS, ALLOWED_ATTR: MARKDOWN_ATTR });
}
