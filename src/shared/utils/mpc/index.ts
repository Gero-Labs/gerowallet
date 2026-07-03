export { ShareRole, MpcError, ShareDecodeError, RecoveryDecryptError } from './types';
export { TOTAL_SHARES, THRESHOLD, splitEntropy, combineShares } from './shamir';
export { encodeShare, decodeShare } from './shareCodec';
export { encryptRecoveryShare, decryptRecoveryShare } from './recoveryShare';
export { createMpcShareSet, reconstructEntropy } from './mpcShares';
export type { MpcShareSet } from './mpcShares';
