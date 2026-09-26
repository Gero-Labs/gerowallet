/**
 * Whether a wallet has already asked for its RealFi referral code.
 *
 * RealFi mints a code the first time one is read, so the Earn page only reads it after
 * the user taps for it (see `useRealFi.requestReferralCode`). Once they have, reading
 * again just returns the same code. So the tap is remembered, and later visits show the
 * code without asking again. Per network and address: a code belongs to a wallet.
 *
 * Browser storage, not a store: it is a UI preference, and losing it costs one tap.
 */
function key(network: string, address: string): string {
  return `realfi.referralOptIn:${network}:${address}`;
}

export function hasReferralOptIn(network: string, address: string): boolean {
  try {
    return localStorage.getItem(key(network, address)) === '1';
  } catch {
    return false;
  }
}

export function rememberReferralOptIn(network: string, address: string): void {
  try {
    localStorage.setItem(key(network, address), '1');
  } catch {
    // Storage unavailable: the user taps again next time, nothing worse.
  }
}
