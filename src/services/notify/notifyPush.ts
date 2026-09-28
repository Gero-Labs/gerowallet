// Push notifications — the `push` and `notificationclick` handlers (background).
//
// Handover B3, B4, B5, B8. Runs on a push wake with NO dependency on login or
// unlock: everything it needs comes from chrome.storage (the notify store, the wallet
// list, the locale). It never returns without a displayed notification (contract
// §6.7 rule 1), it makes no network call apart from queuing the self-heal DELETE
// for an unknown wallet tag, and it uses `registration.showNotification` (B5), with
// `tag = e` and `renotify: false` so a repeated `e` replaces quietly (rule 6).
//
// B8: before showing, the worker asks every open extension page (NOTIFY_PRESENT,
// 250 ms). A page that is visible AND focused renders the in-app toast and answers
// `{ shown: true }`; the system notification is then shown silently, and closed
// when the page reports NOTIFY_TOAST_SHOWN. Otherwise the normal, audible one.
// B0 showed Chrome raises no generic notification on its own, so no case skips it.
//
// Dependencies are injected for the unit tests; notifyBackground.ts binds them.

import { parsePushPayload } from './notifyPayload';
import { renderPush, routeFor, type NotificationData, type RenderedPush, type RouteIntent } from './notifyRender';
import type { NotifyStore } from './notifyStore';

export interface ToastRequest {
  e: string;
  title: string;
  body: string;
  route: RouteIntent;
  walletId: number | null;
}

export interface NotifyPushDeps {
  store: NotifyStore;
  showNotification: (title: string, options: NotificationOptions & { data: NotificationData; tag: string; silent: boolean; renotify: boolean; requireInteraction: boolean; timestamp: number; icon: string }) => Promise<void>;
  closeNotifications: (tag: string) => Promise<void>;
  /** NOTIFY_PRESENT to the open pages; resolves true when one rendered a toast (within 250 ms). */
  presentToPages: (request: ToastRequest) => Promise<boolean>;
  locale: () => Promise<string>;
  walletName: (walletId: number) => Promise<string>;
  loggedWalletId: () => Promise<number | null>;
  /** Focus or open the dashboard on this route (B4). */
  openDashboard: (route: RouteIntent) => Promise<void>;
  iconUrl: string;
  now?: () => number;
  log?: (message: string) => void;
}

export interface NotifyPushHandlers {
  handlePush(text: string | null): Promise<RenderedPush>;
  handleNotificationClick(notification: { data?: unknown; tag?: string; close(): void }): Promise<RouteIntent>;
  /** NOTIFY_TOAST_SHOWN: the page's toast closed, so the silent system notification can go. */
  toastShown(e: string): Promise<void>;
}

export function createNotifyPushHandlers(deps: NotifyPushDeps): NotifyPushHandlers {
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? (() => undefined);

  async function walletFor(w: string): Promise<{ walletId: number; name: string } | null> {
    if (!w) return null;
    const wallets = await deps.store.getWallets();
    const entry = Object.entries(wallets).find(([, s]) => s.walletTag === w);
    if (!entry) return null;
    const walletId = Number(entry[0]);
    return { walletId, name: await deps.walletName(walletId) };
  }

  return {
    async handlePush(text) {
      const parsed = parsePushPayload(text ?? '');
      const wallet = parsed.ok ? await walletFor(parsed.payload.w) : null;
      const rendered = renderPush({ parsed, wallet, locale: await deps.locale(), now: now() });
      if (rendered.unknownWalletTag) {
        // Rule 5: heal the server; the DELETE itself runs on the next re-assertion (no network here).
        await deps.store.enqueueDelete({ kind: 'wallet', walletTag: rendered.unknownWalletTag, enqueuedAt: now() });
        log(`push for unknown wallet tag ${rendered.unknownWalletTag.slice(0, 8)}: generic text, DELETE queued`);
      }
      const repeat = await deps.store.markSeen(rendered.tag, now());
      // The in-app notification centre (the bell) keeps what was shown, unread until opened there or clicked.
      await deps.store.addInbox({
        e: rendered.tag, t: rendered.data.t, c: rendered.data.c, d: rendered.data.d, ...(rendered.data.x ? { x: rendered.data.x as Record<string, unknown> } : {}),
        walletId: rendered.data.walletId, walletName: wallet?.name ?? null, title: rendered.title, body: rendered.body,
        ts: rendered.timestamp, readAt: null, needsYou: rendered.requireInteraction,
      });
      let toastShown = false;
      try {
        toastShown = await deps.presentToPages({ e: rendered.tag, title: rendered.title, body: rendered.body, route: rendered.route, walletId: rendered.data.walletId });
      } catch (e) { log(`NOTIFY_PRESENT failed: ${String(e)}`); }
      await deps.showNotification(rendered.title, {
        body: rendered.body,
        icon: deps.iconUrl,
        tag: rendered.tag,
        renotify: false,
        silent: toastShown,
        requireInteraction: rendered.requireInteraction,
        timestamp: rendered.timestamp,
        data: rendered.data,
      });
      log(`push shown: t=${rendered.data.t || '?'} degraded=${rendered.data.degraded} toast=${toastShown} repeat=${repeat}`);
      return rendered;
    },

    async handleNotificationClick(notification) {
      notification.close();
      const data = (notification.data && typeof notification.data === 'object' ? notification.data : {}) as Partial<NotificationData>;
      if (typeof data.e === 'string') await deps.store.markInboxRead(data.e, now());
      const route = routeFor(data.d ?? 'home', data.x, data.degraded === 'none');
      // B4: a notification about a wallet that is not the open one never switches by itself.
      const logged = await deps.loggedWalletId();
      if (typeof data.walletId === 'number' && logged !== null && data.walletId !== logged) {
        await deps.store.setPendingOpen({ walletId: data.walletId, d: data.d ?? 'home', ...(data.x ? { x: data.x as Record<string, unknown> } : {}), at: now() });
        await deps.openDashboard({ dashboard: '/', sidepanel: '/' });
        return { dashboard: '/', sidepanel: '/' };
      }
      await deps.openDashboard(route);
      return route;
    },

    async toastShown(e) {
      await deps.closeNotifications(e);
    },
  };
}
