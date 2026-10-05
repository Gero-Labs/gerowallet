import type { RealFiOrderKind } from './services/realfiOrders';

/**
 * Orders this wallet sent that RealFi has not listed yet.
 *
 * RealFi indexes asynchronously, and on preprod that has taken longer than two
 * minutes. Held only in memory, a pending order vanished on refresh and the page
 * looked as if nothing had been sent. So they are kept per network and address until
 * RealFi lists them, or until `PENDING_MAX_AGE_MS`, past which something else is wrong
 * and a stale "pending" row would only mislead.
 *
 * Browser storage: losing it costs a row that reappears once RealFi lists the order.
 */
export interface PendingOrder {
  txId: string;
  kind: RealFiOrderKind;
  /** When it was submitted, epoch millis. */
  at: number;
}

export const PENDING_MAX_AGE_MS = 30 * 60 * 1000;

const KINDS: readonly RealFiOrderKind[] = ['stake', 'unstake', 'claim', 'cancel'];

function key(network: string, address: string): string {
  return `realfi.pendingOrders:${network}:${address}`;
}

function isPendingOrder(v: unknown): v is PendingOrder {
  if (!v || typeof v !== 'object') return false;
  const p = v as Partial<PendingOrder>;
  return (
    typeof p.txId === 'string' &&
    /^[0-9a-f]{64}$/i.test(p.txId) &&
    KINDS.includes(p.kind as RealFiOrderKind) &&
    typeof p.at === 'number' &&
    Number.isFinite(p.at)
  );
}

export function readPendingOrders(
  network: string,
  address: string,
  now: number = Date.now(),
): PendingOrder[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key(network, address)) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPendingOrder).filter((p) => now - p.at < PENDING_MAX_AGE_MS);
  } catch {
    return [];
  }
}

export function savePendingOrders(network: string, address: string, list: PendingOrder[]): void {
  try {
    if (list.length) localStorage.setItem(key(network, address), JSON.stringify(list));
    else localStorage.removeItem(key(network, address));
  } catch {
    // Storage unavailable: the rows live for this visit only.
  }
}
