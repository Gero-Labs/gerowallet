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
// PRIVACY: the seed and keys never leave this module; nothing about notes or
// amounts is logged — status transitions and the network only.

import { sampleTime } from 'rxjs';
import type * as ledger from '@midnight-ntwrk/ledger-v8';
import { walletStore } from '@/stores/walletStore';
import { midnightActions, midnightStore } from '@/stores/midnightStore';
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

/** A 32-byte colour that is not native NIGHT (NIGHT is public; an all-zero colour is never private). */
const customColor = (value: string) => /^[0-9a-fA-F]{64}$/.test(value) && !/^0+$/.test(value);

/** The slice of the SDK's ShieldedWalletState this loop reads. */
interface SdkState {
  progress: { isStrictlyComplete(): boolean };
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
    this.timer = setInterval(() => { void this.cycle(); }, 30_000);
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

  private async openWallet(): Promise<void> {
    const [ledgerMod, shieldedMod, abstractionsMod, addressMod] = await Promise.all([
      import('@midnight-ntwrk/ledger-v8'),
      import('@midnightntwrk/wallet-sdk-shielded'),
      import('@midnightntwrk/wallet-sdk-abstractions'),
      import('@midnightntwrk/wallet-sdk-address-format'),
    ]);
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
      },
      txHistoryStorage,
    });
    midnightActions.setPrivateSyncStatus('syncing');
    const persisted = await loadWalletState(sdkNetworkId, 'shielded', this.seed);
    if (!this.isCurrent()) return;
    const wallet = await startShieldedWallet(
      builder as Parameters<typeof startShieldedWallet>[0], this.keys, persisted, sdkNetworkId, this.seed,
    ) as unknown as SdkWallet;
    this.wallet = wallet;
    this.subscription = wallet.state.pipe(sampleTime(1000)).subscribe({
      next: (state) => {
        if (!this.isCurrent() || this.wallet !== wallet) return;
        this.latest = state;
        if (!state.progress.isStrictlyComplete()) {
          // A lagging or reconnecting stream must not stay authoritative.
          if (midnightStore.privateSyncStatus !== 'syncing') midnightActions.setPrivateSyncStatus('syncing');
          return;
        }
        // Publish the first complete snapshot promptly; later ones ride the 30 s timer.
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
    debugLog('🌙 private sync (ledger 8): started', { network: sdkNetworkId, warm: !!persisted });
  }

  private async cycle(): Promise<void> {
    if (this.busy || !this.isCurrent()) return;
    this.busy = true;
    try {
      if (!this.wallet) {
        await this.openWallet();
        return;
      }
      const state = this.latest;
      if (!state?.progress.isStrictlyComplete() || !this.isCurrent()) return;
      const balances = Object.fromEntries(Object.entries(state.balances)
        .filter(([color, amount]) => customColor(color) && amount >= 0n)
        .map(([color, amount]) => [color.toLowerCase(), amount]));
      midnightActions.applyPrivateSnapshot(balances, []);
      this.hasPublished = true;
      await saveWalletState(this.args.endpoints.sdkNetworkId, 'shielded', this.seed, state.serialize());
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
