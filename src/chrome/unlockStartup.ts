/** The request no longer targets the active wallet; its credential was not checked or rejected. */
export class UnlockTargetChangedError extends Error {
  constructor() {
    super('unlock-target-changed');
    this.name = 'UnlockTargetChangedError';
  }
}

/** Bind an unlock request to the wallet shown by its UI while startup finishes. */
export async function unlockAfterStartup(
  ready: Promise<void>,
  requestedWalletId: unknown,
  currentWalletId: () => number | undefined,
  unlock: () => Promise<boolean>,
): Promise<boolean> {
  if (typeof requestedWalletId !== 'number' || !Number.isSafeInteger(requestedWalletId)) throw new UnlockTargetChangedError();
  await ready;
  if (currentWalletId() !== requestedWalletId) throw new UnlockTargetChangedError();
  return unlock();
}
