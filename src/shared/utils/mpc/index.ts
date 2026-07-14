export { ShareRole, MpcError, ShareDecodeError, RecoveryDecryptError, MpcValidationError, RecoveryBackupStoreError, NoRecoveryBackupError } from './types';
export { TOTAL_SHARES, THRESHOLD, splitEntropy, combineShares } from './shamir';
export { encodeShare, decodeShare } from './shareCodec';
export { encryptRecoveryShare, decryptRecoveryShare } from './recoveryShare';
export { createMpcShareSet, reconstructEntropy } from './mpcShares';
export type { MpcShareSet } from './mpcShares';
export { entropyToMnemonic, mnemonicToEntropyBytes, deriveExpectedXpub, reconstructAndValidateEntropy } from './mpcKeys';
export { encryptDeviceShare, decryptDeviceShare } from './deviceShareCipher';
export type { DeviceShareSecret } from './deviceShareCipher';
export {
  prepareMpcWalletCreation,
  reconstructRootKeyBytes,
} from './mpcWalletService';
