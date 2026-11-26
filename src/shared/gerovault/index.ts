/**
 * GeroVault core: CIP-1854 role keys, native vault scripts, the CIP-0146 registration codec,
 * vault index allocation, the `gero-vault/v1` manifest, attestations, the verification ceremony
 * and the recovery package. Pure TypeScript: no Vue, no storage, no network, no `chrome.*`.
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
export { encodeCanonicalCbor } from './canonicalCbor';
export type { CborWritable, CborWritableMap } from './canonicalCbor';
export {
  ATTESTATION_LABEL,
  ATTESTATION_METHOD,
  MAX_ATTESTATION_BYTES,
  MAX_PROTECTED_HEADER_BYTES,
  MAX_SIGNED_ADDRESS_BYTES,
  MAX_SIGNED_BODY_BYTES,
  assembleExpiredTx,
  attestationSigner,
  canonicalAttestation,
  cip8Proof,
  expiredTxAuxiliaryData,
  expiredTxBody,
  expiredTxBodyHash,
  ingestAttestation,
  isCanonicalAttestation,
  isUsableEd25519Key,
  verifyAttestation,
  verifyEd25519,
} from './attestation';
export type { AttestationCheck, AttestationRefusalCode, AttestedDigest, OwnerAttestation } from './attestation';
export { readLabel, writeLabel, displayLabel } from './labels';
export { isManifestAck } from './ackBrand';
export * from './manifest';
export * from './manifestCheck';
export * from './verificationNumber';
// Recovery package (GV-14): file format, passphrases, payload, export, restore and staleness.
// `sealRecoveryFile` and its fixed salt and nonce for test vectors are deliberately not exported.
export {
  MAX_RECOVERY_FILE_BYTES,
  MAX_RECOVERY_PAYLOAD_BYTES,
  RECOVERY_FORMAT_VERSION,
  RECOVERY_KDF,
  RECOVERY_KDF_MAXMEM,
  RECOVERY_PASSPHRASE_ALPHABET,
  RECOVERY_PASSPHRASE_MIN_CODE_POINTS,
  generateRecoveryPassphrase,
  normalizeRecoveryPassphrase,
  readRecoveryHeader,
  recoveryPassphraseProblem,
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
  MAX_ENDORSEMENTS,
  MAX_EXTERNAL_ATTESTATIONS,
  MAX_MANIFEST_REVISIONS,
  MAX_PACKAGE_PARTICIPANTS,
  MAX_PROPOSALS,
  MAX_PROPOSAL_BYTES,
  MAX_REFERENCE_SCRIPTS,
  RECOVERY_PAYLOAD_VERSION,
  decodeRecoveryPayload,
  encodeRecoveryPayload,
  fitRecoveryHistory,
} from './recoveryPayload';
export type {
  AddressBookEntry,
  BackupTerms,
  DecodeRecoveryPayloadResult,
  ExternalCosignerInput,
  FittedRecoveryHistory,
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
  RecoverySkipped,
} from './recoveryPayload';
export {
  ATTESTATION_TIMEOUT_MS,
  MAX_CHAIN_REGISTRATIONS,
  MAX_REVEALED_SCRIPTS,
  backupPathOpensAtMs,
  exportRecoveryPackage,
  openRecoveryPackage,
  recoveryPackageStaleness,
  restoreVaultFromPackage,
  verifyOwnAttestationInManifests,
} from './recoveryPackage';
export type {
  ExportedRecoveryPackage,
  LatestManifestRevision,
  OpenRecoveryPackageResult,
  OwnAttestationQuery,
  OwnAttestationResult,
  OwnAttestationVerifier,
  PlutusRestoreFacts,
  RecoveryChainFacts,
  RecoveryChainState,
  RecoveryChainUtxo,
  RecoveryPackageStaleness,
  RestoreOptions,
  RestoreRefusalCode,
  RestoreResult,
  RestoredNativeCandidate,
} from './recoveryPackage';
