/**
 * Typed errors of the vault builders. Decoders of untrusted input never throw: they return a
 * refusal (`registration.ts`). These are thrown only for input the caller controls.
 */
export type GeroVaultErrorCode =
  | 'INVALID_INDEX'
  | 'INVALID_ROLE'
  | 'INVALID_PATH'
  | 'INVALID_ACCOUNT_KEY'
  | 'INVALID_ROLE_KEY'
  | 'INVALID_VAULT_KEYS'
  | 'EXTENDED_KEY_NOT_ACCEPTED'
  | 'INVALID_KEY_HASH'
  | 'TOO_FEW_OWNERS'
  | 'TOO_MANY_OWNERS'
  | 'THRESHOLD_TOO_LOW'
  | 'THRESHOLD_OUT_OF_RANGE'
  | 'WARNING_NOT_ACKNOWLEDGED'
  | 'DUPLICATE_KEY'
  | 'BACKUP_KEYS_REQUIRED'
  | 'TOO_MANY_BACKUP_KEYS'
  | 'BACKUP_THRESHOLD_OUT_OF_RANGE'
  | 'BACKUP_OVERLAPS_OWNER'
  | 'BACKUP_SLOT_REQUIRED'
  | 'UNEXPECTED_BACKUP_KEYS'
  | 'UNKNOWN_TEMPLATE'
  | 'UNKNOWN_NETWORK'
  | 'INVALID_DESCRIPTION'
  | 'INVALID_PASSPHRASE'
  | 'INVALID_TIME'
  | 'BACKUP_TOO_SOON'
  | 'INVALID_PACKAGE'
  | 'PACKAGE_CHECK_FAILED'
  | 'INVALID_MANIFEST_REVISION'
  | 'SEED_MISMATCH'
  | 'HISTORY_TOO_LARGE'
  | 'INVALID_LABEL'
  | 'MANIFEST_HISTORY_CORRUPT';

export class GeroVaultError extends Error {
  readonly code: GeroVaultErrorCode;

  constructor(code: GeroVaultErrorCode, message: string) {
    super(message);
    this.name = 'GeroVaultError';
    this.code = code;
  }
}
