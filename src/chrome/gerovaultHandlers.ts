/**
 * The GeroVault requests the background answers for its pages. Built here from injected
 * dependencies, so they are tested as behaviour (background.ts itself cannot be loaded by a unit
 * test); background.ts registers them with the real ones (gerovaultHandlers.spec.ts pins that).
 *
 * - `GEROVAULT_DERIVE_ACCOUNT_KEY`: the wallet's CIP-1854 account public key, from its root key
 *   (`deriveMultisigAccountKeyFlow`, the same dependencies as `DERIVE_ACCOUNT_XPUB`). Answers
 *   `{ success: true, publicKey }` or `{ success: false, error }`.
 * - `GEROVAULT_SIGN_VAULT_BUNDLE`: the wallet's own witness file for a vault spend
 *   (`signVaultBundleFlow`). Answers `{ success: true, witnessFile }` or
 *   `{ success: false, error, detail? }`, and `error: 'throttled'` with `retryAfterMs` during a
 *   back-off wait.
 *
 * Neither ever logs `request.data`: it holds the spending password. Only a public key or a witness
 * file leaves.
 */
import { SENDER, TARGET } from '@/chrome/config';
import { UnlockThrottledError } from '@/chrome/unlockGuards';
import { deriveMultisigAccountKeyFlow, type DeriveMultisigAccountKeyDeps } from '@/modules/gerovault/create/ownAccountKeyFlow';
import { signVaultBundleFlow, type SignVaultBundleDeps } from '@/modules/gerovault/spend/signBundleFlow';

interface Request {
  readonly id?: unknown;
  readonly data?: unknown;
}

type SendResponse = (response: { id: unknown; data: Record<string, unknown>; target: string; sender: string }) => void;

const reply = (request: Request, sendResponse: SendResponse, data: Record<string, unknown>) =>
  sendResponse({ id: request.id, data, target: TARGET, sender: SENDER.extension });

const codeOf = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'not-supported';
};

export function gerovaultDeriveAccountKeyHandler(deps: () => Promise<DeriveMultisigAccountKeyDeps>) {
  return async (request: Request, sendResponse: SendResponse): Promise<true> => {
    try {
      const publicKey = await deriveMultisigAccountKeyFlow((request.data ?? {}) as Parameters<typeof deriveMultisigAccountKeyFlow>[0], await deps());
      reply(request, sendResponse, { success: true, publicKey });
    } catch (error) {
      reply(request, sendResponse, { success: false, error: codeOf(error) });
    }
    return true;
  };
}

export function gerovaultSignVaultBundleHandler(deps: () => Promise<SignVaultBundleDeps>) {
  return async (request: Request, sendResponse: SendResponse): Promise<true> => {
    try {
      const witnessFile = await signVaultBundleFlow((request.data ?? {}) as Parameters<typeof signVaultBundleFlow>[0], await deps());
      reply(request, sendResponse, { success: true, witnessFile });
    } catch (error) {
      if (error instanceof UnlockThrottledError) {
        reply(request, sendResponse, { success: false, error: 'throttled', retryAfterMs: error.retryAfterMs });
      } else {
        const detail = (error as { detail?: unknown } | null)?.detail;
        reply(request, sendResponse, { success: false, error: codeOf(error), ...(typeof detail === 'string' ? { detail } : {}) });
      }
    }
    return true;
  };
}
