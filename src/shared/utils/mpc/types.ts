export enum ShareRole {
  Device = 1,
  Login = 2,
  Recovery = 3,
}

export class MpcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MpcError';
  }
}

export class ShareDecodeError extends MpcError {
  constructor(message: string) {
    super(message);
    this.name = 'ShareDecodeError';
  }
}

export class RecoveryDecryptError extends MpcError {
  constructor(message: string) {
    super(message);
    this.name = 'RecoveryDecryptError';
  }
}

export class MpcValidationError extends MpcError {
  constructor(message: string) {
    super(message);
    this.name = 'MpcValidationError';
  }
}

/**
 * Thrown by setRecoveryPasswordFlow when the re-split (stage → rotate → promote)
 * already succeeded — the wallet is live on the new split, daily unlock works —
 * but storing the fresh encrypted recovery backup under the new password (the
 * LAST step) failed even after a retry. Distinct from a plain failure so the UI
 * never implies "nothing changed" when the old recovery password is, in fact,
 * already dead (the shares were rotated).
 */
export class RecoveryBackupStoreError extends MpcError {
  constructor(message: string) {
    super(message);
    this.name = 'RecoveryBackupStoreError';
  }
}
