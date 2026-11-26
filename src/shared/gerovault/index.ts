/**
 * GeroVault core: CIP-1854 role keys, native vault scripts, the CIP-0146 registration codec and
 * vault index allocation. Pure TypeScript: no Vue, no storage, no network, no `chrome.*`.
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
  DEFAULT_REBUILD_SCAN,
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
