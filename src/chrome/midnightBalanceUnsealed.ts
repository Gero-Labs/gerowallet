import { MidnightErrorCode } from '@/chrome/config';
import type { ConnectorBalancePrompt, ConnectorBalanceValidation } from '@/chains/midnight/midnightConnectorBalance';
import type { SiteActivityEvent } from '@/chains/midnight/midnightSiteActivity';

export interface ConnectorReply {
  data?: unknown;
  error?: unknown;
}

/**
 * Wraps a connector handler's `sendResponse` so the dapp is answered once only:
 * the catch-all in `answerBalanceUnsealedTransaction` must never answer a request
 * that was already answered.
 */
export function replyOnce(send: (opts: ConnectorReply) => void): (opts: ConnectorReply) => void {
  let replied = false;
  return (opts) => {
    if (replied) return;
    replied = true;
    send(opts);
  };
}

/** What the wallet needs from the lazily loaded Midnight store. */
export interface BalanceUnsealedWalletSide {
  ownUnshieldedAddress: string;
  recordActivity: (event: SiteActivityEvent) => void;
}

/** Everything bound to the worker; `background.ts` supplies them, specs replace them. */
export interface BalanceUnsealedDeps {
  /** Learns which ledger the chain runs; a failure is named by `validate`. */
  resolveLedger: () => Promise<unknown>;
  validate: (data: unknown) => ConnectorBalanceValidation;
  loadWallet: () => Promise<BalanceUnsealedWalletSide>;
  prompt: (tx: string, ownUnshieldedAddress: string) => Promise<ConnectorBalancePrompt>;
  /** Parks the approval for the dapp's tab; resolves with the panel's answer (`data: { tx }`). */
  park: (data: { tx: string } & Omit<Extract<ConnectorBalancePrompt, { ok: true }>, 'ok'>) => Promise<{ data?: unknown }>;
  apiError: (code: string, reason: string) => unknown;
  /** Decodes the panel's failure, falling back to the given code and reason. */
  parseParkError: (err: unknown, fallbackCode: string, fallbackReason: string) => { code: string };
}

const FAILED = 'Failed to complete the balancing request';

/**
 * The asynchronous part of the DApp Connector's balanceUnsealedTransaction:
 * validate, summarize what the wallet adds, then park the approval for the
 * side panel. Answers through `reply` on every path, a throw included, so the
 * dapp's promise never waits forever; `reply` must come from `replyOnce`.
 */
export async function answerBalanceUnsealedTransaction(
  data: unknown,
  reply: (opts: ConnectorReply) => void,
  deps: BalanceUnsealedDeps,
): Promise<void> {
  try {
    await deps.resolveLedger().catch(() => { /* the check below names it */ });
    const validation = deps.validate(data);
    if (validation.ok === false) {
      reply({ error: deps.apiError(MidnightErrorCode.InvalidRequest, validation.reason) });
      return;
    }
    const wallet = await deps.loadWallet();
    const prompt = await deps.prompt(validation.tx, wallet.ownUnshieldedAddress);
    if (prompt.ok === false) {
      reply({ error: deps.apiError(MidnightErrorCode.InvalidRequest, prompt.reason) });
      return;
    }
    // The dapp calls this after its (async) proving, so there is no user
    // gesture left to open the panel with. Park the request instead of
    // failing it (badge; delivered when the user opens the panel; immediate
    // when it is already open), as the private-balance and proof-server prompts.
    wallet.recordActivity({ type: 'funding' });
    let response: { data?: unknown };
    try {
      response = await deps.park({ tx: validation.tx, contributions: prompt.contributions, payments: prompt.payments });
    } catch (err) {
      const error = deps.parseParkError(err, MidnightErrorCode.InternalError, FAILED);
      // Answer first: recording the activity must not change or block the dapp's answer.
      reply({ error });
      wallet.recordActivity({
        type: 'funding-failed',
        reason: error.code === MidnightErrorCode.Rejected ? 'declined' : 'other',
      });
      return;
    }
    // Answer first: a failure to record the activity must not turn a built transaction into an error.
    reply({ data: response.data }); // response.data === { tx }
    wallet.recordActivity({ type: 'funding-done' });
  } catch {
    // A failed import, prompt read or activity record still answers the dapp, which would otherwise wait forever.
    reply({ error: deps.apiError(MidnightErrorCode.InternalError, FAILED) });
  }
}
