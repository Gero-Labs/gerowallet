// Builds a concise snapshot of the CONNECTED wallet so the agent answers portfolio
// questions with real data instead of telling the user to "connect your wallet".
// The dock only renders inside an unlocked wallet, so this is always available there.
import { walletStore } from '@/stores/walletStore';

export interface WalletHolding {
  ticker: string;
  amount: string;
}

export interface WalletContextSnapshot {
  connected: boolean;
  summary: string;
  network?: string;
  adaBalance?: string;
  tokenCount?: number;
  topHoldings?: WalletHolding[];
  delegatedPool?: string | null;
  withdrawableRewardsAda?: string;
}

interface TokenLike {
  unit: string;
  quantity: bigint | string | number;
  name?: string;
  metadata?: { ticker?: string; name?: string; decimals?: number } | null;
}

interface StoreLike {
  loggedWallet: { network?: string; name?: string; stakeAddress?: string } | null;
  isLocked: boolean;
  tokens: Record<string, TokenLike>;
  account: { controlled_amount?: string; withdrawable_amount?: string; pool_id?: string } | null;
}

/** Format a smallest-unit quantity to a human amount with up to 4 trimmed fractional digits. */
function fmtAmount(qty: bigint | string | number, decimals: number): string {
  let q: bigint;
  try {
    q = typeof qty === 'bigint' ? qty : BigInt(String(qty).split('.')[0] || '0');
  } catch {
    return '0';
  }
  const d = decimals > 0 ? decimals : 0;
  if (d === 0) return q.toString();
  const base = 10n ** BigInt(d);
  const whole = q / base;
  const frac = q % base;
  if (frac === 0n) return whole.toString();
  const fracStr = (base + frac).toString().slice(1).replace(/0+$/, '').slice(0, 4);
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

/**
 * Snapshot the connected wallet for the agent. Injectable store for tests; defaults to the
 * live walletStore singleton. The summary is plain reference DATA (never instructions).
 */
export function buildWalletContext(
  store: StoreLike = walletStore as unknown as StoreLike,
): WalletContextSnapshot {
  const w = store.loggedWallet;
  const connected = !!w && !store.isLocked;
  if (!connected || !w) {
    return { connected: false, summary: 'No Gero wallet is currently connected or it is locked.' };
  }

  const network = w.network || 'mainnet';
  const tokens = (store.tokens || {}) as Record<string, TokenLike>;
  const acct = store.account;

  const lovelace = tokens['lovelace'];
  const adaBalance = lovelace
    ? fmtAmount(lovelace.quantity, 6)
    : acct?.controlled_amount
      ? fmtAmount(acct.controlled_amount, 6)
      : '0';

  const native = Object.values(tokens).filter((t) => t && t.unit !== 'lovelace');
  const tokenCount = native.length;
  const topHoldings: WalletHolding[] = native.slice(0, 8).map((t) => ({
    ticker: String(t.metadata?.ticker || t.name || t.metadata?.name || t.unit.slice(0, 6) || 'token'),
    amount: fmtAmount(t.quantity, t.metadata?.decimals ?? 0),
  }));

  const delegatedPool = acct?.pool_id || null;
  const withdrawableRewardsAda = acct?.withdrawable_amount ? fmtAmount(acct.withdrawable_amount, 6) : '0';

  const holdingsStr =
    tokenCount === 0
      ? 'none'
      : topHoldings.map((h) => `${h.ticker} ${h.amount}`).join(', ') +
        (tokenCount > topHoldings.length ? `, plus ${tokenCount - topHoldings.length} more` : '');
  const stakingStr = delegatedPool ? `delegated (pool ${delegatedPool.slice(0, 12)})` : 'not delegated';

  const summary =
    `The user's Gero wallet IS connected and unlocked, so never ask them to connect. ` +
    `Network: ${network}. ADA balance: ${adaBalance} ADA. ` +
    `Native tokens (${tokenCount}): ${holdingsStr}. ` +
    `Staking: ${stakingStr}. Withdrawable rewards: ${withdrawableRewardsAda} ADA.`;

  return {
    connected: true,
    summary,
    network,
    adaBalance,
    tokenCount,
    topHoldings,
    delegatedPool,
    withdrawableRewardsAda,
  };
}
