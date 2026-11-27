import { describe, expect, it } from 'vitest';
import { BACKUP_DEFAULT_DELAY_YEARS, BACKUP_MIN_DELAY_DAYS, BACKUP_MIN_DELAY_MS, checkBackupTime, defaultBackupTime } from './backupTime';

const created = Date.UTC(2026, 10, 26, 12, 0, 0);

describe('dated backup path: date rules', () => {
  it('exports the rules as named constants', () => {
    expect(BACKUP_MIN_DELAY_DAYS).toBe(180);
    expect(BACKUP_MIN_DELAY_MS).toBe(180 * 24 * 60 * 60 * 1000);
    expect(BACKUP_DEFAULT_DELAY_YEARS).toBe(2);
  });

  it('defaults to two calendar years after creation', () => {
    expect(defaultBackupTime(created)).toBe(Date.UTC(2028, 10, 26, 12, 0, 0));
    expect(checkBackupTime(created, defaultBackupTime(created))).toEqual({ ok: true });
    // No 29 February two years on: the next day.
    expect(defaultBackupTime(Date.UTC(2028, 1, 29))).toBe(Date.UTC(2030, 2, 1));
    expect(defaultBackupTime(-1)).toBeUndefined();
  });

  it('refuses a backup time less than 180 days after creation', () => {
    expect(checkBackupTime(created, created + BACKUP_MIN_DELAY_MS)).toEqual({ ok: true });
    expect(checkBackupTime(created, created + BACKUP_MIN_DELAY_MS - 1))
      .toEqual({ ok: false, code: 'BACKUP_TOO_SOON', earliestMs: created + BACKUP_MIN_DELAY_MS });
    expect(checkBackupTime(created, created - 1)).toMatchObject({ ok: false, code: 'BACKUP_TOO_SOON' });
  });

  it('refuses times that are not integer milliseconds', () => {
    expect(checkBackupTime(NaN, created)).toEqual({ ok: false, code: 'INVALID_TIME' });
    expect(checkBackupTime(created, 1.5)).toEqual({ ok: false, code: 'INVALID_TIME' });
    expect(checkBackupTime(created, undefined as never)).toEqual({ ok: false, code: 'INVALID_TIME' });
  });
});
