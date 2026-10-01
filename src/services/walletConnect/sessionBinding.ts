/**
 * A WalletConnect session is consent given by ONE wallet: the accounts approved
 * in its namespaces. Requests must only be answered while that wallet is the
 * active one. Otherwise, after a wallet switch, the peer would read (and be
 * offered signatures from) a wallet the user never connected to it.
 */

interface SessionLike {
  namespaces?: Record<string, { accounts?: string[] } | undefined>;
}

interface WalletLike {
  baseAddress?: string;
  bitcoinAddress?: string;
}

/** Addresses approved in the session (the account part of each CAIP-10 id). */
export function sessionApprovedAddresses(session: SessionLike | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const ns of Object.values(session?.namespaces ?? {})) {
    for (const account of ns?.accounts ?? []) {
      const address = String(account).split(':').pop();
      if (address) out.add(address);
    }
  }
  return out;
}

/** True when the active wallet is the one the session was approved for. */
export function sessionAuthorizesWallet(session: SessionLike | null | undefined, wallet: WalletLike | null | undefined): boolean {
  if (!session || !wallet) return false;
  const approved = sessionApprovedAddresses(session);
  return [wallet.baseAddress, wallet.bitcoinAddress].some((a) => !!a && approved.has(a));
}
