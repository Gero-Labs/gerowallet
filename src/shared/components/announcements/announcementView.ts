// What the announcement components share: the icon and tone of an announcement, and where its one
// action may lead.
//
// The action is the part a hostile document would aim at, so nothing here follows a path the
// document supplies. `actionRoute` is a KEY, looked up in the fixed map below; an unknown key is no
// action at all. No key leads to a flow that moves funds or grants access (send, sign, swap
// confirmation, dApp connect), and none carries a query the document chose. `actionUrl` passed the
// signed rules already (https, one of Gero's sites) and is checked against them again here.

import i18n, { getLocaleCode } from '@/plugins/i18n';
import { ALLOWED_URL, type AnnouncementDocument } from '@/services/announcements/announcementRules';
import type { StoredAnnouncement } from '@/services/announcements/announcementStore';

export type AnnouncementTone = 'neutral' | 'warning' | 'error';
export type AnnouncementSurface = 'dashboard' | 'sidepanel';

/**
 * Severity is never carried by colour alone. A toned element also has its own icon shape (iconOf:
 * an octagon for critical, a triangle for a warning) and the severity as a word, visible in the
 * dialog and read out by a screen reader in the bell and the snackbar.
 */
export function toneOf(item: StoredAnnouncement): AnnouncementTone {
  if (item.document.severity === 'critical') return 'error';
  return item.document.severity === 'warning' ? 'warning' : 'neutral';
}

const ICONS: Readonly<Record<string, string>> = {
  service: 'mdi-information-outline',
  product: 'mdi-creation-outline',
  news: 'mdi-newspaper-variant-outline',
};

/** The severity's shape when there is one to signal, else the kind's. */
export function iconOf(item: StoredAnnouncement): string {
  if (item.document.severity === 'critical') return 'mdi-alert-octagon-outline';
  if (item.document.severity === 'warning') return 'mdi-alert-outline';
  return ICONS[item.document.kind] ?? 'mdi-bell-outline';
}

/** The token colour of a tone, for an icon. */
export function toneColor(tone: AnnouncementTone): string {
  return tone === 'error' ? 'var(--g-error)' : tone === 'warning' ? 'var(--g-warning)' : 'var(--g-text-1)';
}

interface RouteTarget {
  /** The dashboard path. Fixed here: the document supplies neither a path nor a query. */
  dashboard: string;
  /** The side panel's own page for it, or null when only the dashboard has one. */
  sidepanel: string | null;
  label: string;
  /** The label when the side panel hands over to the dashboard. */
  labelInDashboard?: string;
}

/** Every in-app destination an announcement may offer. Adding one is a reviewed change. */
export const ANNOUNCEMENT_ROUTES: ReadonlyMap<string, RouteTarget> = new Map<string, RouteTarget>([
  ['/', { dashboard: '/', sidepanel: '/', label: 'announce.action.home' }],
  ['/staking', { dashboard: '/staking', sidepanel: '/staking', label: 'announce.action.staking' }],
  ['/transactions', { dashboard: '/transactions', sidepanel: '/activity', label: 'announce.action.transactions' }],
  ['/governance', { dashboard: '/governance', sidepanel: null, label: 'announce.action.governance', labelInDashboard: 'announce.action.governanceInDashboard' }],
  ['/swap', { dashboard: '/swap', sidepanel: null, label: 'announce.action.swap', labelInDashboard: 'announce.action.swapInDashboard' }],
  ['/collectibles', { dashboard: '/?view=collectibles', sidepanel: null, label: 'announce.action.collectibles', labelInDashboard: 'announce.action.collectiblesInDashboard' }],
]);

export type ResolvedAction =
  /** `handOver`: the side panel has no such page, so the dashboard opens on `path`. */
  | { type: 'route'; path: string; labelKey: string; handOver: boolean }
  | { type: 'url'; url: string; host: string };

/** The one action of this document on this surface, or null: then Close is the only button. */
export function resolveAction(document: Pick<AnnouncementDocument, 'actionRoute' | 'actionUrl'>, surface: AnnouncementSurface): ResolvedAction | null {
  if (document.actionRoute !== null) {
    const target = ANNOUNCEMENT_ROUTES.get(document.actionRoute);
    if (!target) return null;
    if (surface === 'dashboard') return { type: 'route', path: target.dashboard, labelKey: target.label, handOver: false };
    if (target.sidepanel !== null) return { type: 'route', path: target.sidepanel, labelKey: target.label, handOver: false };
    return { type: 'route', path: target.dashboard, labelKey: target.labelInDashboard ?? target.label, handOver: true };
  }
  const url = document.actionUrl;
  if (url === null || !ALLOWED_URL.test(url)) return null;
  try {
    return { type: 'url', url, host: new URL(url).host };
  } catch {
    return null;
  }
}

/** Open one of Gero's own pages in a new tab. Anything else is refused, whoever asks. */
export function openGeroUrl(url: string | null): boolean {
  if (!url || !ALLOWED_URL.test(url)) return false;
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}

/**
 * 10 Nov 2026 in the app's language (not the browser's), with the time for a service notice, where
 * "how long ago did Gero say this" matters.
 */
export function announcementDate(ts: number, withTime = false): string {
  return new Date(ts).toLocaleString(getLocaleCode(String(i18n.locale)), {
    day: 'numeric', month: 'short', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}
