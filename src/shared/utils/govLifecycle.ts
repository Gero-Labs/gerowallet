/**
 * Governance action lifecycle helpers.
 *
 * Epoch arithmetic, plus ONE deliberately approximate calendar conversion
 * (`approxExpiryDate`). There is no exact conversion here and there should not
 * be one: an exact boundary needs a per-network (epoch, startTime) anchor, and a
 * wrong anchor silently shifts every date on the page. What we do have is the
 * epoch COUNT, which is worth a rough date as long as every caller renders it as
 * rough — see that function's contract.
 */

/** A Cardano epoch is 432,000 seconds. */
export const EPOCH_LENGTH_DAYS = 5;

export type StatusTone = 'success' | 'info' | 'warning' | 'neutral';

/** Whole epochs from `currentEpoch` until `expiresEpoch`; 0 once passed. */
export function epochsRemaining(
  currentEpoch: number | null | undefined,
  expiresEpoch: number | null | undefined,
): number | null {
  if (currentEpoch === null || currentEpoch === undefined) return null;
  if (expiresEpoch === null || expiresEpoch === undefined) return null;
  return Math.max(0, expiresEpoch - currentEpoch);
}

/**
 * Approximate days left. This is epochs × 5 — a whole-epoch approximation, not
 * a countdown, because we do not know how far into the current epoch we are.
 * Label it "about N days" in the UI.
 */
export function daysRemaining(
  currentEpoch: number | null | undefined,
  expiresEpoch: number | null | undefined,
): number | null {
  const epochs = epochsRemaining(currentEpoch, expiresEpoch);
  return epochs === null ? null : epochs * EPOCH_LENGTH_DAYS;
}

/**
 * The APPROXIMATE calendar date an action's voting window closes, or null when
 * either epoch is unknown.
 *
 * This is `now + daysRemaining`, and it inherits every limit of the epoch
 * arithmetic above:
 *  - epoch length is treated as a flat 5 days;
 *  - the position WITHIN the current epoch is unknown, so the real boundary
 *    lands up to one epoch EARLIER than this — never later.
 *
 * It is therefore a rough upper bound, not a deadline to plan a signature
 * against. Callers must render it with `governance.approxExpiryDate` (the "≈"
 * carries the approximation) and must never present it as an exact time. An
 * unknown epoch returns null, which renders as no date at all — never as today.
 */
export function approxExpiryDate(
  currentEpoch: number | null | undefined,
  expiresEpoch: number | null | undefined,
  now: Date = new Date(),
): Date | null {
  const days = daysRemaining(currentEpoch, expiresEpoch);
  if (days === null) return null;
  // Calendar arithmetic, not `+ days * 86_400_000`: month lengths and DST
  // shifts are the renderer's problem otherwise, and both move the visible day.
  const date = new Date(now.getTime());
  date.setDate(date.getDate() + days);
  return date;
}

/**
 * The one place an approximate expiry becomes text: `Sep 17, 2026` in the
 * runtime locale. Null in, empty string out, so an unknown epoch cannot become
 * a rendered date anywhere.
 */
export function formatApproxExpiry(date: Date | null): string {
  if (!date) return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Semantic tone for a status pill. Unknown statuses degrade to neutral. */
export function statusTone(status: string | null | undefined): StatusTone {
  switch (String(status ?? '').toLowerCase()) {
    case 'enacted':
    case 'ratified':
      return 'success';
    case 'active':
      return 'info';
    case 'expired':
    case 'dropped':
      return 'neutral';
    default:
      return 'neutral';
  }
}

/** True when an action is still open to votes. */
export function isOpen(status: string | null | undefined): boolean {
  return String(status ?? '').toLowerCase() === 'active';
}
