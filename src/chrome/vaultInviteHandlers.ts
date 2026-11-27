/**
 * The GeroVault invitation requests (`vaultInviteMessages.ts`), answered by the background with
 * `inviteService.ts`. Built from an injected service so they are tested as behaviour;
 * `background.ts` registers each with `app.addToOptions` (extension pages only).
 *
 * Every answer is `{ success: true, result }` or `{ success: false, error, details? }`, and
 * `sendResponse` runs exactly once on every path. `request.data` is never logged: it may hold the
 * spending password or a PassKey wallet's root key bytes, which are read here and passed on, never
 * kept.
 */
import { SENDER, TARGET } from '@/chrome/config';
import type { InviteService } from '@/services/vaultInvites/inviteService';
import type { VaultKeyAuth } from '@/services/vaultInvites/inviteKeys';
import type { VaultInviteMessage } from './vaultInviteMessages';

interface Request {
  readonly id?: unknown;
  readonly data?: unknown;
}

type SendResponse = (response: { id: unknown; data: Record<string, unknown>; target: string; sender: string }) => void;
type Data = Record<string, unknown>;

/** The credential in a request: a password string, or a PassKey wallet's root key as a byte array. */
export function authOf(data: Data): VaultKeyAuth {
  const password = typeof data['password'] === 'string' ? data['password'] : undefined;
  const raw = data['privateKeyBytes'];
  const privateKeyBytes = Array.isArray(raw) && raw.length <= 128 && raw.every(b => Number.isInteger(b) && b >= 0 && b <= 255)
    ? Uint8Array.from(raw as number[])
    : undefined;
  return { ...(password ? { password } : {}), ...(privateKeyBytes ? { privateKeyBytes } : {}) };
}

export const VAULT_INVITE_ROUTES: Readonly<Record<VaultInviteMessage, (service: InviteService, data: Data) => Promise<unknown>>> = {
  GEROVAULT_INVITE_STATUS: s => s.status(),
  GEROVAULT_INVITE_RESOLVE: (s, d) => s.resolve({ walletId: d['walletId'], entry: d['entry'] }),
  GEROVAULT_INVITE_HOLDS: (s, d) => s.holds({ walletId: d['walletId'] }),
  GEROVAULT_SETUP_START: (s, d) => s.startSetup({ walletId: d['walletId'], auth: authOf(d), name: d['name'], owners: d['owners'], threshold: d['threshold'] }),
  GEROVAULT_SETUP_UNLOCK: (s, d) => s.unlockSetup({ setupId: d['setupId'], auth: authOf(d) }),
  GEROVAULT_SETUP_TERMS: (s, d) => s.updateTerms({ setupId: d['setupId'], name: d['name'], owners: d['owners'], threshold: d['threshold'] }),
  GEROVAULT_SETUP_INVITE: (s, d) => s.invite({ setupId: d['setupId'], n: d['n'], stakeCredential: d['stakeCredential'], handle: d['handle'], label: d['label'] }),
  GEROVAULT_SETUP_LINK: (s, d) => s.link({ setupId: d['setupId'], kind: d['kind'] }),
  GEROVAULT_SETUP_WITHDRAW_LINK: (s, d) => s.withdrawLink({ setupId: d['setupId'], joinTokenHash: d['joinTokenHash'] }),
  GEROVAULT_SETUP_REFRESH: (s, d) => s.refreshSetup({ setupId: d['setupId'] }),
  GEROVAULT_SETUP_REMIND: (s, d) => s.remind({ setupId: d['setupId'], n: d['n'] }),
  GEROVAULT_SETUP_REVOKE: (s, d) => s.revoke({ setupId: d['setupId'], n: d['n'] }),
  GEROVAULT_SETUP_VERIFIED: (s, d) => s.markVerified({ setupId: d['setupId'], n: d['n'] }),
  GEROVAULT_SETUP_CANCEL: (s, d) => s.cancelSetup({ setupId: d['setupId'] }),
  GEROVAULT_SETUP_COMPLETE: (s, d) => s.completeSetup({ setupId: d['setupId'], vaultId: d['vaultId'] }),
  GEROVAULT_SETUP_LIST: (s, d) => s.listSetups({ walletId: d['walletId'] }),
  GEROVAULT_SETUP_GET: (s, d) => s.getSetup({ setupId: d['setupId'] }),
  GEROVAULT_INVITES_LIST: s => s.refreshInvites(),
  GEROVAULT_INVITE_GET: (s, d) => s.getReceived({ ref: d['ref'] }),
  GEROVAULT_INVITE_OPEN_LINK: (s, d) => s.openLink({ text: d['text'] }),
  GEROVAULT_INVITE_ACCEPT: (s, d) => s.accept({ ref: d['ref'], walletId: d['walletId'], auth: authOf(d), label: d['label'] }),
  GEROVAULT_INVITE_DECLINE: (s, d) => s.decline({ ref: d['ref'] }),
  GEROVAULT_INVITE_BLOCK: (s, d) => s.block({ ref: d['ref'] }),
  GEROVAULT_INVITE_JOINED: (s, d) => s.markJoined({ ref: d['ref'], vaultId: d['vaultId'] }),
};

/** One message's handler. `service` is resolved per request (the worker builds it lazily). */
export function vaultInviteHandler(method: VaultInviteMessage, service: () => Promise<InviteService>) {
  return async (request: Request, sendResponse: SendResponse): Promise<true> => {
    const reply = (data: Record<string, unknown>) => sendResponse({ id: request.id, data, target: TARGET, sender: SENDER.extension });
    try {
      const data = (request.data && typeof request.data === 'object' ? request.data : {}) as Data;
      const result = await VAULT_INVITE_ROUTES[method](await service(), data);
      reply({ success: true, result });
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      const details = (error as { details?: unknown } | null)?.details;
      reply({
        success: false,
        error: typeof code === 'string' ? code : 'SERVER',
        ...(details && typeof details === 'object' ? { details: JSON.parse(JSON.stringify(details)) as unknown } : {}),
      });
    }
    return true;
  };
}
