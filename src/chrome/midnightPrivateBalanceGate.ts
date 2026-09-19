/**
 * Background gate for the DApp Connector's `getShieldedBalances()`.
 *
 * Shielded balances exist only after the wallet has scanned the ledger with
 * its own keys (the "private sync"). Instead of failing a read that arrives
 * before that scan is done, the background parks the call, prompts the user
 * in the side panel, and answers once the store reports `synced`.
 *
 * One group per `${walletId}:${origin}`: every call from the same site joins
 * the group and gets the same outcome, so a polling dApp raises one prompt,
 * not one per poll. A decline is remembered per tab (like the connector's
 * `midnightDeclinedMethodsByTab`) so a polling dApp cannot re-prompt after
 * the user said no; closing the tab forgets it.
 *
 * Chrome-free: the store, the wallet identity and the timer are injected.
 */

import { syncedMidnightShieldedBalances } from '@/chains/midnight/midnightConnectorTransfer';
import { MidnightErrorCode } from '@/chrome/config';

export type PrivateSyncStatus = 'idle' | 'syncing' | 'synced' | 'error';

export type GateOutcome =
  | { ok: true; balances: Record<string, string> }
  | { ok: false; code: string; reason: string };

export interface GateDeps {
  status(): PrivateSyncStatus;
  balances(): Record<string, bigint>;
  /** `${walletId}:${network}` of the active, unlocked wallet; undefined when locked or none. */
  identity(): string | undefined;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export const GATE_REASON_DECLINED = 'User declined to share private balances';
export const GATE_REASON_STOPPED = 'Private balance synchronization stopped; open the Private tokens section in the wallet to restart it';
export const GATE_REASON_WALLET_CHANGED = 'Wallet locked or changed before private balances were synchronized';

/** How often a waiting group re-reads the store. */
export const PRIVATE_BALANCE_GATE_POLL_MS = 1000;

interface Group {
  tabIds: Set<number>;
  waiters: Array<(outcome: GateOutcome) => void>;
  /** Identity snapshot at join: any change means the answer would be for a different wallet. */
  identity: string | undefined;
  /** Once a scan was seen, a return to `idle` means the session was cleared, not "not started yet". */
  sawSyncing: boolean;
  timer?: unknown;
}

function failure(code: string, reason: string): GateOutcome {
  return { ok: false, code, reason };
}

export class PrivateBalanceGate {
  private readonly groups = new Map<string, Group>();
  private readonly declined = new Set<number>();

  constructor(private readonly deps: GateDeps, private readonly pollMs = PRIVATE_BALANCE_GATE_POLL_MS) {}

  /** Number of groups still waiting (tests, diagnostics). */
  get size(): number {
    return this.groups.size;
  }

  /** Add a waiter; `first` tells the caller to raise the panel prompt. */
  join(key: string, tabId: number, waiter: (outcome: GateOutcome) => void): { first: boolean } {
    const existing = this.groups.get(key);
    if (existing) {
      existing.waiters.push(waiter);
      existing.tabIds.add(tabId);
      return { first: false };
    }
    this.groups.set(key, {
      tabIds: new Set([tabId]),
      waiters: [waiter],
      identity: this.deps.identity(),
      sawSyncing: this.deps.status() === 'syncing',
    });
    return { first: true };
  }

  /** Answer every waiter of `key` once and forget the group. */
  settle(key: string, outcome: GateOutcome): void {
    const group = this.groups.get(key);
    if (!group) return;
    this.groups.delete(key);
    if (group.timer !== undefined) this.deps.clearInterval(group.timer);
    for (const waiter of group.waiters) {
      try {
        waiter(outcome);
      } catch {
        // One dead reply channel must not starve the other waiters.
      }
    }
  }

  /**
   * A scan has started (from the prompt or the dashboard): every waiting
   * group polls from now on, so the dApp is answered when the scan completes
   * even if the panel that showed the prompt is closed before then.
   */
  awaitSyncedAll(): void {
    for (const key of [...this.groups.keys()]) this.awaitSynced(key);
  }

  /** Start polling the store for `key` (after the user approved the prompt). */
  awaitSynced(key: string): void {
    const group = this.groups.get(key);
    if (!group || group.timer !== undefined) return;
    const tick = () => {
      const outcome = this.observe(group);
      if (outcome) this.settle(key, outcome);
    };
    group.timer = this.deps.setInterval(tick, this.pollMs);
    tick();
  }

  private observe(group: Group): GateOutcome | undefined {
    const identity = this.deps.identity();
    if (identity === undefined || identity !== group.identity) {
      return failure(MidnightErrorCode.Disconnected, GATE_REASON_WALLET_CHANGED);
    }
    const status = this.deps.status();
    if (status === 'synced') {
      try {
        return { ok: true, balances: syncedMidnightShieldedBalances(status, this.deps.balances()) };
      } catch (error) {
        return failure(MidnightErrorCode.InternalError, error instanceof Error ? error.message : String(error));
      }
    }
    if (status === 'error') return failure(MidnightErrorCode.InternalError, GATE_REASON_STOPPED);
    if (status === 'syncing') {
      group.sawSyncing = true;
    } else if (group.sawSyncing) {
      return failure(MidnightErrorCode.Disconnected, GATE_REASON_WALLET_CHANGED);
    }
    return undefined;
  }

  declineTab(tabId: number): void {
    this.declined.add(tabId);
  }

  isDeclined(tabId: number): boolean {
    return this.declined.has(tabId);
  }

  clearTab(tabId: number): void {
    this.declined.delete(tabId);
  }

  /** The tab is gone: its calls can no longer be answered to anyone. */
  dropTab(tabId: number): void {
    for (const [key, group] of [...this.groups]) {
      if (!group.tabIds.has(tabId)) continue;
      group.tabIds.delete(tabId);
      if (group.tabIds.size === 0) this.settle(key, failure(MidnightErrorCode.Disconnected, GATE_REASON_WALLET_CHANGED));
    }
  }
}
