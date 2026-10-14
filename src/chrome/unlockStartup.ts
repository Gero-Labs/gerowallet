/** Bind an unlock request to the wallet shown by its UI while startup finishes. */
export async function unlockAfterStartup(
  ready: Promise<void>,
  requestedWalletId: unknown,
  currentWalletId: () => number | undefined,
  unlock: () => Promise<boolean>,
): Promise<boolean> {
  if (typeof requestedWalletId !== 'number' || !Number.isSafeInteger(requestedWalletId)) return false;
  await ready;
  if (currentWalletId() !== requestedWalletId) return false;
  return unlock();
}
