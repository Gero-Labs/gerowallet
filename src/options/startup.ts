// A single budget for all pre-mount work, including locale loading. Storage
// promises continue after the deadline so their normal hydration can still land.
export const OPTIONS_STARTUP_TIMEOUT_MS = 5000;

export async function waitForOptionsStartup(
  tasks: Record<string, () => Promise<unknown>>,
  timeoutMs = OPTIONS_STARTUP_TIMEOUT_MS,
): Promise<void> {
  const pending = new Set(Object.keys(tasks));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = Promise.all(Object.entries(tasks).map(async ([name, run]) => {
    try {
      await run();
    } catch {
      // Report the operation, never stored wallet contents or backend responses.
      console.warn(`[options startup] ${name} failed; continuing with available state`);
    } finally {
      pending.delete(name);
    }
  }));
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[options startup] timed out after ${timeoutMs}ms: ${[...pending].join(', ')}`);
      resolve();
    }, timeoutMs);
  });
  try {
    await Promise.race([settled, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
