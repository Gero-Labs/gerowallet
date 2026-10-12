import i18n from '@/plugins/i18n';
import { helpLocale } from '@/api/help.api';
import { debugLog } from '@/utils/debug';
import type { HelpChain } from './helpContent';

/**
 * Anonymous Help Center usage counters (gero-backend `POST /api/help/events`).
 *
 * Each event says only WHAT happened (type + one allow-listed subject), on which surface, in which
 * language and under which chain filter. There is no wallet id, address, device id, session id,
 * query text, timestamp or any other identifier; the backend keeps daily counters, not events.
 *
 * Fire and forget: nothing here throws, retries, persists or logs to the console, and a failure never
 * reaches the person using the wallet. Nothing is sent at all when the browser signals Do Not Track
 * or Global Privacy Control, when no backend is configured, or outside a browser page.
 */

export type HelpSurface = 'help' | 'welcome';
type HelpEventLocale = 'en-US' | 'de-DE' | 'es-ES';

const SEARCH = ['results', 'empty'] as const;
const HOME_CLICK = ['most_viewed', 'latest_tutorial', 'blog', 'x_gero', 'x_nexus', 'ecosystem_news', 'topic', 'all_answers', 'all_updates', 'all_posts', 'all_tutorials'] as const;
const UPDATE_SOURCES = ['gero-blog', 'cardano-news', 'midnight-news', 'bitcoin-news', 'gero-x', 'nexus-x'] as const;
const UPDATES_FILTER = ['all', 'ecosystem-news', ...UPDATE_SOURCES] as const;
const SUPPORT_OPEN = ['eligible', 'noWallets', 'locked', 'syncing', 'ineligible', 'disabled'] as const;
const SUPPORT_EMAIL = ['dialog', 'widget', 'welcome', 'reader'] as const;
const SUPPORT_EMAIL_COPIED = ['dialog', 'widget', 'welcome'] as const;
const WELCOME_OPEN = ['saved', 'new', 'setup'] as const;
const CHAINS = ['all', 'cardano', 'midnight', 'bitcoin'] as const;
const SURFACES = ['help', 'welcome'] as const;

export type SearchSubject = (typeof SEARCH)[number];
export type HomeClickSubject = (typeof HOME_CLICK)[number];
export type UpdateOpenSubject = (typeof UPDATE_SOURCES)[number];
export type UpdatesFilterSubject = (typeof UPDATES_FILTER)[number];
export type SupportOpenSubject = (typeof SUPPORT_OPEN)[number];
export type SupportEmailSubject = (typeof SUPPORT_EMAIL)[number];
export type SupportEmailCopiedSubject = (typeof SUPPORT_EMAIL_COPIED)[number];
export type WelcomeOpenSubject = (typeof WELCOME_OPEN)[number];

/** What happened. Every type carries exactly the subjects the contract allows for it. */
export type HelpEventInput =
  | { type: 'article_view' | 'article_helpful_yes' | 'article_helpful_no'; subject: string }
  | { type: 'search'; subject: SearchSubject }
  | { type: 'home_click'; subject: HomeClickSubject }
  | { type: 'updates_filter'; subject: UpdatesFilterSubject }
  | { type: 'update_open'; subject: UpdateOpenSubject }
  | { type: 'support_open'; subject: SupportOpenSubject }
  | { type: 'support_email'; subject: SupportEmailSubject }
  | { type: 'support_email_copied'; subject: SupportEmailCopiedSubject }
  | { type: 'welcome_open'; subject: WelcomeOpenSubject }
  | { type: 'support_chat_started' | 'welcome_open_full'; subject?: undefined };
export type HelpEvent = HelpEventInput & { surface: HelpSurface; chain?: HelpChain };

/** An article id: a published guide's id or one of the bundled answer ids. The backend keeps the exact list. */
const ARTICLE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const SUBJECTS = new Map<string, ReadonlySet<string> | RegExp | null>([
  ['article_view', ARTICLE_ID], ['article_helpful_yes', ARTICLE_ID], ['article_helpful_no', ARTICLE_ID],
  ['search', new Set(SEARCH)], ['home_click', new Set(HOME_CLICK)], ['updates_filter', new Set(UPDATES_FILTER)],
  ['update_open', new Set(UPDATE_SOURCES)], ['support_open', new Set(SUPPORT_OPEN)],
  ['support_chat_started', null], ['support_email', new Set(SUPPORT_EMAIL)], ['support_email_copied', new Set(SUPPORT_EMAIL_COPIED)],
  ['welcome_open', new Set(WELCOME_OPEN)], ['welcome_open_full', null],
]);

interface WireEvent { type: string; surface: HelpSurface; locale: HelpEventLocale; chain: HelpChain; subject?: string }

/** The backend accepts 1-25 events per request. */
const MAX_BATCH = 25;
const QUIET_MS = 2000;
const queue: WireEvent[] = [];
// article_view counts once per surface and article for as long as the page lives.
const viewed = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;
let listening = false;

function endpoint(): string | null {
  const base: unknown = import.meta.env['VITE_BACKEND_URL'];
  if (typeof base !== 'string' || !base) return null;
  try {
    const { protocol } = new URL(base);
    if (protocol !== 'https:' && protocol !== 'http:') return null;
  } catch { return null; }
  return `${base.replace(/\/+$/, '')}/api/help/events`;
}

function optedOut(): boolean {
  const privacy = navigator as Navigator & { globalPrivacyControl?: boolean };
  return privacy.doNotTrack === '1' || privacy.globalPrivacyControl === true;
}

function available(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined' && typeof navigator !== 'undefined' && typeof fetch === 'function';
}

function toWire(event: HelpEvent): WireEvent | null {
  const rule = SUBJECTS.get(event.type);
  if (rule === undefined || !(SURFACES as readonly string[]).includes(event.surface)) return null;
  const subject: unknown = event.subject;
  if (rule !== null && (typeof subject !== 'string' || !(rule instanceof RegExp ? rule.test(subject) : rule.has(subject)))) return null;
  const chain = (CHAINS as readonly string[]).includes(event.chain ?? 'all') ? event.chain ?? 'all' : 'all';
  const wire: WireEvent = { type: event.type, surface: event.surface, locale: helpLocale(i18n.locale) as HelpEventLocale, chain };
  if (rule !== null) wire.subject = subject as string;
  return wire;
}

function send(url: string, events: WireEvent[]): void {
  try {
    void Promise.resolve(fetch(url, {
      method: 'POST', keepalive: true, credentials: 'omit',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events }),
    })).catch(() => { debugLog('help analytics: batch not delivered'); });
  } catch { debugLog('help analytics: batch not sent'); }
}

/** Sends everything queued, in batches the backend accepts. The page calls this when it is hidden. */
export function flushHelpEvents(): void {
  clearTimeout(timer);
  timer = undefined;
  const events = queue.splice(0, queue.length);
  if (!events.length) return;
  try {
    const url = available() && !optedOut() ? endpoint() : null;
    if (!url) return;
    for (let start = 0; start < events.length; start += MAX_BATCH) send(url, events.slice(start, start + MAX_BATCH));
  } catch { debugLog('help analytics: flush failed'); }
}

function flushWhenHidden(): void {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') flushHelpEvents();
}

function listen(): void {
  if (listening) return;
  listening = true;
  document.addEventListener('visibilitychange', flushWhenHidden);
  window.addEventListener('pagehide', flushHelpEvents);
}

/** Counts one anonymous Help Center event. Never throws and never waits for the network. */
export function trackHelp(event: HelpEvent): void {
  try {
    if (!available() || optedOut() || !endpoint()) return;
    const wire = toWire(event);
    if (!wire) return;
    if (wire.type === 'article_view') {
      const key = `${wire.surface}:${wire.subject}`;
      if (viewed.has(key)) return;
      viewed.add(key);
    }
    queue.push(wire);
    listen();
    clearTimeout(timer);
    if (queue.length >= MAX_BATCH) flushHelpEvents();
    else timer = setTimeout(flushHelpEvents, QUIET_MS);
  } catch { debugLog('help analytics: event dropped'); }
}
