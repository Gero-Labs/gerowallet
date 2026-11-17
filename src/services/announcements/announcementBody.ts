// An announcement's body: markdown prose, with images on lines of their own.
//
// The repo's markdown renderer refuses images on purpose (a remote <img> in wallet chrome is a
// tracking pixel). Announcement images are not remote: the worker fetched them by SHA-256 and kept
// only bytes that hash to what the signed document names. So an image is written as a line of its
// own, `![alt](media:<sha256>)`, lifted out here BEFORE the prose reaches the renderer, and drawn
// by the component from those stored bytes. It never passes through v-html.
//
// Anything else that looks like an image (inline, a hash the document does not list, a URL) stays
// in the prose, where the renderer shows it as the literal text it is.

import { ALLOWED_URL } from './announcementRules';

export type BodySegment =
  | { kind: 'prose'; markdown: string }
  | { kind: 'image'; sha256: string; alt: string };

/** A whole line and nothing else. The alt is plain text: no brackets, bounded. */
const IMAGE_LINE = /^!\[([^[\]\n]{0,200})\]\(media:([0-9a-f]{64})\)$/;

export function splitBody(markdown: string, media: ReadonlyArray<{ sha256: string }>): BodySegment[] {
  const listed = new Set(media.map((m) => m.sha256));
  const segments: BodySegment[] = [];
  let prose: string[] = [];
  const flush = () => {
    if (prose.some((line) => line.trim() !== '')) segments.push({ kind: 'prose', markdown: prose.join('\n') });
    prose = [];
  };
  for (const line of (markdown || '').replace(/\r\n/g, '\n').split('\n')) {
    const image = IMAGE_LINE.exec(line.trim());
    if (image && listed.has(image[2]!)) {
      flush();
      segments.push({ kind: 'image', sha256: image[2]!, alt: image[1]!.trim() });
    } else {
      prose.push(line);
    }
  }
  flush();
  return segments;
}

/** A body link may only lead to one of Gero's own sites: the same rule the document's action follows. */
export function bodyLinkAllowed(url: string): boolean {
  return ALLOWED_URL.test(url);
}
