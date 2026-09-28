// Push notifications — rendering and routing (pure). Handover B3 step 2–6, B4, CONTRACT §6.4, §6.7.
//
// Turns a parsed push into the notification to show and the route a click takes.
// Every path degrades instead of dropping (rule 1): bad JSON or a newer `v` gives
// the generic text, an unknown `t` the category text, an expired push the category
// text with no amounts and no deep link, an unknown wallet the generic text (and the
// caller queues the DELETE). Only strings from push.ts are ever shown (rule 8), with
// `a` and `n` interpolated. The wallet's name appears only when `a` is present,
// which means the user opted into details (open question 10).

import { pushStrings, type PushLocale, type PushStringKey } from '@/plugins/i18n/push';
import type { ParsedPush, PushAmounts, PushPayload } from './notifyPayload';
import { formatAmountShort } from '@/shared/utils/format';

/** What the wallet knows about a native asset by unit: the registry ticker and its decimals. */
export interface TokenInfo {
  ticker?: string;
  decimals?: number;
}
export type TokenLookup = (unit: string) => TokenInfo | undefined;

export interface RenderInput {
  parsed: ParsedPush;
  /** The local wallet `w` maps to, or null when unknown (rule 5). */
  wallet: { walletId: number; name: string } | null;
  locale: string;
  now: number;
  /** Names and scales `a.assets[].unit` from the wallet's own token data (absent in tests and pages). */
  tokenInfo?: TokenLookup;
}

export interface RouteIntent {
  /** Hash route on the dashboard (`index.html#<path>`), query included: `/transactions?tx=<hash>` opens that transaction. */
  dashboard: string;
  /** Hash route on the side panel, or null when the panel has no equivalent. */
  sidepanel: string | null;
  /** Open the settings dialog on this tab after navigating (pairedDevices). */
  settingsTab?: 'security';
  /** Deep-link data kept for later screens (a tx hash for transaction detail). */
  highlight?: { tx?: string; deviceId?: string; drepId?: string };
}

/** What `notificationclick` needs, stored in `Notification.data`. */
export interface NotificationData {
  v: number;
  t: string;
  c: string;
  w: string;
  e: string;
  d: string;
  x?: PushPayload['x'];
  walletId: number | null;
  degraded: 'none' | 'generic' | 'category' | 'expired' | 'unknown_wallet';
}

export interface RenderedPush {
  title: string;
  body: string;
  tag: string;
  requireInteraction: boolean;
  timestamp: number;
  data: NotificationData;
  route: RouteIntent;
  /** Rule 5: queue `DELETE /device/wallets/{w}` for this tag. */
  unknownWalletTag: string | null;
  /** The assets of a receipt, for the icon in the bell and the snackbar. */
  assets?: NotifyAsset[];
}

const CATEGORY_KEY: Record<string, PushStringKey> = {
  funds: 'PUSH_CATEGORY_FUNDS', staking: 'PUSH_CATEGORY_STAKING', swap: 'PUSH_CATEGORY_SWAP', adam: 'PUSH_CATEGORY_ADAM',
  governance: 'PUSH_CATEGORY_GOVERNANCE', remoteSigning: 'PUSH_CATEGORY_REMOTESIGNING', system: 'PUSH_CATEGORY_SYSTEM',
};

const EVENT_KEYS: Record<string, { title: PushStringKey; body: PushStringKey }> = {
  funds: { title: 'PUSH_FUNDS_TITLE', body: 'PUSH_FUNDS_BODY' },
  funds_summary: { title: 'PUSH_FUNDS_SUMMARY_TITLE', body: 'PUSH_FUNDS_SUMMARY_BODY' },
  signwake: { title: 'PUSH_SIGNWAKE_TITLE', body: 'PUSH_SIGNWAKE_BODY' },
  new_device: { title: 'PUSH_NEWDEVICE_TITLE', body: 'PUSH_NEWDEVICE_BODY' },
  reward: { title: 'PUSH_REWARD_TITLE', body: 'PUSH_REWARD_BODY' },
  swap_filled: { title: 'PUSH_SWAP_FILLED_TITLE', body: 'PUSH_SWAP_FILLED_BODY' },
  swap_cancelled: { title: 'PUSH_SWAP_CANCELLED_TITLE', body: 'PUSH_SWAP_CANCELLED_BODY' },
  adam_proposal: { title: 'PUSH_ADAM_TITLE', body: 'PUSH_ADAM_BODY' },
  drep_retired: { title: 'PUSH_DREP_RETIRED_TITLE', body: 'PUSH_DREP_RETIRED_BODY' },
  drep_inactive: { title: 'PUSH_DREP_INACTIVE_TITLE', body: 'PUSH_DREP_INACTIVE_BODY' },
  drep_expiring: { title: 'PUSH_DREP_EXPIRING_TITLE', body: 'PUSH_DREP_EXPIRING_BODY' },
  test: { title: 'PUSH_TEST_TITLE', body: 'PUSH_TEST_BODY' },
};

export function pushLocale(locale: string | undefined): PushLocale {
  return locale === 'de' ? 'de' : 'us';
}

function t(locale: PushLocale, key: PushStringKey, vars: Record<string, string | number> = {}): string {
  return pushStrings[locale][key].replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

/** "12.5 ADA, 250 NIGHT, 2 other tokens" from `a` (already sanitised). */
const TICKER = /^[A-Za-z0-9$._-]{1,12}$/; // a registry ticker the wallet already displays everywhere

/** A raw base-unit quantity as a decimal string: 1500000 with 6 decimals is 1.5. */
export function scaleQuantity(raw: string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals <= 0) return raw;
  const padded = raw.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

/** One asset a push is about, for the icon next to the notification (ADA is the unit `lovelace`). */
export interface NotifyAsset {
  /** Policy id + asset name hex, or `lovelace`; absent when the server sent a symbol only. */
  unit?: string;
  label: string;
}

interface AmountLine {
  label: string;
  /** Already scaled to display units; undefined when the decimals are unknown. */
  qty?: string;
  unit?: string;
}

/** The lines of a receipt the wallet can name: ADA first, then each asset by ticker or symbol. */
function amountLines(a: PushAmounts, tokenInfo?: TokenLookup): { lines: AmountLine[]; other: number } {
  const lines: AmountLine[] = [];
  if (a.ada !== undefined) lines.push({ label: 'ADA', qty: a.ada, unit: 'lovelace' });
  let other = a.otherAssets ?? 0;
  for (const asset of a.assets) {
    const info = asset.unit && tokenInfo ? tokenInfo(asset.unit) : undefined;
    const label = info?.ticker && TICKER.test(info.ticker) ? info.ticker : asset.sym;
    if (!label) { other += 1; continue; }
    const qty = asset.unit ? (typeof info?.decimals === 'number' ? scaleQuantity(asset.qty, info.decimals) : undefined) : asset.qty;
    lines.push({ label, qty, ...(asset.unit ? { unit: asset.unit } : {}) });
  }
  return { lines, other };
}

/** The assets of a receipt, for icons: ADA and every named asset (unit-less ones get a letter tile). */
export function receivedAssets(a: PushAmounts, tokenInfo?: TokenLookup): NotifyAsset[] {
  return amountLines(a, tokenInfo).lines.map((l) => ({ label: l.label, ...(l.unit ? { unit: l.unit } : {}) }));
}

/**
 * "12.5 ADA, 1.5 GERO, 1 other token". Quantities are short (one decimal at most, K/M/B when long).
 * An asset with a unit is named by the wallet's registry ticker when it has one (else the server's
 * symbol) and its raw quantity is shown only once the decimals are known; an asset the wallet
 * cannot name at all is folded into the "other" count.
 */
export function formatAmounts(locale: PushLocale, a: PushAmounts, tokenInfo?: TokenLookup): string {
  const { lines, other } = amountLines(a, tokenInfo);
  const parts = lines.map((l) => {
    const qty = l.qty === undefined ? undefined : formatAmountShort(Number(l.qty));
    if (l.unit === 'lovelace') return t(locale, 'PUSH_AMOUNT_ADA', { ada: qty ?? '' });
    return qty ? `${qty} ${l.label}` : l.label;
  });
  if (other) parts.push(other === 1 ? t(locale, 'PUSH_AMOUNT_OTHER_ONE') : t(locale, 'PUSH_AMOUNT_OTHER', { n: other }));
  return parts.join(t(locale, 'PUSH_AMOUNT_JOIN'));
}

/** §6.4: destination to routes. Unknown `d` means home; `signRequest` and `adam` are home in v1. */
export function routeFor(d: string, x: PushPayload['x'] | undefined, deepLinks: boolean): RouteIntent {
  const highlight = deepLinks && x ? { ...(x.tx ? { tx: x.tx } : {}), ...(x.deviceId ? { deviceId: x.deviceId } : {}), ...(x.drepId ? { drepId: x.drepId } : {}) } : undefined;
  const withHighlight = (r: RouteIntent): RouteIntent => (highlight && Object.keys(highlight).length ? { ...r, highlight } : r);
  switch (d) {
    case 'activity': return withHighlight({ dashboard: highlight?.tx ? `/transactions?tx=${highlight.tx}` : '/transactions', sidepanel: '/activity' });
    case 'staking': return withHighlight({ dashboard: '/staking', sidepanel: '/staking' });
    case 'swapOrders': return withHighlight({ dashboard: '/swap', sidepanel: null });
    case 'governance': return withHighlight({ dashboard: deepLinks && x?.drepId ? `/governance/dreps/${x.drepId}` : '/governance/me', sidepanel: null });
    case 'pairedDevices': return withHighlight({ dashboard: '/', sidepanel: null, settingsTab: 'security' });
    default: return { dashboard: '/', sidepanel: '/' }; // home, signRequest, adam, unknown
  }
}

export function renderPush(input: RenderInput): RenderedPush {
  const locale = pushLocale(input.locale);
  const { parsed } = input;
  const base = (over: Partial<NotificationData>): NotificationData => ({
    v: 1, t: '', c: '', w: '', e: '', d: 'home', walletId: input.wallet?.walletId ?? null, degraded: 'generic', ...over,
  });
  // Rule 2: unparseable or a newer protocol.
  if (parsed.ok === false) {
    const p = parsed.partial;
    const tag = p.e && /^[0-9a-f]{32}$/.test(p.e) ? p.e : `generic-${input.now}`;
    return {
      title: t(locale, 'PUSH_GENERIC_TITLE'), body: t(locale, 'PUSH_GENERIC_BODY'), tag, requireInteraction: false, timestamp: input.now,
      data: base({ e: tag, w: p.w ?? '', t: p.t ?? '', c: p.c ?? '', degraded: 'generic' }),
      route: routeFor('home', undefined, false), unknownWalletTag: null,
    };
  }
  const p = parsed.payload;
  const common = { tag: p.e, timestamp: p.ts || input.now };
  // Rule 5: an unknown wallet tag. Generic text, no route data, and the caller heals the server.
  if (!input.wallet) {
    return {
      ...common, title: t(locale, 'PUSH_GENERIC_TITLE'), body: t(locale, 'PUSH_GENERIC_BODY'), requireInteraction: false,
      data: base({ v: p.v, t: p.t, c: p.c, w: p.w, e: p.e, d: 'home', walletId: null, degraded: 'unknown_wallet' }),
      route: routeFor('home', undefined, false), unknownWalletTag: /^[0-9a-f]{32}$/.test(p.w) ? p.w : null,
    };
  }
  const categoryKey = CATEGORY_KEY[p.c];
  const expired = input.now > p.exp;
  const keys = EVENT_KEYS[p.t];
  // Rule 3 (unknown t) and rule 4 (expired): the category's generic text, else the generic notification.
  if (!keys || expired) {
    const degraded = expired ? 'expired' : 'category';
    const title = keys && expired ? t(locale, keys.title) : t(locale, 'PUSH_GENERIC_TITLE');
    const body = categoryKey ? t(locale, categoryKey) : t(locale, 'PUSH_GENERIC_BODY');
    return {
      ...common, title, body, requireInteraction: false,
      data: base({ v: p.v, t: p.t, c: p.c, w: p.w, e: p.e, d: expired ? p.d : (categoryKey ? p.d : 'home'), walletId: input.wallet.walletId, degraded }),
      route: routeFor(expired || categoryKey ? p.d : 'home', undefined, false), unknownWalletTag: null,
    };
  }
  // The full render: amounts and counts interpolated, details kept for the click.
  let body = t(locale, keys.body);
  if (p.t === 'funds' && p.a) body = t(locale, 'PUSH_FUNDS_BODY_AMOUNT', { amount: formatAmounts(locale, p.a, input.tokenInfo) });
  if (p.t === 'reward' && p.a?.ada !== undefined) body = t(locale, 'PUSH_REWARD_BODY_AMOUNT', { ada: formatAmountShort(Number(p.a.ada)) });
  const assets = (p.t === 'funds' || p.t === 'reward') && p.a ? receivedAssets(p.a, input.tokenInfo) : [];
  if (p.t === 'funds_summary') body = (p.n ?? 0) === 1 ? t(locale, 'PUSH_FUNDS_SUMMARY_BODY_ONE') : t(locale, 'PUSH_FUNDS_SUMMARY_BODY', { n: p.n ?? 0 });
  // The wallet name only when the user opted into details (`a` present).
  const title = p.a ? `${t(locale, keys.title)} · ${input.wallet.name}` : t(locale, keys.title);
  return {
    ...common, title, body, requireInteraction: p.t === 'new_device',
    data: base({ v: p.v, t: p.t, c: p.c, w: p.w, e: p.e, d: p.d, x: p.x, walletId: input.wallet.walletId, degraded: 'none' }),
    route: routeFor(p.d, p.x, true), unknownWalletTag: null, ...(assets.length ? { assets } : {}),
  };
}
