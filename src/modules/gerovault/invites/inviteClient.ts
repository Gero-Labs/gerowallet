/**
 * Page side of GeroVault invitations: typed calls to the background (`GEROVAULT_INVITE_*`,
 * `src/chrome/vaultInviteHandlers.ts`). Pages hold views only: no invite secret, revoke secret,
 * capability or root key is ever answered to a page.
 *
 * A PassKey wallet's root key is decrypted where WebAuthn runs, in `create/ownAccountKey.ts` (the
 * one documented PRF exception), handed to the background for the one request and wiped.
 */
import { Messaging } from '@/chrome/messaging';
import type { VaultInviteMessage } from '@/chrome/vaultInviteMessages';
import type { Wallet } from '@/models/types';
import type { InviteErrorCode, ReceivedView, SetupViewModel } from '@/services/vaultInvites/inviteService';
import type { ResolveProblem, ResolvedCosigner } from '@/services/vaultInvites/resolveCosigner';
import type { HeldIndex, ReleasedIndex } from '@/shared/gerovault';
import { passKeyRootKeyBytes } from '@/modules/gerovault/create/ownAccountKey';
import { OwnAccountKeyError } from '@/modules/gerovault/create/ownAccountKeyFlow';

export type { ReceivedView, SetupViewModel, SlotView, SlotStatus, AnsweringWallet } from '@/services/vaultInvites/inviteService';

/** A background code, or `UNAVAILABLE` (no handler answered: an older background) or `CANCELLED` (the PassKey prompt). */
export type InviteClientCode = InviteErrorCode | 'UNAVAILABLE' | 'CANCELLED';

export class InviteClientError extends Error {
  constructor(readonly code: InviteClientCode, readonly details?: Record<string, unknown>) {
    super(`vault invitation: ${code}`);
    this.name = 'InviteClientError';
  }
}

interface Answer<T> {
  data?: { success?: boolean; result?: T; error?: unknown; details?: unknown };
}

async function call<T>(method: VaultInviteMessage, data: Record<string, unknown> = {}): Promise<T> {
  const response = await Messaging.sendToBackgroundFromOptions({ method, data }) as Answer<T> | undefined;
  const answer = response?.data;
  if (!answer || typeof answer.success !== 'boolean') throw new InviteClientError('UNAVAILABLE');
  if (answer.success) return answer.result as T;
  const details = answer.details && typeof answer.details === 'object' ? answer.details as Record<string, unknown> : undefined;
  throw new InviteClientError(typeof answer.error === 'string' ? answer.error as InviteErrorCode : 'SERVER', details);
}

/** The credential of one request: a password, PassKey root key bytes, or nothing (a Google session). */
export type InviteAuth = { readonly password?: string; readonly privateKeyBytes?: number[] };

/** A PassKey wallet's root key, for one request (`create/ownAccountKey.ts`). The request wipes the array. */
export async function passKeyAuth(
  wallet: Pick<Wallet, 'id' | 'webAuthnCredentialId' | 'webAuthnTransports' | 'prfEncryptedPrivateKey'> & { secretsWalletId?: number },
): Promise<InviteAuth> {
  try {
    return { privateKeyBytes: await passKeyRootKeyBytes(wallet) };
  } catch (error) {
    throw new InviteClientError(error instanceof OwnAccountKeyError && error.code === 'cancelled' ? 'CANCELLED' : 'NOT_SUPPORTED');
  }
}

/** Overwrites the root key bytes of an auth once the request returned. */
export function wipeAuth(auth: InviteAuth): void {
  auth.privateKeyBytes?.fill(0);
}

async function withAuth<T>(auth: InviteAuth, run: (auth: InviteAuth) => Promise<T>): Promise<T> {
  try {
    return await run(auth);
  } finally {
    wipeAuth(auth);
  }
}

export interface LinkAnswer {
  readonly setup: SetupViewModel;
  readonly joinTokenHash: string;
  /** The QR string (`gvi1…`). */
  readonly payload: string;
  /** The same as a link (`https://gerowallet.io/vault-invite#gvi1…`): the QR's text alternative. */
  readonly url: string;
  readonly expiresAt: number;
}

export const inviteClient = {
  status: () => call<{ inviteKey: string }>('GEROVAULT_INVITE_STATUS'),
  resolve: (walletId: number, entry: string) =>
    call<{ ok: true; value: ResolvedCosigner } | { ok: false; problem: ResolveProblem }>('GEROVAULT_INVITE_RESOLVE', { walletId, entry }),
  holds: (walletId: number) => call<{ held: HeldIndex[]; released: ReleasedIndex[] }>('GEROVAULT_INVITE_HOLDS', { walletId }),

  startSetup: (input: { walletId: number; name: string; owners: number; threshold: number }, auth: InviteAuth) =>
    withAuth(auth, a => call<{ setup: SetupViewModel; accountKey: string }>('GEROVAULT_SETUP_START', { ...input, ...a })),
  unlockSetup: (setupId: string, auth: InviteAuth) =>
    withAuth(auth, a => call<{ setup: SetupViewModel; accountKey: string }>('GEROVAULT_SETUP_UNLOCK', { setupId, ...a })),
  updateTerms: (setupId: string, terms: { name: string; owners: number; threshold: number }) => call<SetupViewModel>('GEROVAULT_SETUP_TERMS', { setupId, ...terms }),
  invite: (setupId: string, n: number, target: { stakeCredential: string; handle?: string; label?: string }) =>
    call<SetupViewModel>('GEROVAULT_SETUP_INVITE', { setupId, n, ...target }),
  link: (setupId: string, kind: 'qr' | 'link') => call<LinkAnswer>('GEROVAULT_SETUP_LINK', { setupId, kind }),
  withdrawLink: (setupId: string, joinTokenHash: string) => call<SetupViewModel>('GEROVAULT_SETUP_WITHDRAW_LINK', { setupId, joinTokenHash }),
  refreshSetup: (setupId: string) => call<SetupViewModel>('GEROVAULT_SETUP_REFRESH', { setupId }),
  remind: (setupId: string, n: number) => call<SetupViewModel>('GEROVAULT_SETUP_REMIND', { setupId, n }),
  revoke: (setupId: string, n: number) => call<SetupViewModel>('GEROVAULT_SETUP_REVOKE', { setupId, n }),
  markVerified: (setupId: string, n: number) => call<SetupViewModel>('GEROVAULT_SETUP_VERIFIED', { setupId, n }),
  cancelSetup: (setupId: string) => call<SetupViewModel>('GEROVAULT_SETUP_CANCEL', { setupId }),
  completeSetup: (setupId: string, vaultId: string) => call<SetupViewModel>('GEROVAULT_SETUP_COMPLETE', { setupId, vaultId }),
  listSetups: (walletId?: number) => call<SetupViewModel[]>('GEROVAULT_SETUP_LIST', walletId === undefined ? {} : { walletId }),
  getSetup: (setupId: string) => call<SetupViewModel>('GEROVAULT_SETUP_GET', { setupId }),

  listInvites: () => call<{ invites: ReceivedView[]; refused: number }>('GEROVAULT_INVITES_LIST'),
  getInvite: (ref: string) => call<ReceivedView>('GEROVAULT_INVITE_GET', { ref }),
  openLink: (text: string) => call<ReceivedView>('GEROVAULT_INVITE_OPEN_LINK', { text }),
  accept: (input: { ref: string; walletId: number; label?: string }, auth: InviteAuth) =>
    withAuth(auth, a => call<ReceivedView>('GEROVAULT_INVITE_ACCEPT', { ...input, ...a })),
  decline: (ref: string) => call<ReceivedView>('GEROVAULT_INVITE_DECLINE', { ref }),
  block: (ref: string) => call<ReceivedView>('GEROVAULT_INVITE_BLOCK', { ref }),
  markJoined: (ref: string, vaultId?: string) => call<ReceivedView>('GEROVAULT_INVITE_JOINED', { ref, ...(vaultId ? { vaultId } : {}) }),
};

export type InviteClient = typeof inviteClient;

/** The client's code for any thrown value. */
export function inviteErrorCode(error: unknown): InviteClientCode {
  return error instanceof InviteClientError ? error.code : 'SERVER';
}
