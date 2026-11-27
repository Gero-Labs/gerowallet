/**
 * "expires in 6 d", "invited 2 h ago": the short relative times of the invitation screens (UX
 * rule 4: expiry is always visible). Returns an i18n key and its count; the screen translates.
 */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface RelativeTime {
  readonly key: string;
  readonly n: number;
}

function unit(ms: number): { suffix: 'Days' | 'Hours' | 'Minutes'; n: number } {
  if (ms >= DAY) return { suffix: 'Days', n: Math.floor(ms / DAY) };
  if (ms >= HOUR) return { suffix: 'Hours', n: Math.floor(ms / HOUR) };
  return { suffix: 'Minutes', n: Math.max(1, Math.ceil(ms / MINUTE)) };
}

/** Time left until `at`: `gerovault.invite.time.inDays` etc., or `expired`. */
export function timeLeft(at: number, now: number): RelativeTime {
  if (at <= now) return { key: 'gerovault.invite.time.expired', n: 0 };
  const { suffix, n } = unit(at - now);
  return { key: `gerovault.invite.time.in${suffix}`, n };
}

/** Time since `at`: `gerovault.invite.time.agoDays` etc., or `justNow` under a minute. */
export function timeAgo(at: number, now: number): RelativeTime {
  if (now - at < MINUTE) return { key: 'gerovault.invite.time.justNow', n: 0 };
  const { suffix, n } = unit(now - at);
  return { key: `gerovault.invite.time.ago${suffix}`, n };
}

/** `m:ss` left on a one-time QR. */
export function countdown(at: number, now: number): string {
  const s = Math.max(0, Math.ceil((at - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Every key the helpers above can return, for the catalog spec. */
export const TIME_KEYS: readonly string[] = [
  'gerovault.invite.time.expired',
  'gerovault.invite.time.justNow',
  ...['Days', 'Hours', 'Minutes'].flatMap(s => [`gerovault.invite.time.in${s}`, `gerovault.invite.time.ago${s}`]),
];
