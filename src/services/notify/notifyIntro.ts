// Push notifications — the offer to turn them on (the "intro").
//
// Notifications cannot be switched on silently: a wallet link carries a proof signed
// with the wallet's stake key, which needs the user's spending auth (§3.7). So "on by
// default" is an offer made proactively instead of a switch buried in Settings: a
// system notification once, when the extension updates, and an in-app prompt on the
// dashboard for each eligible wallet that is not linked yet. Both lead to
// Settings > Notifications, where one confirmation turns the browser and the open
// wallet on together (notifyRegistration.enableWallet).
//
// Pure: the gates shared by the worker (system notification) and the page (prompt).
// The state lives in chrome.storage.local `notifyIntro` (notifyStore); only the worker
// writes it (NOTIFY_INTRO_ANSWER), the page mirrors it.

import type { NotifyConfig } from './notifyTypes';

export interface NotifyIntroState {
  /** When the worker showed the system notification after an update: once per install. */
  systemShownAt: number | null;
  /** "Not now": no automatic offer again on this install. The Settings switches remain. */
  dismissedAt: number | null;
  /** Wallets whose prompt was answered "Turn on", by local wallet id: never prompted again. */
  offered: Record<string, number>;
}

export const NOTIFY_INTRO_KEY = 'notifyIntro';

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A stored value of any shape to a complete state; unknown or corrupt fields fall back to "never". */
export function readIntroState(v: unknown): NotifyIntroState {
  if (!isObject(v)) return { systemShownAt: null, dismissedAt: null, offered: {} };
  const offered: Record<string, number> = {};
  if (isObject(v['offered'])) {
    for (const [id, at] of Object.entries(v['offered'])) if (typeof at === 'number') offered[id] = at;
  }
  return {
    systemShownAt: typeof v['systemShownAt'] === 'number' ? v['systemShownAt'] : null,
    dismissedAt: typeof v['dismissedAt'] === 'number' ? v['dismissedAt'] : null,
    offered,
  };
}

/** Push can work here at all: the browser has a push manager and the server serves the feature. */
export function notifyServiceAvailable(pushSupported: boolean, config: NotifyConfig | null): boolean {
  return pushSupported && !!config && config.enabled && !!config.vapidPublicKey && !!config.vapidKid;
}

export interface IntroWallet {
  id: number;
  /** Could be registered at all on this side (a Normal Cardano software wallet on a known network). */
  eligible: boolean;
  /** Wire network (`cardano-mainnet`, …): offered only when the server lists it in `/config.networks`. */
  network: string;
  /** Has a link on the server already. */
  registered: boolean;
}

/** Eligible here AND served there: an offer for a network the server rejects would end in `unsupported_network` after the auth step. */
function canBeLinked(w: Pick<IntroWallet, 'eligible' | 'network'>, config: NotifyConfig): boolean {
  return w.eligible && config.networks.includes(w.network);
}

/**
 * The in-app prompt for the open wallet: push available, not dismissed on this install,
 * the wallet linkable, not linked, and not already answered "Turn on".
 */
export function promptWanted(input: { intro: NotifyIntroState; pushSupported: boolean; config: NotifyConfig | null; wallet: IntroWallet | null }): boolean {
  const { config } = input;
  if (!config || !notifyServiceAvailable(input.pushSupported, config)) return false;
  if (input.intro.dismissedAt !== null) return false;
  const w = input.wallet;
  if (!w || w.registered || !canBeLinked(w, config)) return false;
  return !(String(w.id) in input.intro.offered);
}

/**
 * The system notification after an update: once per install, only while no wallet is
 * linked yet (early adopters are not told about what they already use) and some wallet
 * could be.
 */
export function systemIntroWanted(input: { intro: NotifyIntroState; pushSupported: boolean; config: NotifyConfig | null; wallets: Array<Pick<IntroWallet, 'eligible' | 'network' | 'registered'>> }): boolean {
  const { config } = input;
  if (!config || !notifyServiceAvailable(input.pushSupported, config)) return false;
  if (input.intro.dismissedAt !== null || input.intro.systemShownAt !== null) return false;
  if (input.wallets.some((w) => w.registered)) return false;
  return input.wallets.some((w) => canBeLinked(w, config));
}
