export interface HelpHeading { id: string; text: string }

/**
 * Gives each h2 of already-sanitised article HTML a stable id (`help-section-N`, by position) and
 * lists them for the "On this page" rail. Parsing happens in an inert document, so nothing loads or runs.
 */
export function addHeadingIds(html: string): { html: string; headings: HelpHeading[] } {
  if (!html || typeof DOMParser === 'undefined') return { html, headings: [] };
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const headings: HelpHeading[] = [];
  doc.body.querySelectorAll('h2').forEach(heading => {
    const text = (heading.textContent ?? '').trim();
    if (!text) return;
    const id = `help-section-${headings.length + 1}`;
    heading.setAttribute('id', id);
    headings.push({ id, text });
  });
  return { html: doc.body.innerHTML, headings };
}
