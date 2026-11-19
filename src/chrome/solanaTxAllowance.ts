// One-shot permission to sign a dApp's Solana transaction message, granted by the worker when it
// has decoded and previewed that exact message, consumed by the side panel's
// SIGN_SOLANA_TRANSACTION. Without it the worker signs no transaction message for an extension
// page: a page can only get a signature for what the user was shown. In worker memory only;
// a worker restart drops every allowance (the user prepares again).

export const SOLANA_TX_ALLOWANCE_TTL_MS = 10 * 60 * 1000;

const allowances = new Map<string, { walletId: number; expiresAt: number }>();

export function grantSolanaTxAllowance(walletId: number, messageKey: string, now = Date.now()): void {
  allowances.set(messageKey, { walletId, expiresAt: now + SOLANA_TX_ALLOWANCE_TTL_MS });
}

/** True once: for the same wallet and message, before it expires. Always removes the allowance. */
export function consumeSolanaTxAllowance(walletId: number, messageKey: string, now = Date.now()): boolean {
  const entry = allowances.get(messageKey);
  allowances.delete(messageKey);
  return !!entry && entry.walletId === walletId && entry.expiresAt > now;
}

export function revokeSolanaTxAllowance(messageKey: string): void {
  allowances.delete(messageKey);
}

export function clearSolanaTxAllowancesForTests(): void {
  allowances.clear();
}
