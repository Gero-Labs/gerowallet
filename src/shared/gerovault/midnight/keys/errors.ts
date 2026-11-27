/**
 * Typed errors of the Midnight key library. They are thrown only for input the caller controls
 * (its own seed, index, keys and settings). Readers of untrusted input (key cards, verification
 * QR payloads, stored counters) never throw: they return a refusal code.
 */
export type MidnightKeyErrorCode =
  | 'INVALID_NETWORK'
  | 'RESERVED_NETWORK'
  | 'INVALID_ROLE'
  | 'RESERVED_ROLE'
  | 'INVALID_INDEX'
  | 'INVALID_PATH'
  | 'INVALID_SEED'
  | 'INVALID_CHILD_KEY'
  | 'ZERO_SCALAR'
  | 'INVALID_SCALAR'
  | 'INVALID_FIELD_ELEMENT'
  | 'INVALID_RANDOMNESS'
  | 'INVALID_POINT'
  | 'INVALID_UPGRADE_KEY'
  | 'INVALID_SALT'
  | 'INVALID_LABEL'
  | 'INVALID_VERIFICATION_SET'
  | 'INVALID_REQUEST_CODE_INPUT'
  | 'INVALID_COUNTER'
  | 'INDEX_SPACE_EXHAUSTED';

export class MidnightKeyError extends Error {
  readonly code: MidnightKeyErrorCode;

  constructor(code: MidnightKeyErrorCode, message: string) {
    super(message);
    this.name = 'MidnightKeyError';
    this.code = code;
  }
}
