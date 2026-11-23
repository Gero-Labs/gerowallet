import { MIDNIGHT_LEDGER9_FIRST_BLOCK } from './midnightLedger';
import { blockTimeToMs } from './midnightDataFreshness';

const seenInSession = new Set<string>();

/** Called when an eligible wallet's notice is on screen. Dashboard and side panel share the origin. */
export function claimDustUpgradeNotice(network: 'mainnet' | 'preprod', address: string): boolean {
  if (!address) return false;
  const key = `gero.midnight.ledger9.dust-notice.${network}.${address}`;
  if (seenInSession.has(key)) return false;
  seenInSession.add(key);
  try {
    if (localStorage.getItem(key)) return false;
    localStorage.setItem(key, '1');
  } catch { /* Storage may be unavailable. The open session still shows the notice once. */ }
  return true;
}

/** A restored wallet can predate its local creation date. Confirmed history also establishes its age. */
export function walletPredatesMainnetDustReset(createdAt: string | undefined, transactions: readonly { status: string; timestamp: number }[]): boolean {
  const reset = MIDNIGHT_LEDGER9_FIRST_BLOCK['mainnet'].timestamp;
  const created = Date.parse(createdAt ?? '');
  return (created > 0 && created < reset) || transactions.some(tx => {
    const time = blockTimeToMs(tx.timestamp);
    return tx.status === 'confirmed' && time > 0 && time < reset;
  });
}
