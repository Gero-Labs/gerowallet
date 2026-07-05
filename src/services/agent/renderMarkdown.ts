// Safe markdown -> HTML for chat replies, injected via v-html. Safety model: ALL input is
// HTML-escaped FIRST, then a small markdown subset is rendered on the escaped text, so no
// attacker-controlled HTML (e.g. a malicious token name in the LLM reply) can execute.
// Supported: headings (#, ##, ###), bold (**), inline code (`), bullet + numbered lists,
// links ([text](http(s)://...)), paragraphs with line breaks. Italics are intentionally
// omitted (single-underscore/asterisk false-positives on token names + pool ids).

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Inline formatting on already-escaped text. */
function renderInline(escaped: string): string {
  let s = escaped;
  // inline code first so its contents are not touched by other rules
  s = s.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);
  // bold **text**
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // links [text](http(s)://url) only - any other scheme is left as literal text
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_m, text, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`,
  );
  return s;
}

/** Render a markdown chat reply to a safe HTML string. */
export function renderMarkdown(src: string): string {
  const escaped = escapeHtml((src || '').replace(/\r\n/g, '\n'));
  const lines = escaped.split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let i = 0;

  const flushPara = (): void => {
    if (para.length) {
      out.push(`<p>${renderInline(para.join('<br>'))}</p>`);
      para = [];
    }
  };

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (trimmed === '') {
      flushPara();
      i++;
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushPara();
      const lvl = heading[1].length;
      out.push(`<div class="md-h md-h${lvl}">${renderInline(heading[2])}</div>`);
      i++;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(`<li>${renderInline(lines[i].trim().replace(/^[-*]\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${renderInline(lines[i].trim().replace(/^\d+\.\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    para.push(trimmed);
    i++;
  }
  flushPara();
  return out.join('');
}
