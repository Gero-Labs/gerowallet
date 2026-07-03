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
