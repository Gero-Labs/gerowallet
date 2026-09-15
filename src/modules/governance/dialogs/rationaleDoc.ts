/**
 * Fetch a CIP-136 vote rationale and say how far it can be trusted.
 *
 * ## What the hash proves, and what the dialog does with it
 *
 * The anchor on a vote is a PAIR: a URL and a blake2b-256 of the bytes at that
 * URL, both recorded on chain. The URL is author-controlled and its host is not,
 * so bytes that come back are worth nothing on their own — the hash is what ties
 * them to the vote. This module hashes the RAW BYTES exactly as `cip119.ts`
 * describes for DRep anchors: the octets as downloaded, never a re-serialized or
 * canonicalized form.
 *
 * The document is shown either way; the hash decides what the wallet SAYS about
 * it. A verified document gets a green banner. Two kinds of doubt keep the text
 * but flag it amber, because a reader who clicked "Read why" is better served by
 * the words plus a warning than by a warning alone:
 *
 *  - `mismatch` — the document at the link is NOT the one that was voted on. It
 *    may have been edited after the vote, and the banner says so. The wallet
 *    does not vouch for it.
 *  - `unverifiable` — no on-chain hash reached us, so there is nothing to check
 *    against. Same banner: shown, not vouched for.
 *
 * None of that is an XSS question: every byte goes through `renderMarkdown`'s
 * escaping (or Vue text interpolation, for the JSON fallback) before it reaches
 * the DOM, whatever the hash said.
 *
 * Three failures produce no text at all, kept apart because the dialog says
 * something different about each:
 *
 *  - `oversize` — past {@link MAX_RATIONALE_BYTES}. The URL is attacker-chosen,
 *    so the response size is attacker-chosen; the cap is checked against the
 *    declared length AND against what actually arrived.
 *  - `network` — offline, refused, aborted at {@link RATIONALE_TIMEOUT_MS}, or
 *    blocked by the extension's `connect-src` allowlist (an author's own host is
 *    not on it; IPFS anchors go through gero-backend's proxy, which is). All of
 *    those are the same fact to a reader: the wallet could not get the file, and
 *    the browser can.
 *  - `empty` — the file arrived and carries nothing to show.
 *
 * Nothing here touches the DOM and the fetch is injectable, so the whole
 * decision table is testable without a network.
 */

import { anchorHashOfBytes } from '@/shared/utils/cip119';
import { toInAppUrl } from '@/modules/governance/utils/govAnchor';

/** Give up on a third-party host after this long. */
export const RATIONALE_TIMEOUT_MS = 10_000;

/**
 * Hard ceiling on the document. Real rationales are a few kilobytes of prose;
 * this leaves three orders of magnitude of headroom and still bounds what a
 * hostile anchor can make the extension hold in memory and hash.
 */
export const MAX_RATIONALE_BYTES = 512 * 1024;

/** Why no text is being shown. Each maps to its own line of copy. */
export type RationaleFailure = 'oversize' | 'network' | 'empty';

/** Why text IS shown but not vouched for. Each maps to its own banner. */
export type RationaleDoubt = 'mismatch' | 'unverifiable';

/** One labelled block of the document, in the order CIP-136 lists them. */
export interface RationaleSection {
  /** i18n key for the heading, or null for a document with no known structure. */
  labelKey: string | null;
  /**
   * `prose` is raw markdown, to be rendered ONLY through `renderMarkdown`.
   * `json` is the pretty-printed document itself, for one that parses but
   * carries none of the CIP-136 prose fields — rendered as text, never as HTML.
   */
  kind: 'prose' | 'json';
  text: string;
}

export type RationaleResult =
  | { status: 'verified'; sections: RationaleSection[]; hash: string }
  | { status: 'unverified'; reason: RationaleDoubt; sections: RationaleSection[]; hash: string }
  | { status: 'failed'; reason: RationaleFailure };

/**
 * CIP-136 body fields worth showing, in reading order, with the heading each
 * gets. `comment` is CIP-100's generic field and comes first because a document
 * that carries one usually carries nothing else.
 */
const SECTION_FIELDS: ReadonlyArray<readonly [string, string | null]> = [
  ['comment', null],
  ['summary', 'dashboard.summary'],
  ['rationaleStatement', 'governance.rationale'],
  ['precedentDiscussion', 'governance.rationalePrecedent'],
  ['counterargumentDiscussion', 'governance.rationaleCounterargument'],
  ['conclusion', 'governance.rationaleConclusion'],
];

/** CIP metadata values are sometimes bare strings, sometimes JSON-LD `{'@value': …}`. */
function cipValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object' && '@value' in (value as object)) {
    const inner = (value as Record<string, unknown>)['@value'];
    return typeof inner === 'string' ? inner.trim() : '';
  }
  return '';
}

/** A parsed document with anything in it at all — `{}`, `[]` and scalars are not. */
function hasContent(parsed: unknown): boolean {
  if (Array.isArray(parsed)) return parsed.length > 0;
  return !!parsed && typeof parsed === 'object' && Object.keys(parsed as object).length > 0;
}

/**
 * What to show from the document.
 *
 * A document that does not parse as JSON is still returned as ONE unlabelled
 * prose section rather than discarded: it is what sits at the voter's anchor,
 * and `renderMarkdown` escapes every byte of it before anything reaches the
 * DOM. One that parses but carries none of the CIP-136 prose fields comes back
 * pretty-printed as a single `json` section: an anchor is by definition a JSON
 * document, and "the shape surprised us" must not read as "nothing here".
 * Refusing to show a document because of its shape would hide the voter's own
 * words.
 */
export function extractRationaleSections(raw: string): RationaleSection[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const text = raw.trim();
    return text ? [{ labelKey: null, kind: 'prose', text }] : [];
  }

  const root = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  const inner = root['body'];
  const body = inner && typeof inner === 'object' ? (inner as Record<string, unknown>) : root;

  const sections: RationaleSection[] = [];
  for (const [field, labelKey] of SECTION_FIELDS) {
    const text = cipValue(body[field]);
    if (text) sections.push({ labelKey, kind: 'prose', text });
  }
  if (sections.length === 0 && hasContent(parsed)) {
    sections.push({ labelKey: null, kind: 'json', text: JSON.stringify(parsed, null, 2) });
  }
  return sections;
}

export interface LoadRationaleOptions {
  /** The vote's `meta_url`. http(s) or ipfs. */
  url: unknown;
  /** The vote's `meta_hash` — 64 hex characters, or verification cannot run. */
  hash: unknown;
  /** Injectable for tests. Defaults to the ambient `fetch`. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

function failed(reason: RationaleFailure): RationaleResult {
  return { status: 'failed', reason };
}

/**
 * Fetch, extract, verify. Never throws: every path returns a result the dialog
 * can render, because a rejected promise here would surface as an unhandled
 * error on a page the user opened by clicking a link.
 */
export async function loadRationale(options: LoadRationaleOptions): Promise<RationaleResult> {
  const target = toInAppUrl(options.url);
  if (!target) return failed('network');

  // Nothing to check against is NOT "probably fine": the document is still
  // fetched and shown, but it is flagged, never vouched for.
  const expected = String(options.hash ?? '').trim().toLowerCase();
  const verifiable = /^[0-9a-f]{64}$/.test(expected);

  const maxBytes = options.maxBytes ?? MAX_RATIONALE_BYTES;
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  if (typeof doFetch !== 'function') return failed('network');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? RATIONALE_TIMEOUT_MS);

  try {
    const response = await doFetch(target, {
      signal: controller.signal,
      // No cookies, no cached copy, no redirect the author did not publish.
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
    });
    if (!response?.ok) return failed('network');

    // Cheap refusal before anything is buffered. A lying Content-Length is
    // caught by the byte check below, so this is an optimisation, not the bound.
    const declared = Number(response.headers?.get?.('content-length') ?? NaN);
    if (Number.isFinite(declared) && declared > maxBytes) return failed('oversize');

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) return failed('oversize');
    if (bytes.byteLength === 0) return failed('empty');

    const sections = extractRationaleSections(new TextDecoder('utf-8').decode(bytes));
    if (sections.length === 0) return failed('empty');

    // The bytes as downloaded — the only form the on-chain hash is over.
    const hash = anchorHashOfBytes(bytes);
    if (!verifiable) return { status: 'unverified', reason: 'unverifiable', sections, hash };
    if (hash !== expected) return { status: 'unverified', reason: 'mismatch', sections, hash };
    return { status: 'verified', sections, hash };
  } catch {
    // Aborted, offline, CORS, CSP: one fact for the reader either way.
    return failed('network');
  } finally {
    clearTimeout(timer);
  }
}
