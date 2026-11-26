/**
 * GeroVault core: CIP-1854 role keys, native vault scripts, the CIP-0146 registration codec,
 * vault index allocation, the `gero-vault/v1` manifest, attestations and the verification
 * ceremony. Pure TypeScript: no Vue, no storage, no network, no `chrome.*`.
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
  assembleExpiredTx,
  cip8Proof,
  expiredTxAuxiliaryData,
  expiredTxBody,
  expiredTxBodyHash,
  verifyAttestation,
} from './attestation';
export type { AttestationCheck, AttestationRefusalCode, AttestedDigest, OwnerAttestation } from './attestation';
export * from './manifest';
export * from './manifestCheck';
export * from './verificationNumber';
