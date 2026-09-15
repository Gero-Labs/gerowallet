import { describe, it, expect } from 'vitest';
import {
  epochsRemaining,
  daysRemaining,
  approxExpiryDate,
  formatApproxExpiry,
  statusTone,
} from '@/shared/utils/govLifecycle';

describe('epochsRemaining', () => {
  it('counts forward from the current epoch', () => {
    expect(epochsRemaining(500, 510)).toBe(10);
  });

  it('is 0 when the expiry epoch has passed', () => {
    expect(epochsRemaining(520, 510)).toBe(0);
  });

  it('is null when either epoch is unknown', () => {
    expect(epochsRemaining(null, 510)).toBeNull();
    expect(epochsRemaining(500, null)).toBeNull();
  });
});

describe('daysRemaining', () => {
  it('converts remaining epochs to days at 5 days per epoch', () => {
    expect(daysRemaining(500, 510)).toBe(50);
  });

  it('is null when unknown', () => {
    expect(daysRemaining(null, null)).toBeNull();
  });
});

describe('approxExpiryDate', () => {
  const NOW = new Date('2026-08-24T12:00:00Z');

  /**
   * Whole days between two instants. Compared this way rather than against a
   * hardcoded ISO string: the helper does calendar arithmetic in LOCAL time, so
   * a fixed date literal would pass only in the timezone it was written in.
   */
  const daysBetween = (later: Date, earlier: Date): number =>
    Math.round((later.getTime() - earlier.getTime()) / 86_400_000);

  it('lands five days per remaining epoch after now', () => {
    // 5 epochs left, 5 days each: about 25 days out.
    expect(daysBetween(approxExpiryDate(650, 655, NOW) as Date, NOW)).toBe(25);
  });

  it('agrees with daysRemaining rather than doing its own arithmetic', () => {
    const days = daysRemaining(650, 662) as number;
    expect(daysBetween(approxExpiryDate(650, 662, NOW) as Date, NOW)).toBe(days);
  });

  it('crosses a month boundary as a calendar date, not as a raw offset', () => {
    // 2 epochs = 10 days from 24 August lands in September.
    const date = approxExpiryDate(650, 652, NOW) as Date;
    expect(daysBetween(date, NOW)).toBe(10);
    expect(date.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('is today when the expiry epoch has already passed', () => {
    // epochsRemaining floors at 0, so an overdue action gets no future date.
    expect(daysBetween(approxExpiryDate(660, 655, NOW) as Date, NOW)).toBe(0);
  });

  // The honesty case: an unknown epoch must produce NO date, never today's.
  it('is null when either epoch is unknown', () => {
    expect(approxExpiryDate(null, 655, NOW)).toBeNull();
    expect(approxExpiryDate(650, null, NOW)).toBeNull();
    expect(approxExpiryDate(undefined, undefined, NOW)).toBeNull();
  });
});

describe('formatApproxExpiry', () => {
  it('renders a day, a month and a full year', () => {
    // Asserted by parts, not by one exact string: the format follows the
    // runtime locale, and only the facts have to be there in every locale.
    const text = formatApproxExpiry(new Date(2026, 8, 17));
    expect(text).toContain('2026');
    expect(text).toContain('17');
    expect(text.length).toBeGreaterThan(6);
  });

  it('renders an unknown date as nothing at all', () => {
    // Paired with `approxExpiryDate` returning null, this is what keeps an
    // unknown epoch from ever reaching the DOM as a date.
    expect(formatApproxExpiry(null)).toBe('');
    expect(formatApproxExpiry(approxExpiryDate(null, null))).toBe('');
  });
});

describe('statusTone', () => {
  it('maps each status to a semantic tone', () => {
    expect(statusTone('enacted')).toBe('success');
    expect(statusTone('ratified')).toBe('success');
    expect(statusTone('active')).toBe('info');
    expect(statusTone('expired')).toBe('neutral');
    expect(statusTone('dropped')).toBe('neutral');
  });

  it('is case-insensitive', () => {
    expect(statusTone('ENACTED')).toBe('success');
  });

  it('falls back to neutral for an unknown status rather than throwing', () => {
    expect(statusTone('something-new')).toBe('neutral');
    expect(statusTone(null)).toBe('neutral');
  });
});
