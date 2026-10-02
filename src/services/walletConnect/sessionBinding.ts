/**
 * A WalletConnect session is consent given by ONE wallet: the accounts approved
 * in its namespaces. Requests must only be answered while that wallet is the
 * active one. Otherwise, after a wallet switch, the peer would read (and be
 * offered signatures from) a wallet the user never connected to it.
 */

import { buildCAIP10Account, resolveCAIP2Chain } from '@/services/walletConnect/chainUtils';

interface SessionLike {
  namespaces?: Record<string, { accounts?: string[] } | undefined>;
}

interface WalletLike {
  id?: number | string;
  chain?: string;
  network?: string;
  baseAddress?: string;
  bitcoinAddress?: string;
}

/**
 * The CAIP-10 account the session approval offered for this wallet:
 * `<namespace>:<reference>:<address>`, built exactly as `approveSession` does.
 * The chain and network are part of the identity: one seed restored on Cardano
 * Preprod and Preview has the same `addr_test…` address on both, but the
 * accounts `cip34:0-1:…` and `cip34:0-2:…` are different consent.
 */
export function walletCaip10Account(wallet: WalletLike | null | undefined): string | null {
  if (!wallet?.chain || !wallet.network) return null;
  const caip2 = resolveCAIP2Chain(wallet.chain, wallet.network);
  if (!caip2) return null;
  const address = caip2.startsWith('bip122:') ? wallet.bitcoinAddress : wallet.baseAddress;
  return address ? buildCAIP10Account(caip2, address) : null;
}

/** The full CAIP-10 accounts approved in the session. */
export function sessionApprovedAccounts(session: SessionLike | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const ns of Object.values(session?.namespaces ?? {})) {
    for (const account of ns?.accounts ?? []) {
      if (typeof account === 'string' && account) out.add(account);
    }
  }
  return out;
}

/**
 * True when the active wallet is the one the session was approved for, on the
 * same chain and network, and, when the request names a `chainId`, that chain
 * is the wallet's own (a request for another chain is never answered with this
 * wallet).
 */
export function sessionAuthorizesWallet(
  session: SessionLike | null | undefined,
  wallet: WalletLike | null | undefined,
  requestChainId?: string,
): boolean {
  if (!session) return false;
  const account = walletCaip10Account(wallet);
  if (!account || !sessionApprovedAccounts(session).has(account)) return false;
  if (requestChainId !== undefined) {
    const caip2 = account.slice(0, account.lastIndexOf(':'));
    if (requestChainId !== caip2) return false;
  }
  return true;
}

/**
 * Re-check, at the moment a signature is about to be released, what was
 * checked when the request arrived. Approval can take minutes; in that time
 * the peer may have disconnected the session, the user may have switched
 * wallets, networks or locked. Only the same, still unlocked wallet, on the
 * same chain and network, that the live session authorizes for the request's
 * chain may have its signature returned.
 */
export function authorizationStillHolds(
  session: SessionLike | null | undefined,
  walletAtRequest: WalletLike | null | undefined,
  currentWallet: WalletLike | null | undefined,
  isLocked: boolean,
  requestChainId?: string,
): boolean {
  if (isLocked || !walletAtRequest || !currentWallet) return false;
  if (walletAtRequest.id !== currentWallet.id || walletCaip10Account(walletAtRequest) !== walletCaip10Account(currentWallet)) return false;
  return sessionAuthorizesWallet(session, currentWallet, requestChainId);
}
