/**
 * Safe markdown -> HTML, injected via `v-html`.
 *
 * SAFETY MODEL (do not change the order): ALL input is HTML-escaped FIRST, then
 * a small markdown subset is rendered on the escaped text. Nothing an author
 * wrote can ever reach the DOM as markup — the only tags in the output are the
 * ones this file constructs itself.
 *
 * Author input reaches the output as escaped TEXT, which is the whole design,
 * and in attribute VALUES, which is where the care goes. Those values are not
 * all alike: one carries the author's own bytes and two are numbers this file
 * computes from a match. All three are listed, with the reason each is safe,
 * above `REFERENCE_MARKER_ATTR`. Read that list before adding an attribute, and
 * extend it when you do.
 *
 * Both callers hand this function text they do not control:
 *  - agent chat replies (a token name inside an LLM answer), and
 *  - CIP-108 governance metadata, which is off-chain JSON authored by whoever
 *    submitted the proposal. Anyone can submit a governance action.
 *
 * Supported: headings (# .. ######), bold (**), inline code (`), bullet and
 * numbered lists including nesting, blockquotes (>), horizontal rules, pipe
 * tables, links ([text](http(s)://...)), paragraphs with line breaks, and
 * optional `[n]` reference markers the caller opts into.
 *
 * Deliberately NOT supported:
 *  - italics BY DEFAULT: single-underscore/asterisk false-positives on token
 *    names and pool ids. Callers rendering prose written for humans rather than
 *    chat about tokens can opt in with `emphasis: true`, which applies the
 *    word-boundary guard described on `EMPHASIS_UNDERSCORE` so `SNEK_ADA` and
 *    `some_field_name` still come through untouched. Governance metadata is
 *    ordinary prose and uses `_word_` freely, so it opts in.
 *  - images: a remote `<img>` in wallet chrome is a tracking pixel and a CSP
 *    question, so `![alt](url)` degrades to its literal text — the whole
 *    `![alt](url)` string, visible and escaped. It is lifted out BEFORE the
 *    link rule runs so it cannot fall through into an anchor: silently turning
 *    an embed into an outbound link would manufacture a destination the author
 *    never wrote as one, and would leave a stray "!" in front of it. Literal
 *    text shows the reader exactly what the proposal actually says. A linked
 *    banner, `[![alt](img)](href)`, follows from the same two rules rather
 *    than being a case of its own: the anchor the author DID write survives,
 *    and its visible text is that literal image markdown.
 *  - raw HTML passthrough: that is the whole point of escaping first.
 */

/**
 * Attribute an inline `[n]` marker carries its 1-based index in.
 *
 * The marker is a real `<button>`, not a link. A bare `#fragment` href is not
 * a same-document jump in this app: the extension runs a HASH-MODE router, so
 * clicking one REPLACES the route and reloading that address lands on the
 * wallet home instead of the proposal.
 *
 * ATTRIBUTE VALUES THAT VARY WITH AUTHOR INPUT. Three, and each is safe for its
 * own reason. All three reasons must keep holding; none of them covers another,
 * so weakening one is not paid for by the other two:
 *
 *  1. a link's `href` — the ONLY one that carries the author's own bytes. Two
 *     things make it safe. The link pattern admits nothing but an `http(s)://`
 *     URL, so no `javascript:` or `data:` value can reach it; and escaping ran
 *     first, so every `"` inside it is already `&quot;` and the value cannot
 *     close the quote it sits in. The same pattern also stops the destination
 *     at `<` or `>` so it cannot absorb this file's own markup — that one is
 *     about a correct destination rather than injection, and it is argued
 *     where `LINK` is built.
 *  2. this attribute, `data-md-ref` — written from a `\d{1,3}` match put
 *     through `Number()`. At most three DIGITS: it cannot contain a quote, a
 *     space or a letter at all, so there is nothing in it to escape.
 *  3. a heading's `class="md-h md-h{lvl}"` — `lvl` is the LENGTH of a `#{1,6}`
 *     run, so it is an integer 1..6 and never a substring of author text.
 *
 * Everything else this file writes as an attribute is a literal constant:
 * `target`, `rel`, `type`, `class="md-ref"` and `class="md-table"`. That list
 * and the three above are the whole set — `grep '="'` over this file to check
 * it after any change, because the next reader will trust what is written here.
 */
export const REFERENCE_MARKER_ATTR = 'data-md-ref';

/**
 * The 1-based reference index behind a click inside rendered prose, or null.
 *
 * Pair this with ONE delegated listener on the container that holds the
 * `v-html`. The renderer must never emit an inline `onclick`: an inline handler
 * is an execution sink sitting in output whose only defence is that escaping
 * ran first, and the marker needs no such attribute to work.
 */
export function referenceMarkerIndex(target: EventTarget | null): number | null {
  const el = target as Element | null;
  if (!el || typeof el.closest !== 'function') return null;
  const marker = el.closest(`[${REFERENCE_MARKER_ATTR}]`);
  if (!marker) return null;
  const index = Number(marker.getAttribute(REFERENCE_MARKER_ATTR));
  return Number.isInteger(index) && index > 0 ? index : null;
}

/** Caller-supplied hooks. Everything here is optional; absent means "render literally". */
export interface RenderMarkdownOptions {
  /**
   * Whether an inline `[n]` marker (1-based) has a reference to jump to.
   * Return false to leave the marker as plain text — a marker with no matching
   * reference must never be given an invented target, and must not look
   * clickable either.
   */
  hasReference?: (index: number) => boolean;
  /**
   * Render `_text_` and `*text*` as emphasis. Off by default: in chat about
   * tokens and pools, an underscore is far more often part of a name than a
   * formatting mark. See `EMPHASIS_UNDERSCORE` for the guard that keeps
   * intra-word underscores literal even when this is on.
   */
  emphasis?: boolean;
}

/**
 * `_text_` only at word boundaries: the opening mark may not follow a word
 * character and the closing mark may not precede one, so `SNEK_ADA` and
 * `some_field_name` keep their underscores while `_NOTE on this:_` becomes
 * emphasis. The inner run is bounded and cannot span a newline, so a stray
 * underscore costs a bounded scan rather than the quadratic backtracking an
 * unbounded run would invite (see the LINK/IMAGE bounds for the same reason).
 */
const EMPHASIS_UNDERSCORE = /(^|[^\w`])_(?!\s)([^_\n]{1,300}?)(?<!\s)_(?!\w)/g;
/** The asterisk spelling. Bold has already been lifted, so any `*` left is single. */
const EMPHASIS_ASTERISK = /(^|[^\w*`])\*(?!\s)([^*\n]{1,300}?)(?<!\s)\*(?!\w)/g;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Bracket-tolerant inline text: anything but a bracket, or one whole `[...]`
 * group. Link text and image alt both use it, and they must keep using the
 * SAME one.
 *
 * A citation inside link text, `[see note [2] here](https://…)`, is the shape
 * this exists for: a text pattern that cannot cross the inner `]` matches
 * nothing at all — the anchor is lost and, worse, the `[2]` left behind in the
 * wreckage becomes a marker button embedded in literal text. One level of
 * nesting covers that, and it keeps the pattern unambiguous (the two branches
 * differ on their first character, so there is nothing to backtrack over).
 * Deeper nesting is not claimed: `[a [b [c] d] e](url)` stays literal text,
 * which is the same outcome it had before.
 *
 * The alt shares it so that the image rule stays a SUPERSET of the link rule:
 * whatever `[…](…)` shape the link rule could match, the image rule matches
 * the `![…](…)` spelling of it first and lifts it out. That is what keeps
 * `![a[1]b](url)` literal instead of an anchor with a stray "!" in front.
 */
const INLINE_TEXT = /(?:[^[\]]|\[[^[\]]*\])/.source;

/**
 * Every quantifier below is BOUNDED, and that is a denial-of-service fix rather
 * than a style choice.
 *
 * An unclosed destination is the bad shape: in `[a](https://a.test/` the class
 * runs to the end of the document, fails to find `)`, and backtracks the whole
 * tail — then the scan restarts at the next `[` and pays for the tail again.
 * That is O(starts x tail). Measured before this bound, a body of that shape
 * repeated took 8.1s at 512 KB and 39s at 928 KB, and a proposal body arrives
 * from the API with no length cap, so a governance action anyone can submit
 * could freeze the proposal view. A bound turns each failed start into constant
 * work, so the cost follows the document instead of its square.
 *
 * The limits are far above any real document (a CIP-119 anchor URL is capped at
 * 128 characters on chain) and a link that exceeds them simply does not form,
 * staying visible literal text — the same honest outcome an unparseable link
 * already had.
 *
 * IMAGE's destination bound is the SMALLEST one that keeps it a superset of
 * LINK (see `INLINE_TEXT`): LINK carries an `https?://` prefix outside its own
 * bound, so the image must allow that prefix plus LINK's whole destination.
 * Every character of slack here is paid twice over on the bad shape — the
 * unclosed-image case is the more expensive of the two — so the margin is
 * small on purpose rather than a round number.
 */
const MAX_INLINE_TEXT = 1024;
const MAX_URL = 2048;
/** `https://` or `http://`, the longest prefix LINK matches before its bound. */
const URL_SCHEME_SLACK = 8;

const IMAGE = new RegExp(
  `!\\[${INLINE_TEXT}{0,${MAX_INLINE_TEXT}}\\]\\([^\\s)]{0,${MAX_URL + URL_SCHEME_SLACK}}\\)`,
  'g',
);

/**
 * A link's destination stops at `<` or `>`. That is what keeps this file's own
 * markup out of an `href`.
 *
 * Code spans and bold have already been rendered INTO the string by the time
 * this runs, so `[t](https://a.test/`x`)` reads here as
 * `[t](https://a.test/<md-slot-0>)`, and `**y**` in a URL reads as
 * `<strong>y</strong>`. A destination class of `[^\s)]+` swallowed those, and
 * the anchor came out pointing at `https://a.test/<code>x</code>`. Not an
 * injection — the value stayed escaped and stayed quoted — but a destination
 * the author never wrote, and a wallet must not hand a user one of those.
 *
 * Of the two honest outcomes, this is the one that sends the reader nowhere:
 * the link simply does not form and the line stays visible literal text. The
 * other, resolving to the author's literal URL, would mean matching links
 * BEFORE code spans, and then an anchor could form inside a `code` span — a
 * strictly worse trade, because "nothing formats inside code" is the rule the
 * inline ordering exists to protect.
 *
 * The only links it costs are the ones that were already coming out corrupted.
 * Escaping ran first, so an author who typed `<` in a URL arrives here as
 * `&lt;` and still matches — every raw `<` left in the string at this point was
 * written by this file, not by them. So the exclusion can only ever reject a
 * destination that this renderer had already rewritten.
 *
 * `IMAGE` keeps the wider class on purpose: it must stay a SUPERSET of this
 * pattern (see `INLINE_TEXT`), and it builds no attribute at all, since its
 * match is held verbatim as text.
 */
const LINK = new RegExp(
  `\\[(${INLINE_TEXT}{1,${MAX_INLINE_TEXT}})\\]\\((https?:\\/\\/[^\\s<>)]{1,${MAX_URL}})\\)`,
  'g',
);

/** Placeholder shape. Angle-bracketed on purpose — see `renderInline`. */
const SLOT = 'md-slot-';

/** Park finished HTML in `slots` and hand back the token that stands for it. */
function lift(slots: string[], html: string): string {
  slots.push(html);
  return `<${SLOT}${slots.length - 1}>`;
}

/**
 * Every token in a string, found in ONE scan. Same spelling `lift` writes.
 *
 * Reused across calls on purpose: `String.prototype.replace` resets a global
 * pattern's `lastIndex` before it starts, and the callback below runs no regex
 * of its own, so there is no shared cursor to trip over.
 */
const SLOT_TOKEN = new RegExp(`<${SLOT}(\\d+)>`, 'g');

/**
 * Put every lifted fragment back, leaving no token behind for ANY nesting.
 *
 * A slot's contents were built from the string as it stood when that slot was
 * created, so it can only ever mention slots that already existed — strictly
 * LOWER-numbered ones. The references form a DAG whose edges all point
 * downwards, and that is what makes a single ASCENDING sweep enough: by the
 * time slot `i` is expanded every slot it can name is already complete, so it
 * is finished once and never revisited. One final pass over the document then
 * resolves what is left against fragments that are already whole.
 *
 * The same invariant is the termination argument. There is no fixed point being
 * iterated towards and nothing counting rounds: the loop runs `slots.length`
 * times and `expand` is one non-recursive scan.
 *
 * COST. The predecessor walked the table from the top and split the WHOLE
 * document on each token in turn — O(slots x document). It needed no nesting to
 * hurt, so the depth cap above did not cover it: a FLAT proposal body carrying
 * a few thousand code spans and links froze the proposal view exactly as the
 * unbounded recursion did, and anyone can submit a governance action. This
 * touches each fragment once, so the work follows total content rather than the
 * product of the two.
 *
 * SUBSTITUTION PATTERNS. The replacement is a CALLBACK and never a replacement
 * STRING. A stored fragment is part author text, and `$&`, `$'` or `$1` inside
 * a replacement string would be expanded as a substitution pattern; a
 * callback's return value is inserted verbatim, so it cannot be. That is the
 * property the old `split`/`join` was there for, kept by other means.
 *
 * FORGERY. Escaping ran first, so every `<` an author wrote is already `&lt;`
 * and every token still in the string was written by this file: a proposal that
 * types `<md-slot-0>` gets it back as visible text and collects nobody's
 * fragment.
 */
function restoreSlots(s: string, slots: string[]): string {
  const resolved: string[] = [];

  const expand = (text: string): string =>
    text.replace(SLOT_TOKEN, (token, digits) => {
      const i = Number(digits);
      // Downward-only references mean the slot named here is always finished
      // already. The bound check keeps `expand` total; it is not a live branch.
      return i < resolved.length ? resolved[i] : token;
    });

  for (let i = 0; i < slots.length; i += 1) resolved.push(expand(slots[i]));

  return expand(s);
}

/**
 * Inline formatting on already-escaped text.
 *
 * Everything that has finished rendering is LIFTED OUT into a numbered slot
 * before the next rule runs, so no later rule can reach inside it. The
 * placeholder is spelled with angle brackets on purpose: escaping has already
 * turned every `<` in the author's text into `&lt;`, so a proposal that types
 * `<md-slot-0>` arrives here as `&lt;md-slot-0&gt;` and stays visible text —
 * it cannot forge a token and collect somebody else's rendered fragment.
 *
 * The order matters and is load-bearing:
 *  1. code spans — nothing formats inside `like this`.
 *  2. bold.
 *  3. images — lifted BEFORE links so `![alt](url)` cannot fall through into
 *     the link rule and come out as an anchor with a stray "!" in front.
 *  4. links — lifted BEFORE the `[n]` pass, which is the bug this ordering
 *     exists for: a URL may legitimately contain `[12]`, and running the
 *     marker rule over a finished `<a href="…[12]…">` splices a control into
 *     the middle of its own href, breaking the link AND leaking raw markup.
 *     It is also why a `[2]` inside LINK TEXT stays plain text: the anchor is
 *     already in a slot by then, so a marker button is never nested inside an
 *     anchor, which would be a control inside a control.
 *  5. `[n]` markers, over what is left: plain text only.
 *
 * Restore is `restoreSlots`, which finishes each slot in ascending order and
 * then sweeps the document once. A slot CAN hold another slot — in
 * `[![alt](img)](href)`, a linked banner and ordinary in CIP-108 bodies, the
 * image slot ends up INSIDE the link slot — which is what an early version
 * restoring images before links got wrong: it found nothing to do and the raw
 * token reached the DOM.
 */
function renderInline(escaped: string, options: RenderMarkdownOptions): string {
  const slots: string[] = [];

  let s = escaped.replace(/`([^`]+)`/g, (_m, code) => lift(slots, `<code>${code}</code>`));

  // bold **text**
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Emphasis, opt-in. After bold, so `**x**` is already gone and every
  // remaining asterisk is a single one; before links, so a marked-up run
  // inside link text still resolves.
  if (options.emphasis) {
    s = s.replace(EMPHASIS_UNDERSCORE, '$1<em>$2</em>');
    s = s.replace(EMPHASIS_ASTERISK, '$1<em>$2</em>');
  }

  // images stay literal — see the module header for why. Held verbatim so the
  // link rule below never sees them.
  s = s.replace(IMAGE, match => lift(slots, match));

  // links [text](http(s)://url) only - any other scheme is left as literal text.
  // `url` is the one attribute value in this renderer that carries the author's
  // own bytes: the pattern restricts the scheme, escaping already turned every
  // `"` in it into `&quot;` so it cannot close the quote it sits in, and the
  // pattern stops at `<`/`>` so it cannot absorb markup. See `LINK` and
  // `REFERENCE_MARKER_ATTR`.
  s = s.replace(LINK, (_m, text, url) =>
    lift(slots, `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`),
  );

  // [n] reference markers, only where the caller says a reference exists.
  const has = options.hasReference;
  if (has) {
    s = s.replace(/\[(\d{1,3})\]/g, (marker, digits) => {
      const index = Number(digits);
      if (!has(index)) return marker;
      // A button, not an anchor: see REFERENCE_MARKER_ATTR. The only value that
      // varies in THIS tag is `index`, and it came from `\d{1,3}`.
      return `<button type="button" class="md-ref" ${REFERENCE_MARKER_ATTR}="${index}">${marker}</button>`;
    });
  }

  return restoreSlots(s, slots);
}

/**
 * How many levels of block nesting may open before nesting stops and flattening
 * begins. Blockquotes and list indentation share this budget, because they
 * share a call stack.
 *
 * Both `renderBlocks` and `renderList` recurse once per level, and the level
 * count is author text. Uncapped, `'> '.repeat(5000)` — a few bytes of CIP-108
 * metadata — raises `RangeError: Maximum call stack size exceeded`, and about
 * 20,000 levels of list indentation does the same. That throw happens inside
 * the computed that renders a proposal body, so the proposal view breaks for
 * everyone who opens that action. Anyone can submit a governance action, so
 * this is reachable, not theoretical.
 *
 * 16 sits in the wide gap between the two: no real document reaches it (a
 * 16-deep list has spent 32 columns on indentation before its first word, and a
 * 16-deep quote 32 characters on `>` markers), and it is orders of magnitude
 * below the thousands of frames it takes to exhaust the stack.
 *
 * Past the cap, content is KEPT and only the extra nesting is dropped: a quote
 * marker stays the literal `>` it already is in the escaped text, and an
 * over-indented item becomes an item at the deepest open list. Dropping a
 * proposal's words because they were indented would be its own kind of lie.
 */
const MAX_BLOCK_DEPTH = 16;

interface ListItemLine {
  indent: number;
  ordered: boolean;
  text: string;
}

const BULLET = /^(\s*)[-*]\s+(.*)$/;
const ORDERED = /^(\s*)\d+\.\s+(.*)$/;

function listAt(line: string | undefined): ListItemLine | null {
  if (line === undefined) return null;
  const bullet = BULLET.exec(line);
  if (bullet) return { indent: bullet[1].length, ordered: false, text: bullet[2] };
  const ordered = ORDERED.exec(line);
  if (ordered) return { indent: ordered[1].length, ordered: true, text: ordered[2] };
  return null;
}

/**
 * A list and everything nested under it. Deeper-indented items attach to the
 * item above them, so `<ul><li>a<ul><li>b</li></ul></li></ul>` comes out of the
 * indentation rather than being flattened into one level.
 */
function renderList(
  lines: string[],
  start: number,
  options: RenderMarkdownOptions,
  depth: number,
): { html: string; next: number } {
  const first = listAt(lines[start]) as ListItemLine;
  const tag = first.ordered ? 'ol' : 'ul';
  const items: string[] = [];
  let i = start;

  while (i < lines.length) {
    const item = listAt(lines[i]);
    if (!item || item.indent < first.indent) break;
    if (item.indent > first.indent) {
      if (!items.length) break;
      if (depth >= MAX_BLOCK_DEPTH) {
        // At the cap (see MAX_BLOCK_DEPTH): keep the item's words, spend no
        // further stack on its indentation. It joins this list as a sibling.
        items.push(renderInline(item.text, options));
        i += 1;
        continue;
      }
      const nested = renderList(lines, i, options, depth + 1);
      items[items.length - 1] += nested.html;
      i = nested.next;
      continue;
    }
    if (item.ordered !== first.ordered) break;
    items.push(renderInline(item.text, options));
    i += 1;
  }

  return { html: `<${tag}>${items.map(html => `<li>${html}</li>`).join('')}</${tag}>`, next: i };
}

/** `|---|:--:|` and friends — the row that turns the line above it into a header. */
function isTableSeparator(line: string | undefined): boolean {
  if (line === undefined) return false;
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return false;
  return /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(trimmed);
}

function splitRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
  return trimmed.split('|').map(cell => cell.trim());
}

/**
 * A pipe table. Governance bodies are full of them (budget breakdowns), and
 * they are wide, so the table ships inside its own scroll box — the page body
 * must never scroll sideways because a proposal had eight columns.
 */
function renderTable(
  lines: string[],
  start: number,
  options: RenderMarkdownOptions,
): { html: string; next: number } {
  // No depth parameter: a table's cells are inline-only, so this never recurses
  // back into the block pass and cannot deepen the stack.
  const header = splitRow(lines[start]);
  let i = start + 2;
  const body: string[][] = [];
  while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
    body.push(splitRow(lines[i]));
    i += 1;
  }

  const head = `<tr>${header.map(cell => `<th>${renderInline(cell, options)}</th>`).join('')}</tr>`;
  const rows = body
    .map(row => `<tr>${row.map(cell => `<td>${renderInline(cell, options)}</td>`).join('')}</tr>`)
    .join('');

  return {
    html: `<div class="md-table"><table><thead>${head}</thead><tbody>${rows}</tbody></table></div>`,
    next: i,
  };
}

/**
 * Block-level pass over already-escaped lines.
 *
 * `depth` is how many block levels are already open above these lines, and it
 * is what keeps author-controlled nesting off the call stack — see
 * MAX_BLOCK_DEPTH.
 */
function renderBlocks(lines: string[], options: RenderMarkdownOptions, depth: number): string {
  const out: string[] = [];
  let para: string[] = [];
  let i = 0;

  const flushPara = (): void => {
    if (para.length) {
      out.push(`<p>${renderInline(para.join('<br>'), options)}</p>`);
      para = [];
    }
  };

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (trimmed === '') {
      flushPara();
      i += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushPara();
      out.push('<hr>');
      i += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushPara();
      const lvl = heading[1].length;
      out.push(`<div class="md-h md-h${lvl}">${renderInline(heading[2], options)}</div>`);
      i += 1;
      continue;
    }

    // `>` was escaped to `&gt;` by the time it gets here. At MAX_BLOCK_DEPTH the
    // marker stops being a marker: the line falls through to the paragraph
    // branch below, where its `>` characters render as the visible text they
    // already are. Nothing is dropped, and nothing recurses.
    if (depth < MAX_BLOCK_DEPTH && /^&gt;\s?/.test(trimmed)) {
      flushPara();
      const inner: string[] = [];
      while (i < lines.length && /^&gt;\s?/.test(lines[i].trim())) {
        inner.push(lines[i].trim().replace(/^&gt;\s?/, ''));
        i += 1;
      }
      out.push(`<blockquote>${renderBlocks(inner, options, depth + 1)}</blockquote>`);
      continue;
    }

    if (trimmed.includes('|') && isTableSeparator(lines[i + 1])) {
      flushPara();
      const table = renderTable(lines, i, options);
      out.push(table.html);
      i = table.next;
      continue;
    }

    if (listAt(raw)) {
      flushPara();
      const list = renderList(lines, i, options, depth + 1);
      out.push(list.html);
      i = list.next;
      continue;
    }

    para.push(trimmed);
    i += 1;
  }

  flushPara();
  return out.join('');
}

/** Render a markdown document to a safe HTML string. */
export function renderMarkdown(src: string, options: RenderMarkdownOptions = {}): string {
  const normalized = (src || '').replace(/\r\n/g, '\n');
  return renderBlocks(escapeHtml(normalized).split('\n'), options, 0);
}
