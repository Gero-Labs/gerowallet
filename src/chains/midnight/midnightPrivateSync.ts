import * as ledger from '@midnightntwrk/ledger-v9';
import { ShieldedWallet, type ShieldedWalletState, type ShieldedTransactionHistoryEntry } from 'midnight-v9-shielded';
import { TransactionHistory } from 'midnight-v9-shielded/v1';
import { InMemoryTransactionHistoryStorage } from 'midnight-v9-abstractions';
import { sampleTime } from 'rxjs';
import { walletStore } from '@/stores/walletStore';
import { decodeShieldedAddress9 } from './midnightAddress9';
import { midnightActions, midnightStore } from '@/stores/midnightStore';
import type { MidnightNetworkEndpoints } from './midnightConfig';
import type { MidnightTransaction } from './midnightTypes';
import { readVerifiedMidnightChainIdentity, midnightCheckpointNamespace, type MidnightChainIdentity } from './midnightChainIdentity';
import { saveWalletState } from './midnightWalletStatePersistence';

export interface MidnightPrivateSyncArgs {
  walletId: string;
  network: string;
  endpoints: MidnightNetworkEndpoints;
  seed: Uint8Array;
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

async function bounded<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Private wallet operation timed out')), 30_000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

type Wallet = ReturnType<ReturnType<typeof ShieldedWallet>['startWithSecretKeys']>;
let current: PrivateSync | undefined;

class PrivateSync {
  readonly seed: Uint8Array;
  private readonly owner: string | null;
  private active = true;
  private busy = false;
  private hasPublished = false;
  private pendingImmediatePublication = false;
  private timer?: ReturnType<typeof setInterval>;
  private wallet?: Wallet;
  private keys?: ledger.ZswapSecretKeys;
  private subscription?: { unsubscribe(): void };
  private identity?: MidnightChainIdentity;
  private latest?: ShieldedWalletState;
  private history?: InMemoryTransactionHistoryStorage<ShieldedTransactionHistoryEntry, unknown>;

  constructor(readonly args: MidnightPrivateSyncArgs) {
    this.seed = args.seed.slice();
    this.owner = midnightStore.activeWalletKey;
  }

  private isCurrent() {
    const logged = walletStore.loggedWallet;
    return this.active && current === this && !!this.owner && this.owner.startsWith('mn_addr_stagenet1')
      && midnightStore.activeWalletKey === this.owner && !walletStore.isLocked
      && String(logged?.id) === this.args.walletId && logged?.chain === 'Midnight'
      && String(logged?.network).toLowerCase() === 'stagenet';
  }

  async start() {
    this.timer = setInterval(() => { void this.cycle(); }, 30_000);
    await this.cycle();
  }

  private async releaseWallet() {
    this.subscription?.unsubscribe(); this.subscription = undefined;
    const wallet = this.wallet; const keys = this.keys;
    this.wallet = undefined; this.keys = undefined; this.latest = undefined;
    this.hasPublished = false; this.pendingImmediatePublication = false;
    try { if (wallet) await bounded(wallet.stop()); }
    finally { keys?.clear(); }
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
        this.keys = ledger.ZswapSecretKeys.fromSeed(this.seed);
        const expected = decodeShieldedAddress9('stagenet', midnightStore.addresses.shielded);
        if (expected.coinPublicKey.toHexString() !== this.keys.coinPublicKey
          || expected.encryptionPublicKey.toHexString() !== this.keys.encryptionPublicKey)
          throw new Error('Private key does not belong to the active wallet');
        this.history = new InMemoryTransactionHistoryStorage(TransactionHistory.ShieldedTransactionHistoryEntrySchema);
        this.wallet = ShieldedWallet({
          networkId: 'stagenet',
          indexerClientConnection: {
            indexerHttpUrl: this.args.endpoints.publicIndexerUrl,
            indexerWsUrl: this.args.endpoints.publicIndexerWsUrl,
          },
          txHistoryStorage: this.history,
        }).startWithSecretKeys(this.keys);
        // Cold replay reconstructs private history too. A state-only checkpoint
        // cannot recover historical spends for a newly restored wallet.
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
        await bounded(wallet.start(this.keys));
        // A complete event can arrive while start() is pending. The finally
        // below queues a fresh verified cycle without losing that first event.
        return;
      }
      const state = this.latest;
      if (!state?.progress.isStrictlyComplete() || !this.isCurrent() || !this.keys) return;
      if (state.coinPublicKey.toHexString() !== this.keys.coinPublicKey
        || state.encryptionPublicKey.toHexString() !== this.keys.encryptionPublicKey)
        throw new Error('Private wallet identity mismatch');
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
      this.hasPublished = true;
      // Secret seed is used only to derive the opaque cache key, never stored.
      await saveWalletState(midnightCheckpointNamespace(identity), 'shielded', this.seed, state.serialize());
    } catch {
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

/** Copies the ephemeral seed immediately; callers retain ownership of their input. */
export async function startMidnightPrivateSync(args: MidnightPrivateSyncArgs): Promise<void> {
  if (args.seed.length !== 32) throw new Error('Invalid private wallet seed');
  if (args.endpoints.sdkNetworkId !== 'stagenet'
    || !['stagenet', 'Stagenet', 'midnight-stagenet'].includes(args.network)) return;
  const next = new PrivateSync(args);
  const previous = current;
  current = next;
  // stop() invalidates the old owner before waiting and clears its keys in
  // finally. An SDK shutdown failure must not strand the replacement session.
  if (previous) await previous.stop().catch(() => {});
  if (current === next) await next.start();
}

export async function stopMidnightPrivateSync(): Promise<void> {
  const previous = current;
  current = undefined;
  await previous?.stop();
  if (!current) midnightActions.setPrivateSyncStatus('idle');
}
