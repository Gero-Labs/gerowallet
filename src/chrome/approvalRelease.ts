/**
 * Re-check, at the moment a signing result is handed back to the dApp, that
 * the consent behind it still holds: the origin is still connected and the
 * active wallet is the one the request was issued against. A prompt that was
 * open while the user revoked the site, or switched wallet, must not deliver.
 */
export interface ApprovalContext {
  origin: string | undefined;
  walletIdAtRequest: string | number | undefined;
}

export function approvalStillValid(
  ctx: ApprovalContext,
  isWhitelisted: (origin: string) => boolean,
  activeWalletId: string | number | undefined,
): boolean {
  if (!ctx.origin || !isWhitelisted(ctx.origin)) return false;
  // A request issued with no wallet logged in can't be pinned; one that was
  // must still be answered by that same wallet.
  if (ctx.walletIdAtRequest !== undefined && activeWalletId !== ctx.walletIdAtRequest) return false;
  return true;
}
