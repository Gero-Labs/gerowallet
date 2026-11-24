import * as ledger from '@midnightntwrk/ledger-v9';
import type { ShieldedWalletState, ShieldedTransactionHistoryEntry } from 'midnight-v9-shielded';
import { TransactionHistory } from 'midnight-v9-shielded/v2';
import { InMemoryTransactionHistoryStorage } from 'midnight-v9-abstractions';
import { sampleTime } from 'rxjs';
import { walletStore } from '@/stores/walletStore';
import { decodeShieldedAddress9 } from './midnightAddress9';
import { midnightActions, midnightStore } from '@/stores/midnightStore';
import type { MidnightNetworkEndpoints } from './midnightConfig';
import type { MidnightTransaction } from './midnightTypes';
import { readVerifiedMidnightChainIdentity, midnightCheckpointNamespace, type MidnightChainIdentity } from './midnightChainIdentity';
import {
  clearPrivateSyncCheckpoint, loadPrivateSyncCheckpoint, savePrivateSyncCheckpoint, saveWalletState, type PrivateSyncCheckpoint,
} from './midnightWalletStatePersistence';
import {
  forkingShieldedWallet, ledger9ShieldedWallet, shieldedKeysByEpoch, type ForkingShieldedWallet, type Ledger9ShieldedWallet,
} from './midnightShieldedWallet9';
import { midnightLedgerKey } from './midnightLedger';
import { midnightTimer, type MidnightTimer } from './midnightTiming';
import { privateSyncProgressOf, sameSyncProgress } from './midnightPrivateSyncProgress';
import { publishMidnightPrivateCoins } from './midnightPrivateCoins';

export interface MidnightPrivateSyncArgs {
  walletId: string;
  network: string;
  endpoints: MidnightNetworkEndpoints;
  seed: Uint8Array;
  /**
   * The chain crossed the ledger 9 upgrade (mainnet, preprod): run wallet SDK
   * 2's fork-aware wallet, which reads the ledger 8 history first and hands
   * over to ledger 9 at the crossing (#1452 M9). Otherwise the ledger 9
   * variant alone, for a chain born on ledger 9.
   */
  forking?: boolean;
}

const customColor = (value: string) => /^[0-9a-fA-F]{64}$/.test(value) && !/^0+$/.test(value);

/** Preserve token identity and direction; never label a private custom coin as NIGHT. */
export function privateHistoryRows(entries: readonly ShieldedTransactionHistoryEntry[]): MidnightTransaction[] {
  return entries.flatMap(entry => {
    if (!entry.shielded) return [];
    const net = new Map<string, bigint>();
    for (const [coins, sign] of [[entry.shielded.receivedCoins, 1n], [entry.shielded.spentCoins, -1n]] as const) {
      for (const coin of coins) {
        if (!customColor(coin.type)) continue;
        const color = coin.type.toLowerCase();
        net.set(color, (net.get(color) ?? 0n) + sign * coin.value);
      }
    }
    const block = entry.lifecycle.status === 'finalized' ? entry.lifecycle.finalizedBlock : undefined;
    return [...net].map(([token, amount]): MidnightTransaction => ({
      hash: entry.hash, token, amount: amount < 0n ? -amount : amount,
      type: amount < 0n ? 'send' : 'receive', counterparty: '',
      timestamp: (entry.timestamp ?? block?.timestamp)?.getTime() ?? 0,
      status: entry.lifecycle.status === 'rejected' || entry.status === 'FAILURE' ? 'failed'
        : entry.lifecycle.status === 'finalized' ? 'confirmed' : 'pending',
      fee: entry.fees ?? 0n, blockHeight: block?.height, isShielded: true,
    }));
  });
}

async function bounded<T>(work: Promise<T>, ms = 30_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Private wallet operation timed out')), ms);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

/**
 * How long a start waits for the checkpoint before replaying cold: a stalled
 * IndexedDB never holds the sync back, but a slow first open of the database
 * (a cold disk) is still cheaper to wait for than a replay of minutes.
 */
const CHECKPOINT_LOAD_TIMEOUT_MS = 10_000;

/**
 * A state is checkpointed only once it is this old AND the history has had no
 * write for this long. The SDK applies a state first and records each of its
 * transactions in the history afterwards, in the background, after an indexer
 * lookup it retries for up to 2 minutes (`transactionDetailsRetryWindow`), 8 at
 * a time. A state saved before those lookups land would resume past
 * transactions its history never recorded, and they would never come back.
 */
const CHECKPOINT_SETTLE_MS = 150_000;

/** The saved checkpoint, or null: none, unreadable or slow all mean a cold replay. */
async function loadCheckpoint(namespace: string, seed: Uint8Array): Promise<PrivateSyncCheckpoint | null> {
  try {
    return await bounded(loadPrivateSyncCheckpoint(namespace, seed), CHECKPOINT_LOAD_TIMEOUT_MS);
  } catch {
    return null;
  }
}

type History = InMemoryTransactionHistoryStorage<ShieldedTransactionHistoryEntry, unknown>;

/** Calls `onWrite` whenever the SDK records a transaction in `history`. */
function trackHistoryWrites(history: History, onWrite: () => void): History {
  for (const method of ['gotPending', 'gotFinalized', 'gotRejected'] as const) {
    const write = history[method] as ((input: never) => Promise<void>) | undefined;
    if (typeof write !== 'function') continue;
    (history as unknown as Record<string, (input: never) => Promise<void>>)[method] = (input) => {
      onWrite();
      return write.call(history, input);
    };
  }
  return history;
}

/** The history saved in `checkpoint`, or undefined when it cannot be read (then the start is cold). */
function restoredHistory(checkpoint: PrivateSyncCheckpoint): InMemoryTransactionHistoryStorage<ShieldedTransactionHistoryEntry, unknown> | undefined {
  try {
    return InMemoryTransactionHistoryStorage.restore(checkpoint.history, TransactionHistory.ShieldedTransactionHistoryEntrySchema);
  } catch {
    return undefined;
  }
}

type Wallet = Ledger9ShieldedWallet | ForkingShieldedWallet;
let current: PrivateSync | undefined;

/** The unshielded address prefix of `network`'s wallets: `mn_addr1` on mainnet, `mn_addr_<network>1` elsewhere. */
function addressPrefix(network: string): string {
  return network === 'mainnet' ? 'mn_addr1' : `mn_addr_${network}1`;
}

class PrivateSync {
  readonly seed: Uint8Array;
  private readonly network: string;
  private readonly owner: string | null;
  private active = true;
  private busy = false;
  private hasPublished = false;
  private pendingImmediatePublication = false;
  private timer?: ReturnType<typeof setInterval>;
  private wallet?: Wallet;
  private keys?: ledger.ZswapSecretKeys;
  /** The fork-aware wallet's ledger 8 keys (same seed); cleared with `keys`. */
  private keys8?: { clear(): void };
  private subscription?: { unsubscribe(): void };
  private identity?: MidnightChainIdentity;
  private latest?: ShieldedWalletState;
  private history?: History;
  /** The running wallet resumed from a checkpoint rather than replaying from the first block. */
  private restored = false;
  /** Times this wallet's start until its first complete state; cleared once logged. */
  private syncTimer?: MidnightTimer;
  /** The complete state waiting to settle before it is checkpointed, and when it was first seen. */
  private candidate?: { state: ShieldedWalletState; at: number };
  /** The state last checkpointed, so an unchanged one is not written again. */
  private savedState?: ShieldedWalletState;
  /** When the SDK last recorded a transaction in the history. */
  private lastHistoryWrite = 0;
  /** The next start ignores the checkpoint (a forced re-sync asked for a full replay). */
  private forceCold = false;
  /** A forced re-sync arrived while a cycle was running; it runs when that cycle ends. */
  private replayRequested = false;

  constructor(readonly args: MidnightPrivateSyncArgs) {
    this.seed = args.seed.slice();
    this.network = midnightLedgerKey(args.network);
    this.owner = midnightStore.activeWalletKey;
  }

  private isCurrent() {
    const logged = walletStore.loggedWallet;
    return this.active && current === this && !!this.owner && this.owner.startsWith(addressPrefix(this.network))
      && midnightStore.activeWalletKey === this.owner && !walletStore.isLocked
      && String(logged?.id) === this.args.walletId && logged?.chain === 'Midnight'
      && midnightLedgerKey(String(logged?.network)) === this.network;
  }

  async start() {
    this.timer = setInterval(() => { void this.cycle(); }, 30_000);
    await this.cycle();
  }

  private async releaseWallet() {
    this.subscription?.unsubscribe(); this.subscription = undefined;
    const wallet = this.wallet; const keys = this.keys; const keys8 = this.keys8;
    this.wallet = undefined; this.keys = undefined; this.keys8 = undefined; this.latest = undefined;
    // The coin view belongs to the running wallet: a stopped or replaced one says nothing.
    publishMidnightPrivateCoins(undefined);
    this.hasPublished = false; this.pendingImmediatePublication = false; this.candidate = undefined;
    try { if (wallet) await bounded(wallet.stop()); }
    finally { keys?.clear(); keys8?.clear(); }
  }

  /**
   * A wallet resumed from `checkpoint` and the history saved with it, or
   * undefined for a cold replay. A checkpoint the SDK cannot read is dropped,
   * so a bad one costs one cold replay, not every start.
   */
  private resume(namespace: string, checkpoint: PrivateSyncCheckpoint): { wallet: Wallet; history: History } | undefined {
    const history = restoredHistory(checkpoint);
    if (history) {
      try {
        const wallet: Wallet = this.args.forking
          ? forkingShieldedWallet(this.network, this.args.endpoints, this.tracked(history)).restore(checkpoint.state)
          : ledger9ShieldedWallet(this.network, this.args.endpoints, this.tracked(history)).restore(checkpoint.state);
        return { wallet, history };
      } catch {
        // Unreadable state: dropped below, replayed cold.
      }
    }
    // Only the private sync's own row: the send path's `shielded` row is its own.
    if (this.isCurrent()) void clearPrivateSyncCheckpoint(namespace, this.seed).catch(() => {});
    return undefined;
  }

  /** A history whose writes hold back the next checkpoint (`CHECKPOINT_SETTLE_MS`). */
  private tracked(history: History): History {
    return trackHistoryWrites(history, () => { this.lastHistoryWrite = Date.now(); });
  }

  /**
   * Checkpoint a state once it has settled: seen at least `CHECKPOINT_SETTLE_MS`
   * ago with no history write since that long, so every lookup for its
   * transactions has landed or given up. The history is read now, so it is
   * never behind the state (one ahead is fine: a replayed transaction is
   * upserted by its hash). Then the newest state waits its turn.
   */
  private async saveSettledCheckpoint(namespace: string, latest: ShieldedWalletState) {
    const now = Date.now();
    const candidate = this.candidate;
    if (!candidate) { this.candidate = { state: latest, at: now }; return; }
    if (now - candidate.at < CHECKPOINT_SETTLE_MS || now - this.lastHistoryWrite < CHECKPOINT_SETTLE_MS) return;
    this.candidate = candidate.state === latest ? undefined : { state: latest, at: now };
    if (candidate.state === this.savedState) return;
    const history = await this.history!.serialize();
    // stop() zeroes the seed: never derive a storage key from it after a stop or a switch.
    if (!this.isCurrent()) return;
    await savePrivateSyncCheckpoint(namespace, this.seed, { state: candidate.state.serialize(), history });
    this.savedState = candidate.state;
  }

  /**
   * A forced re-sync: drop the checkpoint and the running wallet, and replay
   * from the first block. The running wallet would otherwise save the same
   * checkpoint again.
   */
  async replayCold() {
    if (!this.isCurrent()) return;
    if (this.busy) { this.replayRequested = true; return; }
    this.busy = true;
    try {
      this.forceCold = true;
      await this.releaseWallet();
      if (this.identity && this.isCurrent()) {
        await clearPrivateSyncCheckpoint(midnightCheckpointNamespace(this.identity), this.seed).catch(() => {});
      }
    } finally {
      this.busy = false;
    }
    await this.cycle();
  }

  async stop() {
    this.active = false;
    this.seed.fill(0);
    if (this.timer) clearInterval(this.timer);
    await this.releaseWallet();
  }

  private async cycle() {
    if (this.busy || !this.isCurrent()) return;
    this.busy = true;
    try {
      const identity = await readVerifiedMidnightChainIdentity(this.args.endpoints);
      if (!this.isCurrent()) return;
      if (!this.wallet || this.identity?.chain_generation !== identity.chain_generation
        || this.identity?.genesis_hash !== identity.genesis_hash) {
        await this.releaseWallet();
        if (!this.isCurrent()) return;
        this.identity = identity;
        const namespace = midnightCheckpointNamespace(identity);
        this.syncTimer = midnightTimer('private sync');
        const checkpoint = this.forceCold ? null : await loadCheckpoint(namespace, this.seed);
        this.forceCold = false;
        this.syncTimer.lap('checkpointLoad');
        if (!this.isCurrent()) return;
        this.keys = ledger.ZswapSecretKeys.fromSeed(this.seed);
        const expected = decodeShieldedAddress9(this.network, midnightStore.addresses.shielded);
        if (expected.coinPublicKey.toHexString() !== this.keys.coinPublicKey
          || expected.encryptionPublicKey.toHexString() !== this.keys.encryptionPublicKey)
          throw new Error('Private key does not belong to the active wallet');
        let start: { v9: ledger.ZswapSecretKeys; v8?: unknown } = { v9: this.keys };
        if (this.args.forking) {
          const both = await shieldedKeysByEpoch(this.seed);
          // A stop or switch during that import (the first loads ledger 8) must start nothing.
          if (!this.isCurrent()) { both.v8.clear(); both.v9.clear(); await this.releaseWallet(); return; }
          this.keys8 = both.v8;
          start = { v8: both.v8, v9: this.keys };
          both.v9.clear();
        }
        // Resume from the last checkpoint (its state and the history saved with
        // it) and read only the events after it. Without one, replay from the
        // first block, which also rebuilds the private history.
        const resumed = checkpoint ? this.resume(namespace, checkpoint) : undefined;
        this.restored = !!resumed;
        if (resumed) {
          this.history = resumed.history;
          this.wallet = resumed.wallet;
        } else if (this.args.forking) {
          this.history = this.tracked(new InMemoryTransactionHistoryStorage(TransactionHistory.ShieldedTransactionHistoryEntrySchema));
          // Asynchronous: it asks the indexer which side of the fork the chain is on first.
          this.wallet = await bounded(forkingShieldedWallet(this.network, this.args.endpoints, this.history)
            .startWithKeys(start as Parameters<ReturnType<typeof forkingShieldedWallet>['startWithKeys']>[0]));
          if (!this.isCurrent()) { await this.releaseWallet(); return; }
        } else {
          this.history = this.tracked(new InMemoryTransactionHistoryStorage(TransactionHistory.ShieldedTransactionHistoryEntrySchema));
          this.wallet = ledger9ShieldedWallet(this.network, this.args.endpoints, this.history).startWithSecretKeys(this.keys);
        }
        this.syncTimer.note({ warm: this.restored });
        midnightActions.setPrivateSyncStatus('syncing');
        const wallet = this.wallet;
        this.subscription = wallet.state.pipe(sampleTime(1000)).subscribe({
          next: state => {
            if (!this.isCurrent() || this.wallet !== wallet) return;
            this.latest = state;
            if (!state.progress.isStrictlyComplete()) {
              // Cached amounts are retained, but a disconnected or lagging
              // stream must not remain authoritative for UI/connector reads.
              if (midnightStore.privateSyncStatus !== 'syncing') midnightActions.setPrivateSyncStatus('syncing');
              // The dashboard's "events applied" line and mini-Gero's scan bar
              // read these counters. Written only when they move: each write is
              // broadcast and persisted.
              const progress = privateSyncProgressOf(state.progress);
              if (!sameSyncProgress(midnightStore.privateSyncProgress, progress)) {
                midnightActions.setPrivateSyncProgress(progress);
              }
              return;
            }
            // Publish the first complete snapshot promptly. Later events only
            // update the candidate; the timer verifies/publishes every 30s.
            if (!this.hasPublished) {
              if (this.busy) this.pendingImmediatePublication = true;
              else void this.cycle();
            }
          },
          error: () => {
            if (this.isCurrent()) {
              midnightActions.setPrivateSyncStatus('error');
              void this.releaseWallet().catch(() => {});
            }
          },
        });
        // Called as a method, so the SDK's `this` is intact.
        await bounded((wallet as unknown as { start(keys: typeof start): Promise<void> }).start(start));
        // A complete event can arrive while start() is pending. The finally
        // below queues a fresh verified cycle without losing that first event.
        return;
      }
      const state = this.latest;
      if (!state?.progress.isStrictlyComplete() || !this.isCurrent() || !this.keys) return;
      if (state.coinPublicKey.toHexString() !== this.keys.coinPublicKey
        || state.encryptionPublicKey.toHexString() !== this.keys.encryptionPublicKey) {
        // A resumed state of another key: drop it, so the next start replays cold instead of failing again.
        if (this.restored && this.isCurrent()) {
          await clearPrivateSyncCheckpoint(midnightCheckpointNamespace(identity), this.seed).catch(() => {});
        }
        throw new Error('Private wallet identity mismatch');
      }
      const observed = midnightStore.chainIdentity;
      if (observed?.network !== identity.network || observed.generation !== identity.chain_generation
        || observed.genesisHash !== identity.genesis_hash) return;
      const entries = await this.history!.getAll();
      const stillObserved = midnightStore.chainIdentity;
      if (!this.isCurrent() || this.latest !== state || stillObserved?.network !== identity.network
        || stillObserved.generation !== identity.chain_generation || stillObserved.genesisHash !== identity.genesis_hash) return;
      const balances = Object.fromEntries(Object.entries(state.balances)
        .filter(([color, amount]) => customColor(color) && amount >= 0n)
        .map(([color, amount]) => [color.toLowerCase(), amount]));
      midnightActions.applyPrivateSnapshot(balances, privateHistoryRows(entries));
      // For the swap records (midnightSwapRecords.ts): the coins held now, by nullifier and commitment.
      // Coins the wallet only expects (pendingCoins) are left out: they have not arrived.
      // Never in the way of the sync itself: without a view the swap screens fall back to the clock.
      try {
        const available = state.availableCoins ?? [];
        const reserved = state.reservedCoins ?? [];
        publishMidnightPrivateCoins(this.owner ? {
          walletKey: this.owner,
          nullifiers: new Set([...available, ...reserved].map(coin => coin.nullifier.toLowerCase())),
          commitments: new Set(available.map(coin => coin.commitment.toLowerCase())),
          at: Date.now(),
        } : undefined);
      } catch {
        publishMidnightPrivateCoins(undefined);
      }
      this.hasPublished = true;
      this.syncTimer?.done(); this.syncTimer = undefined;
      // Secret seed is used only to derive the opaque cache key, never stored.
      // The newest state for the shielded send path (which keeps no history), as before.
      const namespace = midnightCheckpointNamespace(identity);
      await saveWalletState(namespace, 'shielded', this.seed, state.serialize());
      try {
        await this.saveSettledCheckpoint(namespace, state);
      } catch {
        // Only costs the next start a longer catch-up.
      }
    } catch {
      this.syncTimer?.done('failed'); this.syncTimer = undefined;
      if (this.isCurrent()) midnightActions.setPrivateSyncStatus('error');
      await this.releaseWallet().catch(() => {});
    } finally {
      this.busy = false;
      const publishImmediately = this.pendingImmediatePublication && !this.hasPublished;
      this.pendingImmediatePublication = false;
      if (publishImmediately && this.isCurrent()) void this.cycle();
      if (this.replayRequested) { this.replayRequested = false; void this.replayCold(); }
    }
  }
}

/**
 * The ledger 9 private-note sync, for a chain that was on ledger 9 from its
 * first block (the session checks that). Copies the ephemeral seed
 * immediately; callers retain ownership of their input.
 */
export async function startMidnightPrivateSync(args: MidnightPrivateSyncArgs): Promise<void> {
  if (args.seed.length !== 32) throw new Error('Invalid private wallet seed');
  if (args.endpoints.sdkNetworkId !== midnightLedgerKey(args.network)) return;
  const next = new PrivateSync(args);
  const previous = current;
  current = next;
  // stop() invalidates the old owner before waiting and clears its keys in
  // finally. An SDK shutdown failure must not strand the replacement session.
  if (previous) await previous.stop().catch(() => {});
  if (current === next) await next.start();
}

/**
 * A forced re-sync (midnight-sync.service `forceResync`): the running private
 * sync drops its checkpoint and replays from the first block. Without this it
 * would keep its wallet and save the same checkpoint again.
 */
export async function replayMidnightPrivateSyncCold(): Promise<void> {
  await current?.replayCold();
}

export async function stopMidnightPrivateSync(): Promise<void> {
  const previous = current;
  current = undefined;
  await previous?.stop();
  if (!current) midnightActions.setPrivateSyncStatus('idle');
}
