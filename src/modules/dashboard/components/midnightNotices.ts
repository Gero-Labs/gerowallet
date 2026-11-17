/**
 * Which Midnight notices the slot above the balance shows (MidnightNoticeSlot.vue).
 *
 * At a network cutover several can apply at once; stacked, they push the
 * balance and Send off a 360px side panel. The slot shows at most
 * {@link MAX_NOTICES}, in this order: what the user must do first, then what
 * explains the screen, then the rest.
 */

/** Every notice the slot knows, highest precedence first. */
export const MIDNIGHT_NOTICE_ORDER = ['update', 'upgrade', 'refreshing', 'notIncluded', 'stagenet'] as const;

export type MidnightNoticeId = (typeof MIDNIGHT_NOTICE_ORDER)[number];

/** The most notices shown at once. */
export const MAX_NOTICES = 2;

/** The notices to show, highest precedence first, at most `max`. */
export function visibleMidnightNotices(active: Partial<Record<MidnightNoticeId, boolean>>, max: number = MAX_NOTICES): MidnightNoticeId[] {
  return MIDNIGHT_NOTICE_ORDER.filter((id) => active[id]).slice(0, max);
}
