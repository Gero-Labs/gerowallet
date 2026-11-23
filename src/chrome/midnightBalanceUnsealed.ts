import { MidnightErrorCode } from '@/chrome/config';
import type { ConnectorBalancePrompt, ConnectorBalanceValidation } from '@/chains/midnight/midnightConnectorBalance';
import type { SiteActivityEvent } from '@/chains/midnight/midnightSiteActivity';
import { debugLog } from '@/utils/debug';
import type { ConnectorReply } from '@/chrome/connectorReply';

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
  /**
   * Whether the wallet, its network, the lock state and the site's permission are still those
   * the request was admitted with. The steps above await, and the prompt is stamped with
   * whichever wallet is active when it is parked.
   */
  sameWalletStill: () => boolean;
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
  const disconnected = () => {
    if (deps.sameWalletStill()) return false;
    reply({ error: deps.apiError(MidnightErrorCode.Disconnected, 'The active wallet changed or locked while the request was checked') });
    return true;
  };
  try {
    await deps.resolveLedger().catch(() => { /* the check below names it */ });
    const validation = deps.validate(data);
    if (validation.ok === false) {
      // A ledger the wallet could not read is its own failure, not a bad request.
      const code = validation.internal ? MidnightErrorCode.InternalError : MidnightErrorCode.InvalidRequest;
      reply({ error: deps.apiError(code, validation.reason) });
      return;
    }
    const wallet = await deps.loadWallet();
    const prompt = await deps.prompt(validation.tx, wallet.ownUnshieldedAddress);
    if (prompt.ok === false) {
      const code = prompt.internal ? MidnightErrorCode.InternalError : MidnightErrorCode.InvalidRequest;
      reply({ error: deps.apiError(code, prompt.reason) });
      return;
    }
    // No await between this check and parking: nothing can switch the wallet in between.
    if (disconnected()) return;
    // The dapp calls this after its (async) proving, so there is no user
    // gesture left to open the panel with. Park the request instead of
    // failing it (badge; delivered when the user opens the panel; immediate
    // when it is already open), as the private-balance and proof-server prompts.
    wallet.recordActivity({ type: 'funding' });
    // A synchronous failure creating the prompt belongs to the outer internal-error
    // handler. Only a rejection from the parked request can carry the panel's answer.
    const pending = deps.park({ tx: validation.tx, contributions: prompt.contributions, payments: prompt.payments });
    let response: { data?: unknown };
    try {
      response = await pending;
    } catch (err) {
      if (disconnected()) return;
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
    if (disconnected()) return;
    reply({ data: response.data }); // response.data === { tx }
    wallet.recordActivity({ type: 'funding-done' });
  } catch {
    // A failed import, prompt read or activity record still answers the dapp, which would otherwise wait forever.
    // Fixed text only: the error may carry transaction data. A no-op reply here means the answer was already sent.
    debugLog('Midnight balanceUnsealedTransaction: a step failed; answering InternalError if not yet answered');
    reply({ error: deps.apiError(MidnightErrorCode.InternalError, FAILED) });
  }
}
