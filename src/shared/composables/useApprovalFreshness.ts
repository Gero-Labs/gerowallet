import { onScopeDispose, provide, watch } from 'vue';
import { authorizationScopeKey } from './authorizationScope';

export class StaleApprovalError extends Error {
  constructor() { super('Approval is no longer current'); this.name = 'StaleApprovalError'; }
}

/** Prevent work that resumes after an asynchronous boundary from reusing consent. */
export async function awaitFreshApproval<T>(work: () => T | PromiseLike<T>, current: () => boolean): Promise<T> {
  if (!current()) throw new StaleApprovalError();
  const result = await work();
  if (!current()) {
    if (result instanceof Uint8Array) result.fill(0);
    throw new StaleApprovalError();
  }
  return result;
}

export function useApprovalFreshness(context: () => unknown, active: () => boolean = () => true, onInvalidate: () => void = () => {}) {
  let epoch = 0;
  let disposed = false;
  let running = false;
  const invalidate = () => { epoch += 1; onInvalidate(); };
  watch(context, invalidate, { deep: true, flush: 'sync' });
  watch(active, invalidate, { flush: 'sync' });
  onScopeDispose(() => { disposed = true; invalidate(); });
  const capture = () => {
    const captured = epoch;
    return () => !disposed && active() && epoch === captured;
  };
  provide(authorizationScopeKey, { capture });
  /** Keep repeated clicks and delayed authentication callbacks in one flight. */
  const run = async (work: () => Promise<void>) => {
    if (running || !capture()()) return;
    running = true;
    try { await work(); }
    catch (error) { if (!(error instanceof StaleApprovalError)) throw error; }
    finally { running = false; }
  };
  return { capture, invalidate, run };
}
