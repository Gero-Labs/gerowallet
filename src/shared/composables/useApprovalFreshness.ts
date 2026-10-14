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

/** Value snapshot of an approval context; `null` (unserializable) always counts as a change. */
function fingerprint(value: unknown): string | null {
  try {
    return JSON.stringify(value, (_key, item: unknown) => {
      if (item === undefined) return '\u0000undefined';
      if (typeof item === 'bigint') return `${item}n`;
      if (item instanceof Map || item instanceof Set) return [...item];
      if (ArrayBuffer.isView(item)) return Array.from(new Uint8Array(item.buffer, item.byteOffset, item.byteLength));
      return item;
    });
  } catch {
    return null;
  }
}

export function useApprovalFreshness(context: () => unknown, active: () => boolean = () => true, onInvalidate: () => void = () => {}) {
  let epoch = 0;
  let disposed = false;
  let running = false;
  const invalidate = () => { epoch += 1; onInvalidate(); };
  // A deep watch also re-runs when a dependency is replaced by an equal value
  // (the store re-broadcasting the same wallet); only a changed value invalidates.
  let snapshot = fingerprint(context());
  watch(context, (next) => {
    const current = fingerprint(next);
    if (current !== null && current === snapshot) return;
    snapshot = current;
    invalidate();
  }, { deep: true, flush: 'sync' });
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
