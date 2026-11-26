/**
 * Date rules of the dated backup path (GV-69). A native script can only compare against a fixed
 * slot, so the date can never be moved or cancelled: it must be far enough away, and by default it
 * is two years after creation. The rules are on wall-clock time (Unix milliseconds); turning the
 * chosen time into a slot needs the network's slot parameters, which the caller has.
 */

const DAY_MS = 86_400_000;

/** The backup path opens at least 180 days after the vault is created. */
export const BACKUP_MIN_DELAY_DAYS = 180;
export const BACKUP_MIN_DELAY_MS = BACKUP_MIN_DELAY_DAYS * DAY_MS;
/** Unless the creator picks another time, the backup path opens two calendar years after creation. */
export const BACKUP_DEFAULT_DELAY_YEARS = 2;

const isTime = (ms: unknown): ms is number => typeof ms === 'number' && Number.isSafeInteger(ms) && ms >= 0;

/**
 * Creation time plus two calendar years, in UTC. A vault created on 29 February opens on 1 March
 * two years later, since that year has no 29 February. `undefined` for a time that is not a
 * non-negative integer number of milliseconds.
 */
export function defaultBackupTime(createdAtMs: number): number | undefined {
  if (!isTime(createdAtMs)) return undefined;
  const d = new Date(createdAtMs);
  return Date.UTC(
    d.getUTCFullYear() + BACKUP_DEFAULT_DELAY_YEARS,
    d.getUTCMonth(),
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    d.getUTCMilliseconds(),
  );
}

export type BackupTimeCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'INVALID_TIME' }
  | { readonly ok: false; readonly code: 'BACKUP_TOO_SOON'; readonly earliestMs: number };

/** Whether `backupAtMs` is allowed for a vault created at `createdAtMs`. */
export function checkBackupTime(createdAtMs: number, backupAtMs: number): BackupTimeCheck {
  if (!isTime(createdAtMs) || !isTime(backupAtMs)) return { ok: false, code: 'INVALID_TIME' };
  const earliestMs = createdAtMs + BACKUP_MIN_DELAY_MS;
  return backupAtMs >= earliestMs ? { ok: true } : { ok: false, code: 'BACKUP_TOO_SOON', earliestMs };
}
