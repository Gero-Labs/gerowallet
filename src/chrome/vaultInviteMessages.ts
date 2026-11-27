/**
 * The GeroVault invitation requests the background answers (`vaultInviteHandlers.ts`). Every one
 * is extension-page-only (`senderTrust.ts`): they open the root key, hold the device's invite
 * secret or speak for this device to gero-sync. Kept free of imports so `senderTrust.ts` can
 * list them.
 */
export const VAULT_INVITE_MESSAGES = [
  'GEROVAULT_INVITE_STATUS',
  'GEROVAULT_INVITE_RESOLVE',
  'GEROVAULT_INVITE_HOLDS',
  'GEROVAULT_SETUP_START',
  'GEROVAULT_SETUP_UNLOCK',
  'GEROVAULT_SETUP_TERMS',
  'GEROVAULT_SETUP_INVITE',
  'GEROVAULT_SETUP_LINK',
  'GEROVAULT_SETUP_WITHDRAW_LINK',
  'GEROVAULT_SETUP_REFRESH',
  'GEROVAULT_SETUP_REMIND',
  'GEROVAULT_SETUP_REVOKE',
  'GEROVAULT_SETUP_VERIFIED',
  'GEROVAULT_SETUP_CANCEL',
  'GEROVAULT_SETUP_COMPLETE',
  'GEROVAULT_SETUP_LIST',
  'GEROVAULT_SETUP_GET',
  'GEROVAULT_INVITES_LIST',
  'GEROVAULT_INVITE_GET',
  'GEROVAULT_INVITE_OPEN_LINK',
  'GEROVAULT_INVITE_ACCEPT',
  'GEROVAULT_INVITE_DECLINE',
  'GEROVAULT_INVITE_BLOCK',
  'GEROVAULT_INVITE_JOINED',
] as const;

export type VaultInviteMessage = (typeof VAULT_INVITE_MESSAGES)[number];
