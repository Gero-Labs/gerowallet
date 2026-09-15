// Ledger-8 (Preprod / Mainnet) twin of midnightPrivateSync.ts.
//
// Runs the ledger-8 shielded SDK wallet in the background service worker with
// the wallet's own zswap keys and publishes per-colour PRIVATE balances into
// midnightStore, so the dashboard and the DApp Connector's
// getShieldedBalances() can read them on networks other than Stagenet.
// Balances only: private history rows stay Stagenet-only for now.
//
// Checkpoints under the network id — the SAME namespace the shielded-send path
// uses (midnightShieldedBuilder.startAndSyncShieldedWallet) — so a send warm-
// restores from this loop's progress and vice versa. No Nexus chain-identity
// round trip: a stale checkpoint after a chain reset is dropped by
// startShieldedWallet's restore-failure path and the loop cold-starts.
//
// COLD SYNC ON A BIG CHAIN (why this loop differs from the Stagenet one): a
// fresh Preprod wallet replays the whole shielded history, and the SDK's
// indexer client freezes such a replay once its in-flight buffer fills — the
// backpressure wrapper disposes the WebSocket subscription and its re-open
// dies silently (documented with measurements in midnightTxBuilder.ts's DUST
// sync). Stagenet is small enough never to hit it; Preprod hits it well
// before completion, leaving the status at `syncing` forever. The DUST sync's
// proven workaround is mirrored here: a large buffer, checkpoint + tear down +
// rebuild from the checkpoint when progress stalls, and periodic checkpoints
// so a service-worker restart never loses the replay.
//
// PRIVACY: the seed and keys never leave this module; nothing about notes or
// amounts is logged — status transitions, progress counters and the network.

import { sampleTime } from 'rxjs';
import type * as ledger from '@midnight-ntwrk/ledger-v8';
import { walletStore } from '@/stores/walletStore';
import { midnightActions, midnightStore } from '@/stores/midnightStore';
import type { MidnightPrivateSyncProgress } from '@/stores/midnightStore';
import type { MidnightNetworkEndpoints } from './midnightConfig';
import { loadWalletState, saveWalletState } from './midnightWalletStatePersistence';
import { startShieldedWallet } from './midnightShieldedBuilder';
import { debugLog } from '@/utils/debug';

export interface MidnightPrivateSync8Args {
  walletId: string;
  network: string;
  endpoints: MidnightNetworkEndpoints;
  seed: Uint8Array;
}

/** Same buffer the DUST sync uses: each stall-restart cycle nets ~bufferSize events. */
export const SHIELDED_INDEXER_BUFFER = 100_000;
/** No applied-index advance for this long while incomplete = the subscription is dead. */
export const PRIVATE_SYNC_STALL_MS = 45_000;
/** Checkpoint cadence while a (long) cold sync is still running. */
export const PRIVATE_SYNC_CHECKPOINT_MS = 30_000;
/** Consecutive restarts that made zero progress before giving up. */
export const PRIVATE_SYNC_MAX_BARREN_RESTARTS = 3;
/** Absolute restart cap so a broken indexer cannot loop forever. */
export const PRIVATE_SYNC_MAX_RESTARTS = 100;
const CYCLE_MS = 30_000;

/** A 32-byte colour that is not native NIGHT (NIGHT is public; an all-zero colour is never private). */
const customColor = (value: string) => /^[0-9a-fA-F]{64}$/.test(value) && !/^0+$/.test(value);

/** The slice of the SDK's ShieldedWalletState this loop reads. */
interface SdkState {
  progress: {
    appliedIndex: bigint;
    highestRelevantWalletIndex: bigint;
    isConnected: boolean;
    isStrictlyComplete(): boolean;
  };
  balances: Record<string, bigint>;
  serialize(): string;
}

/** The slice of the SDK wallet instance this loop uses (the builder's local type omits `state`). */
interface SdkWallet {
  state: {
    pipe: (...operators: unknown[]) => {
      subscribe: (observer: { next: (state: SdkState) => void; error: () => void }) => { unsubscribe(): void };
    };
  };
  stop(): Promise<void>;
}

async function bounded<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Private wallet operation timed out')), 30_000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

function progressOf(state: SdkState): MidnightPrivateSyncProgress {
  return {
    applied: Number(state.progress.appliedIndex),
    highest: Number(state.progress.highestRelevantWalletIndex),
    connected: state.progress.isConnected,
  };
}

type SdkModules = [
  typeof import('@midnight-ntwrk/ledger-v8'),
  typeof import('@midnightntwrk/wallet-sdk-shielded'),
  typeof import('@midnightntwrk/wallet-sdk-abstractions'),
  typeof import('@midnightntwrk/wallet-sdk-address-format'),
];
let sdkModules: Promise<SdkModules> | undefined;

/** Loaded once per worker; a stall-restart must not pay the import cost again. */
function loadSdkModules(): Promise<SdkModules> {
  if (!sdkModules) {
    sdkModules = Promise.all([
      import('@midnight-ntwrk/ledger-v8'),
      import('@midnightntwrk/wallet-sdk-shielded'),
      import('@midnightntwrk/wallet-sdk-abstractions'),
      import('@midnightntwrk/wallet-sdk-address-format'),
    ]);
  }
  return sdkModules;
}

let current: PrivateSync8 | undefined;

class PrivateSync8 {
  readonly seed: Uint8Array;
  private readonly owner: string | null;
  private active = true;
  private busy = false;
  private hasPublished = false;
  private pendingImmediatePublication = false;
  private timer?: ReturnType<typeof setInterval>;
  private wallet?: SdkWallet;
  private keys?: ledger.ZswapSecretKeys;
  private subscription?: { unsubscribe(): void };
  private latest?: SdkState;
  private lastApplied = -1;
  private lastAdvanceMs = 0;
  private lastCheckpointMs = 0;
  private lastCheckpointApplied = -1;
  private appliedAtAttemptStart = -1;
  private restarts = 0;
  private barrenRestarts = 0;
  /** Set once the restart caps are hit: `error` is then terminal until a new session starts. */
  private gaveUp = false;

  constructor(readonly args: MidnightPrivateSync8Args) {
    this.seed = args.seed.slice();
    this.owner = midnightStore.activeWalletKey;
  }

  private isCurrent(): boolean {
    const logged = walletStore.loggedWallet;
    return this.active && current === this && !!this.owner
      && midnightStore.activeWalletKey === this.owner && !walletStore.isLocked
      && String(logged?.id) === this.args.walletId && logged?.chain === 'Midnight'
      && String(logged?.network) === this.args.network;
  }

  async start(): Promise<void> {
    this.timer = setInterval(() => { void this.cycle(); }, CYCLE_MS);
    await this.cycle();
  }

  private async releaseWallet(): Promise<void> {
    this.subscription?.unsubscribe(); this.subscription = undefined;
    const wallet = this.wallet; const keys = this.keys;
    this.wallet = undefined; this.keys = undefined; this.latest = undefined;
    this.hasPublished = false; this.pendingImmediatePublication = false;
    try { if (wallet) await bounded(wallet.stop()); }
    finally { keys?.clear(); }
  }

  async stop(): Promise<void> {
    this.active = false;
    this.seed.fill(0);
    if (this.timer) clearInterval(this.timer);
    await this.releaseWallet();
  }

  private async checkpoint(state: SdkState, reason: string): Promise<void> {
    await saveWalletState(this.args.endpoints.sdkNetworkId, 'shielded', this.seed, state.serialize());
    this.lastCheckpointMs = Date.now();
    this.lastCheckpointApplied = Number(state.progress.appliedIndex);
    debugLog('🌙 private sync (ledger 8): checkpoint', { reason, applied: this.lastCheckpointApplied });
  }

  private async openWallet(): Promise<void> {
    const [ledgerMod, shieldedMod, abstractionsMod, addressMod] = await loadSdkModules();
    if (!this.isCurrent()) return;
    const sdkNetworkId = this.args.endpoints.sdkNetworkId;
    this.keys = ledgerMod.ZswapSecretKeys.fromSeed(this.seed);
    // The seed must derive the address the wallet advertises; otherwise a
    // wrong-wallet seed would publish someone else's balances.
    const expected = addressMod.ShieldedAddress.codec.decode(
      sdkNetworkId, addressMod.MidnightBech32m.parse(midnightStore.addresses.shielded),
    );
    if (expected.coinPublicKeyString() !== this.keys.coinPublicKey
      || expected.encryptionPublicKeyString() !== this.keys.encryptionPublicKey) {
      throw new Error('Private key does not belong to the active wallet');
    }
    const txHistoryNs = (abstractionsMod as unknown as {
      TransactionHistoryStorage: { TransactionHistoryCommonSchema: unknown };
    }).TransactionHistoryStorage;
    const txHistoryStorage = new abstractionsMod.InMemoryTransactionHistoryStorage(
      txHistoryNs.TransactionHistoryCommonSchema as ConstructorParameters<
        typeof abstractionsMod.InMemoryTransactionHistoryStorage
      >[0],
    );
    const builder = (shieldedMod as unknown as { ShieldedWallet: (config: unknown) => unknown }).ShieldedWallet({
      networkId: sdkNetworkId,
      indexerClientConnection: {
        indexerHttpUrl: this.args.endpoints.publicIndexerUrl,
        indexerWsUrl: this.args.endpoints.publicIndexerWsUrl,
        bufferSize: SHIELDED_INDEXER_BUFFER,
      },
      // Same WASM apply batching the DUST sync uses: bigger batches, no idle gap.
      batchUpdates: { size: 1000, timeout: 25, spacing: 0 },
      txHistoryStorage,
    });
    midnightActions.setPrivateSyncStatus('syncing');
    const persisted = await loadWalletState(sdkNetworkId, 'shielded', this.seed);
    if (!this.isCurrent()) return;
    const wallet = await startShieldedWallet(
      builder as Parameters<typeof startShieldedWallet>[0], this.keys, persisted, sdkNetworkId, this.seed,
    ) as unknown as SdkWallet;
    this.wallet = wallet;
    const now = Date.now();
    this.lastAdvanceMs = now;
    this.lastCheckpointMs = now;
    this.appliedAtAttemptStart = this.lastApplied;
    this.subscription = wallet.state.pipe(sampleTime(1000)).subscribe({
      next: (state) => {
        if (!this.isCurrent() || this.wallet !== wallet) return;
        this.latest = state;
        const applied = Number(state.progress.appliedIndex);
        if (applied > this.lastApplied) {
          this.lastApplied = applied;
          this.lastAdvanceMs = Date.now();
        }
        midnightActions.setPrivateSyncProgress(progressOf(state));
        if (!state.progress.isStrictlyComplete()) {
          // A lagging or reconnecting stream must not stay authoritative.
          if (midnightStore.privateSyncStatus !== 'syncing') midnightActions.setPrivateSyncStatus('syncing');
          return;
        }
        // Publish the first complete snapshot promptly; later ones ride the timer.
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
    debugLog('🌙 private sync (ledger 8): started', {
      network: sdkNetworkId, warm: !!persisted, restarts: this.restarts,
    });
  }

  /**
   * The indexer subscription stopped delivering: bank progress, tear the
   * wallet down and rebuild it from the checkpoint, which opens a FRESH
   * subscription at the saved cursor. Gives up after too many restarts, or
   * after several restarts in a row that moved nothing.
   */
  private async restartStalled(state: SdkState | undefined): Promise<void> {
    if (state) await this.checkpoint(state, 'stall-restart');
    const advanced = this.lastApplied > this.appliedAtAttemptStart;
    this.barrenRestarts = advanced ? 0 : this.barrenRestarts + 1;
    this.restarts += 1;
    debugLog('🌙 private sync (ledger 8): stalled, restarting', {
      restarts: this.restarts, barren: this.barrenRestarts, applied: this.lastApplied,
    });
    await this.releaseWallet();
    if (this.barrenRestarts >= PRIVATE_SYNC_MAX_BARREN_RESTARTS || this.restarts > PRIVATE_SYNC_MAX_RESTARTS) {
      // Terminal: no more scheduled cycles, so `error` sticks until the user
      // re-triggers sync (unlock / "Unlock private balances" / wallet switch),
      // which builds a fresh session with fresh counters.
      this.gaveUp = true;
      if (this.timer) clearInterval(this.timer);
      this.timer = undefined;
      throw new Error('Private balance synchronization is not receiving events');
    }
    await this.openWallet();
  }

  private async cycle(): Promise<void> {
    if (this.busy || this.gaveUp || !this.isCurrent()) return;
    this.busy = true;
    try {
      if (!this.wallet) {
        await this.openWallet();
        return;
      }
      const state = this.latest;
      const now = Date.now();
      if (!state?.progress.isStrictlyComplete()) {
        if (now - this.lastAdvanceMs > PRIVATE_SYNC_STALL_MS) {
          await this.restartStalled(state);
          return;
        }
        // Long cold sync: keep the replay durable across worker restarts.
        if (state && this.lastApplied > this.lastCheckpointApplied && now - this.lastCheckpointMs >= PRIVATE_SYNC_CHECKPOINT_MS) {
          await this.checkpoint(state, 'interval');
        }
        return;
      }
      if (!this.isCurrent()) return;
      const balances = Object.fromEntries(Object.entries(state.balances)
        .filter(([color, amount]) => customColor(color) && amount >= 0n)
        .map(([color, amount]) => [color.toLowerCase(), amount]));
      midnightActions.applyPrivateSnapshot(balances, []);
      this.hasPublished = true;
      await this.checkpoint(state, 'synced');
    } catch (error) {
      debugLog('🌙 private sync (ledger 8): cycle failed', error instanceof Error ? error.message : String(error));
      if (this.isCurrent()) midnightActions.setPrivateSyncStatus('error');
      await this.releaseWallet().catch(() => {});
    } finally {
      this.busy = false;
      const publishImmediately = this.pendingImmediatePublication && !this.hasPublished;
      this.pendingImmediatePublication = false;
      if (publishImmediately && this.isCurrent()) void this.cycle();
    }
  }
}

/** Copies the caller-owned seed immediately. No-op for anything but a ledger-8 network. */
export async function startMidnightPrivateSync8(args: MidnightPrivateSync8Args): Promise<void> {
  if (args.seed.length !== 32) throw new Error('Invalid private wallet seed');
  if (args.endpoints.sdkNetworkId !== 'preprod' && args.endpoints.sdkNetworkId !== 'mainnet') return;
  const next = new PrivateSync8(args);
  const previous = current;
  current = next;
  // stop() invalidates the old owner before waiting; an SDK shutdown failure
  // must not strand the replacement session.
  if (previous) await previous.stop().catch(() => {});
  if (current === next) await next.start();
}

export async function stopMidnightPrivateSync8(): Promise<void> {
  const previous = current;
  current = undefined;
  await previous?.stop();
  if (!current) midnightActions.setPrivateSyncStatus('idle');
}
