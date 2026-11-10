// A seam between the announcement engine and the two places that call it from outside the
// notification wiring: the Gero Sync socket (walletManager) and the push handler (notifyPush).
// Both import this file instead of the engine, so neither pulls the engine's dependencies into its
// own graph. notifyBackground binds the real functions; until then both do nothing.

import type { StoredAnnouncement } from './announcementStore';

export const announcementHooks: {
  /** The `ANNOUNCEMENTS` socket frame: the feed's version number. */
  feedChanged: (seq: unknown) => void;
  /** The verified announcement a push names, or null when it cannot be had in time. */
  forPush: (aid: unknown) => Promise<StoredAnnouncement | null>;
} = {
  feedChanged: () => undefined,
  forPush: async () => null,
};
