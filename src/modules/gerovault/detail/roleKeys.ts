/**
 * The logged-in wallet's own CIP-1854 role keys, as the recovery screens ask for them. Kept apart
 * from `context.ts` so the recovery flows load nothing of the wallet's stores.
 */
import { deriveRoleKeys, type MultisigAccountPublicKey, type RoleKeys } from '@/shared/gerovault';
import type { Wallet } from '@/models/types';

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

/** What a role key source reads of the logged-in wallet. */
export type RoleKeysWallet = Pick<Wallet, 'id' | 'publicKey' | 'encryptionMethod' | 'webAuthnCredentialId' | 'webAuthnTransports' | 'prfEncryptedPrivateKey'>
  & { readonly secretsWalletId?: number };

export interface WalletRoleKeysDeps {
  /** The background's `GEROVAULT_DERIVE_ACCOUNT_KEY` (create/ownAccountKey.ts). */
  readonly request: (walletId: number, password?: string) => Promise<MultisigAccountPublicKey>;
  /** A PassKey wallet's account key, decrypted where WebAuthn runs and wiped at once. */
  readonly passKey: (wallet: RoleKeysWallet) => Promise<MultisigAccountPublicKey>;
}

const defaultWalletDeps: WalletRoleKeysDeps = {
  request: async (walletId, password) => (await import('@/modules/gerovault/create/ownAccountKey')).requestMultisigAccountKey(walletId, password),
  passKey: async wallet => (await import('@/modules/gerovault/create/ownAccountKey')).passKeyMultisigAccountKey(wallet),
};

const isPassKey = (wallet: RoleKeysWallet): boolean =>
  wallet.encryptionMethod === 'prf' || (!!wallet.prfEncryptedPrivateKey && !!wallet.webAuthnCredentialId);

/** Maps the account key flow's codes (`ownAccountKeyFlow.ts`) to this file's. */
function roleKeysFailure(error: unknown): RoleKeysError {
  const code = (error as { code?: unknown })?.code;
  if (code === 'wrong-password') return new RoleKeysError('WRONG_PASSWORD', 'The spending password was refused');
  if (code === 'locked') return new RoleKeysError('LOCKED', 'The wallet\'s session is locked');
  if (code === 'unavailable') return new RoleKeysError('UNAVAILABLE', 'This build cannot read the wallet\'s vault keys');
  return new RoleKeysError('NOT_SUPPORTED', 'This wallet cannot read its vault keys here');
}

/**
 * The logged-in wallet's role keys, from its CIP-1854 account public key: the background derives
 * that key behind the spending password (or a Google wallet's unlocked session), and a PassKey
 * wallet decrypts in the page, as the create flow does. The role keys then come from the public key
 * alone (`deriveRoleKeys`). No root key reaches this page from the background.
 */
export function walletRoleKeysSource(currentWallet: () => RoleKeysWallet | null | undefined, deps: WalletRoleKeysDeps = defaultWalletDeps): VaultRoleKeysSource {
  return Object.freeze({
    get needsSpendingPassword(): boolean {
      const wallet = currentWallet();
      return !!wallet && wallet.encryptionMethod !== 'mpc' && !isPassKey(wallet);
    },
    async roleKeys({ walletId, spendingPassword }: { readonly walletId: number; readonly spendingPassword?: string }): Promise<RoleKeys> {
      const wallet = currentWallet();
      if (!wallet || wallet.id !== walletId) throw new RoleKeysError('NOT_SUPPORTED', 'Not the logged-in wallet');
      let account: MultisigAccountPublicKey;
      try {
        account = isPassKey(wallet) ? await deps.passKey(wallet) : await deps.request(walletId, spendingPassword);
      } catch (error) {
        throw roleKeysFailure(error);
      }
      return deriveRoleKeys(account);
    },
  });
}

/** For a host with no wallet: the recovery screens say so instead of guessing. */
export const unavailableRoleKeysSource: VaultRoleKeysSource = Object.freeze({
  needsSpendingPassword: false,
  roleKeys: async () => {
    throw new RoleKeysError('UNAVAILABLE', 'This build cannot read the wallet\'s vault keys');
  },
});
