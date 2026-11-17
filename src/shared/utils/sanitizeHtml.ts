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
