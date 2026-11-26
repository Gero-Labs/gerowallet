/**
 * GeroVault core: CIP-1854 role keys, native vault scripts, the CIP-0146 registration codec,
 * vault index allocation and the recovery package. Pure TypeScript: no Vue, no storage, no
 * network, no `chrome.*`.
 */
export * from './types';
export * from './errors';
export * from './paths';
export * from './keys';
export * from './scripts';
export * from './indexAllocation';
export * from './backupTime';
export * from './vaultId';
export {
  CIP146_LABEL,
  EXTERNAL_SCAN_MAX,
  MAX_PARTICIPANTS,
  MAX_REGISTRATION_BYTES,
  decodeRegistration,
  decryptRegistrationFields,
  dedupeRegistrations,
  encodeRegistration,
  rebuildFromRegistration,
  registrationScriptsCbor,
} from './registration';
export type {
  DecodeRegistrationResult,
  DecodedParticipant,
  DecodedRegistration,
  DecryptFieldsResult,
  DecryptedFields,
  DecryptedParticipant,
  EncodedRegistration,
  ParticipantDescription,
  RebuildParticipant,
  RebuildRefusalCode,
  RebuildResult,
  RegistrationEncryption,
  RegistrationInput,
  RegistrationJson,
  RegistrationJsonValue,
  RegistrationRefusal,
  RegistrationRefusalCode,
  RegistrationText,
  VaultDescription,
} from './registration';
export { CIP83_DEFAULT_PASSPHRASE, cip83Decrypt, cip83Encrypt } from './cip83';
// Recovery package (GV-14): file format, payload, export, restore and staleness.
export {
  MAX_RECOVERY_FILE_BYTES,
  RECOVERY_FORMAT_VERSION,
  RECOVERY_KDF,
  RECOVERY_KDF_MAX,
  RECOVERY_KDF_MIN,
  readRecoveryHeader,
} from './recoveryFormat';
export type {
  ReadRecoveryHeaderResult,
  RecoveryFileRefusal,
  RecoveryFileRefusalCode,
  RecoveryHeader,
  RecoveryKdfParams,
} from './recoveryFormat';
export {
  MAX_ADDRESS_BOOK_ENTRIES,
  MAX_MANIFEST_REVISIONS,
  MAX_PACKAGE_PARTICIPANTS,
  MAX_PROPOSALS,
  MAX_REFERENCE_SCRIPTS,
  RECOVERY_PAYLOAD_VERSION,
  decodeRecoveryPayload,
  encodeRecoveryPayload,
  manifestHash,
} from './recoveryPayload';
export type {
  AddressBookEntry,
  BackupTerms,
  DecodeRecoveryPayloadResult,
  ExternalCosignerInput,
  ManifestRevision,
  NativeVaultRecord,
  OutputReference,
  PackageParticipant,
  PackageRole,
  PackageSelf,
  PlutusVaultRecord,
  ProposalRecord,
  RecoveryPackage,
  RecoveryPackageContents,
  RecoveryPayloadRefusalCode,
} from './recoveryPayload';
export {
  exportRecoveryPackage,
  openRecoveryPackage,
  recoveryPackageStaleness,
  restoreVaultFromPackage,
} from './recoveryPackage';
export type {
  LatestManifestRevision,
  OpenRecoveryPackageResult,
  RecoveryChainFacts,
  RecoveryPackageStaleness,
  RestoreOptions,
  RestoreRefusalCode,
  RestoreResult,
  RestoredVault,
} from './recoveryPackage';
