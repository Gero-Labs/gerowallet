// Permission to sign a dApp's Solana transaction message, held by the worker while a side-panel
// prompt for that exact, previewed message is open, and checked by SIGN_SOLANA_TRANSACTION before
// any secret is opened. Without it the worker signs no transaction message for an extension
// page: a page can only get a signature for what the user was shown. In worker memory only; a
// worker restart drops every allowance (the user prepares again).
//
// It lasts as long as the prompt (and at most SOLANA_TX_ALLOWANCE_TTL_MS), not one signature: an
// ed25519 signature is deterministic, so signing the same message again yields the same bytes and
// gives nothing more away, and a wrong password or a cancelled PassKey can simply be retried.
// Counted per prompt: a dApp that sends the same bytes twice (a retry, a double click) parks two
// prompts, and one settling never takes the other's away.

export const SOLANA_TX_ALLOWANCE_TTL_MS = 10 * 60 * 1000;

interface Entry { count: number; expiresAt: number }

const allowances = new Map<string, Entry>();
const keyOf = (walletId: number, messageKey: string) => `${walletId}:${messageKey}`;

/** A prompt for this wallet and message opened; refreshes the expiry. */
export function grantSolanaTxAllowance(walletId: number, messageKey: string, now = Date.now()): void {
  const key = keyOf(walletId, messageKey);
  const entry = allowances.get(key);
  allowances.set(key, { count: (entry && entry.expiresAt > now ? entry.count : 0) + 1, expiresAt: now + SOLANA_TX_ALLOWANCE_TTL_MS });
}

/** Whether this wallet may sign this message now: a prompt for it is open and not expired. */
export function hasSolanaTxAllowance(walletId: number, messageKey: string, now = Date.now()): boolean {
  const entry = allowances.get(keyOf(walletId, messageKey));
  return !!entry && entry.count > 0 && entry.expiresAt > now;
}

/** A prompt settled (signed, declined, abandoned): its count goes. */
export function releaseSolanaTxAllowance(walletId: number, messageKey: string): void {
  const key = keyOf(walletId, messageKey);
  const entry = allowances.get(key);
  if (!entry) return;
  if (entry.count <= 1) allowances.delete(key);
  else entry.count -= 1;
}

export function clearSolanaTxAllowancesForTests(): void {
  allowances.clear();
}
