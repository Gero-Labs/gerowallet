/** Bound shared authentication promises without cancelling authentication for other callers. */
export function withMidnightAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error('Midnight request aborted'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) { signal.removeEventListener('abort', abort); abort(); }
  });
}
