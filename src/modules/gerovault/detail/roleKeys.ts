/**
 * The logged-in wallet's own CIP-1854 role keys, as the recovery screens ask for them. Kept apart
 * from `context.ts` so the recovery flows load nothing of the wallet's stores.
 */
import type { RoleKeys } from '@/shared/gerovault';

/** Why the wallet's own role keys could not be read. */
export type RoleKeysErrorCode = 'UNAVAILABLE' | 'WRONG_PASSWORD' | 'LOCKED' | 'NOT_SUPPORTED';

export class RoleKeysError extends Error {
  readonly code: RoleKeysErrorCode;

  constructor(code: RoleKeysErrorCode, message: string) {
    super(message);
    this.name = 'RoleKeysError';
    this.code = code;
  }
}

/**
 * The logged-in wallet's own CIP-1854 role keys (`m/1854'/1815'/0'/0` and `.../2`): public keys,
 * but they derive every vault key the wallet will ever hold, so they stay on this device. The
 * recovery package needs them to check that the exporting or restoring seed is the participant's.
 */
export interface VaultRoleKeysSource {
  /** Whether `roleKeys` needs the spending password. */
  readonly needsSpendingPassword: boolean;
  /** Throws `RoleKeysError`. */
  roleKeys(request: { readonly walletId: number; readonly spendingPassword?: string }): Promise<RoleKeys>;
}

/**
 * Nothing in the wallet derives CIP-1854 keys for a page yet: that needs a background message that
 * decrypts the root key. Until one exists, the recovery screens say so instead of guessing.
 */
export const unavailableRoleKeysSource: VaultRoleKeysSource = Object.freeze({
  needsSpendingPassword: false,
  roleKeys: async () => {
    throw new RoleKeysError('UNAVAILABLE', 'This build cannot read the wallet\'s vault keys');
  },
});
