// BG-side DUST-balance + sign for unshielded NIGHT transfers.
//
// The unproven NIGHT-transfer tx (inputs + outputs + change) is built by
// Nexus's `/tx/build-unshielded` because NIGHT UTxOs are public — the
// indexer-backed view there is canonical. The wallet's only required
// pre-prove work is the steps that need the user's secrets:
//
//   1. DUST fee balance — needs the user's dust secret to derive spend
//      nullifiers (`balanceTransactions(dustSk, …)` → `localState.spend(sk, …)`).
//   2. Sign each unshielded input — needs the NightExternal key.
//
// Sidecar (`/tx/finalize`) then does ZK proof + bind + submit.
//
// Note on UnshieldedWallet usage: `signUnprovenTransaction` walks the tx's
// segments directly (no UTxO state read). So we don't `waitForSyncedState`
// here — only `start()` is required to make the SDK's signing capability
// available. Saves the 5-30s UnshieldedWallet cold sync per send.
//
// Shielded txs cannot be split this way (notes are encrypted to the user's
// Zswap key — only the wallet can see them). When shielded ships, the wallet
// will own the entire pre-prove pipeline including the build step.

import type * as ledger from '@midnight-ntwrk/ledger-v8';
import type { MidnightNetworkEndpoints } from '@/chains/midnight/midnightConfig';
import { debugLog } from '@/utils/debug';
import {
  loadWalletState,
  saveWalletState,
  clearWalletState,
} from '@/chains/midnight/midnightWalletStatePersistence';

export interface BalanceAndSignUnshieldedTransferArgs {
  /** SDK network ID — 'mainnet' / 'preview' / 'preprod' / 'testnet'. */
  readonly sdkNetworkId: string;
  /** Indexer URLs (the BG knows these via midnightConfig). */
  readonly endpoints: MidnightNetworkEndpoints;
  /** Sender's NightExternal secret key (Uint8Array). Caller wipes after. */
  readonly unshieldedSecretKey: Uint8Array;
  /** Sender's DUST secret seed (Uint8Array). Caller wipes after. */
  readonly dustSecretSeed: Uint8Array;
  /** Hex of the unproven tx Nexus built. Markers: no-signature/pre-proof/pre-binding. */
  readonly unprovenTxHex: string;
  readonly ttl: Date;
}

/**
 * DUST-balance + sign the unproven unshielded-NIGHT tx that Nexus built.
 * Returns the SIGNED-but-UNPROVEN tx as a hex string ready for the sidecar's
 * prove+submit step.
 */
export async function balanceAndSignUnshieldedTransfer(
  args: BalanceAndSignUnshieldedTransferArgs,
): Promise<string> {
  debugLog('🌙 midnight tx-builder: starting', {
    network: args.sdkNetworkId,
    unprovenBytes: args.unprovenTxHex.length / 2,
  });

  // Dynamic imports keep cold-start cheap if no one's sending NIGHT yet.
  const [
    { UnshieldedWallet, createKeystore },
    { DustWallet },
    ledgerMod,
    abstractionsMod,
  ] = await Promise.all([
    import('@midnightntwrk/wallet-sdk-unshielded-wallet'),
    import('@midnightntwrk/wallet-sdk-dust-wallet'),
    import('@midnight-ntwrk/ledger-v8'),
    import('@midnightntwrk/wallet-sdk-abstractions'),
  ]);
  const { LedgerParameters, DustSecretKey, Transaction } = ledgerMod;
  const { InMemoryTransactionHistoryStorage } = abstractionsMod;

  // Tx history schema namespace is re-exported from abstractions as
  // `export * as TransactionHistoryStorage`. The schema we need is
  // `TransactionHistoryCommonSchema` on that namespace.
  const txHistoryNs = (abstractionsMod as unknown as {
    TransactionHistoryStorage: { TransactionHistoryCommonSchema: unknown };
  }).TransactionHistoryStorage;

  let unshieldedWallet: Awaited<ReturnType<typeof unshieldedBuilderStart>> | undefined;
  let dustWallet: Awaited<ReturnType<typeof dustBuilderStart>> | undefined;
  let dustSk: ledger.DustSecretKey | undefined;
  let dustSubscription: { unsubscribe: () => void } | undefined;

  try {
    // ── Deserialize Nexus's unproven tx ───────────────────────────
    // Marker triple is `signature / pre-proof / pre-binding`, NOT
    // `no-signature/...`. `UnshieldedOffer.new(inputs, outputs, sigs)` always
    // returns `UnshieldedOffer<SignatureEnabled>` per the SDK type signature
    // (ledger-v8.d.ts:1970) — the empty `[]` signatures argument doesn't
    // demote the marker. A `'no-signature'` deserialization here would
    // misinterpret the bytes and the SDK then rejects on addSignature with
    // the cryptic "Invalid signature value" string out of the ledger WASM.
    const TxAny = Transaction as unknown as {
      deserialize: (s: string, p: string, b: string, raw: Uint8Array) => ledger.UnprovenTransaction;
    };
    const unprovenBytes = hexToBytes(args.unprovenTxHex);
    const unprovenTransfer = TxAny.deserialize(
      'signature', 'pre-proof', 'pre-binding', unprovenBytes,
    );
    debugLog('🌙 unproven tx deserialized', { bytes: unprovenBytes.length });

    // ── UnshieldedWallet — signing only, no sync ──────────────────
    // signUnprovenTransaction walks the tx's segments directly; it doesn't
    // read UTxO state. start() is enough; we skip waitForSyncedState.
    const keystore = createKeystore(args.unshieldedSecretKey, args.sdkNetworkId);
    const publicKey = {
      publicKey: keystore.getPublicKey(),
      addressHex: keystore.getAddress(),
      address: keystore.getBech32Address().toString(),
    };
    const txHistoryStorage = new InMemoryTransactionHistoryStorage(
      txHistoryNs.TransactionHistoryCommonSchema as ConstructorParameters<
        typeof InMemoryTransactionHistoryStorage
      >[0],
    );
    const unshieldedBuilder = UnshieldedWallet({
      networkId: args.sdkNetworkId as Parameters<typeof UnshieldedWallet>[0]['networkId'],
      indexerClientConnection: {
        indexerHttpUrl: args.endpoints.publicIndexerUrl,
        indexerWsUrl: args.endpoints.publicIndexerWsUrl,
      },
      txHistoryStorage: txHistoryStorage as unknown as Parameters<
        typeof UnshieldedWallet
      >[0]['txHistoryStorage'],
    });
    unshieldedWallet = await unshieldedBuilderStart(unshieldedBuilder, publicKey);

    // ── DustWallet — must sync; balanceTransactions reads UTxO state ──
    dustSk = DustSecretKey.fromSeed(args.dustSecretSeed);
    const dustBuilder = DustWallet({
      networkId: args.sdkNetworkId as Parameters<typeof DustWallet>[0]['networkId'],
      indexerClientConnection: {
        indexerHttpUrl: args.endpoints.publicIndexerUrl,
        indexerWsUrl: args.endpoints.publicIndexerWsUrl,
      },
      // Cold-sync throughput. The SDK defaults ({size: 10, timeout: 1,
      // spacing: 4} in dust-wallet/dist/v1/Sync.js) apply 10 events per WASM
      // batch with a forced 4ms idle gap between batches — measured at
      // ~250 events/s in the MV3 service worker, i.e. 80+ minutes to replay
      // preprod's ~1.26M-event global dust ledger (the stream has no address
      // filter; every wallet replays everything — indexer v4 schema only
      // takes a cursor `id`). Large batches amortize the per-batch JS↔WASM
      // crossing; spacing 0 removes the idle gap. The indexer easily
      // outpaces this (measured ~15k events/s raw), so apply is the wall.
      batchUpdates: { size: 1000, timeout: 25, spacing: 0 },
      costParameters: { feeBlocksMargin: 1 },
    } as unknown as Parameters<typeof DustWallet>[0]);

    // Warm-restart: load this dust wallet's persisted SDK state (keyed by
    // network + dust seed hash). On a hit, the wallet resumes from its saved
    // appliedIndex cursor instead of cold-syncing the indexer from genesis —
    // turning a 30s-to-minutes wait into a short catch-up. On a miss / stale /
    // corrupt blob, dustBuilderStart falls back to a cold startWithSecretKey.
    const persistedDustState = await loadWalletState(
      args.sdkNetworkId, 'dust', args.dustSecretSeed,
    );
    dustWallet = await dustBuilderStart(
      dustBuilder,
      dustSk,
      LedgerParameters.initialParameters().dust,
      persistedDustState,
      args.sdkNetworkId,
      args.dustSecretSeed,
    );
    // shareReplay({refCount:true}) on `state` requires an active subscriber
    // to drive sync; without this `waitForSyncedState` can hang. We use the
    // subscriber for two things here: (a) keep-alive for the refCount, and
    // (b) progress logging — without observability the dust sync can sit at
    // "waiting" for minutes on cold sync with no visible signal of whether
    // the WS is delivering data or stalled. Logging is heuristic (the SDK
    // doesn't publish a stable progress schema across versions) — we probe
    // common shapes and fall through on misses.
    // BUILD-ID marker — v3 reads the SDK's actual SyncProgress getter
    // (appliedIndex / highestIndex / isConnected per the
    // wallet-sdk-abstractions SyncProgress.d.ts), not the made-up
    // `progress.synced.height` shape v2 was probing.
    debugLog('🌙 dust sync: instrumentation BUILD=v5-batched-checkpoint');

    type SyncProgressLike = {
      appliedIndex?: unknown;
      highestRelevantWalletIndex?: unknown;
      highestIndex?: unknown;
      highestRelevantIndex?: unknown;
      isConnected?: unknown;
    };

    function readProgress(state: unknown): {
      applied: bigint | null;
      highest: bigint | null;
      isConnected: boolean | null;
    } {
      // The state is a DustWalletState class instance; `progress` is a
      // getter (not an own property), so we access via dot notation
      // which triggers the getter on the class prototype. Wrapped in
      // try/catch because the getter throws before sync starts in some
      // SDK paths.
      let progress: SyncProgressLike | null = null;
      try {
        progress = (state as { progress?: SyncProgressLike } | null)?.progress ?? null;
      } catch { /* getter threw — pre-sync state */ }
      if (!progress) return { applied: null, highest: null, isConnected: null };
      const applied = typeof progress.appliedIndex === 'bigint'
        ? (progress.appliedIndex as bigint)
        : null;
      // The dust sync capability tracks the tip as highestRelevantWalletIndex
      // (set to the batch's maxId in applyUpdate); highestIndex stays 0 for
      // dust wallets. Prefer the populated field so percent math works.
      const rawHighest = typeof progress.highestRelevantWalletIndex === 'bigint'
          && (progress.highestRelevantWalletIndex as bigint) > 0n
        ? (progress.highestRelevantWalletIndex as bigint)
        : (typeof progress.highestIndex === 'bigint' ? (progress.highestIndex as bigint) : null);
      const highest = rawHighest;
      const isConnected = typeof progress.isConnected === 'boolean'
        ? (progress.isConnected as boolean)
        : null;
      return { applied, highest, isConnected };
    }

    let lastLoggedApplied: bigint = -1n;
    let stateUpdateCount = 0;
    let totalStateUpdates = 0;
    let lastProgress: { applied: bigint | null; highest: bigint | null; isConnected: boolean | null } = {
      applied: null,
      highest: null,
      isConnected: null,
    };
    const syncStartMs = Date.now();
    let lastAdvanceMs = Date.now();
    dustSubscription = dustWallet.state.subscribe((state: unknown) => {
      stateUpdateCount += 1;
      totalStateUpdates += 1;
      const p = readProgress(state);
      if (p.applied != null && (lastProgress.applied == null || p.applied > lastProgress.applied)) {
        lastAdvanceMs = Date.now();
      }
      lastProgress = p;
      if (totalStateUpdates === 1) {
        debugLog('🌙 dust sync: FIRST state update', {
          applied: p.applied?.toString() ?? null,
          highest: p.highest?.toString() ?? null,
          isConnected: p.isConnected,
        });
      }
      // Log every time appliedIndex advances by 100+ blocks.
      if (p.applied != null && (lastLoggedApplied < 0n || p.applied - lastLoggedApplied >= 100n)) {
        debugLog(`🌙 dust sync: progress applied=${p.applied} highest=${p.highest ?? '?'} connected=${p.isConnected ?? '?'} (Δ=${stateUpdateCount} updates, ${Date.now() - syncStartMs}ms)`);
        lastLoggedApplied = p.applied;
        stateUpdateCount = 0;
      }
    });
    debugLog('🌙 dust sync: waiting');

    // ── Watchdog + checkpointing ──────────────────────────────────
    // A cold sync replays the entire global dust ledger (no address filter
    // in the indexer schema), which is minutes even with tuned batching. A
    // blind fixed timeout was the old failure mode: it always fired first
    // AND the state was only persisted on success, so every attempt
    // restarted from genesis. Instead:
    //   - checkpoint the wallet state every PERSIST_INTERVAL_MS and on
    //     failure, so progress always survives and the next attempt resumes
    //     from the saved cursor;
    //   - fail only on a genuine STALL (applied index hasn't advanced for
    //     STALL_TIMEOUT_MS) or on the absolute cap MAX_SYNC_MS;
    //   - carry sync percent in the error message so the dialog shows how
    //     far it got instead of a bare "timed out".
    const STALL_TIMEOUT_MS = 60_000;
    const MAX_SYNC_MS = 20 * 60_000;
    const PERSIST_INTERVAL_MS = 30_000;
    let lastPersistMs = Date.now();
    let lastPersistedApplied = -1n;
    let persistInFlight = false;

    const persistCheckpoint = async (reason: string): Promise<void> => {
      const wallet = dustWallet;
      const applied = lastProgress.applied;
      if (!wallet || persistInFlight || applied == null || applied <= lastPersistedApplied) return;
      persistInFlight = true;
      try {
        const serialized = await wallet.serializeState();
        await saveWalletState(args.sdkNetworkId, 'dust', args.dustSecretSeed, serialized);
        lastPersistedApplied = applied;
        lastPersistMs = Date.now();
        debugLog(`🌙 dust sync: checkpoint saved (${reason}) applied=${applied}`);
      } catch (e) {
        debugLog(`🌙 dust sync: checkpoint save failed (${reason}, non-fatal)`, e);
      } finally {
        persistInFlight = false;
      }
    };

    const percentLabel = (): string => {
      const { applied, highest } = lastProgress;
      if (applied == null || highest == null || highest <= 0n) {
        return `${applied?.toString() ?? '?'} events applied`;
      }
      const pct = Number((applied * 1000n) / highest) / 10;
      return `${pct.toFixed(1)}% (${applied}/${highest} dust ledger events)`;
    };

    let watchdogHandle: ReturnType<typeof setInterval> | undefined;
    const watchdog = new Promise<never>((_, reject) => {
      watchdogHandle = setInterval(() => {
        const now = Date.now();
        const elapsed = now - syncStartMs;
        debugLog(`🌙 dust sync: heartbeat ${(elapsed / 1000).toFixed(1)}s totalUpdates=${totalStateUpdates} ${percentLabel()} connected=${lastProgress.isConnected ?? 'null'}`);
        if (now - lastPersistMs >= PERSIST_INTERVAL_MS) void persistCheckpoint('interval');
        if (now - lastAdvanceMs > STALL_TIMEOUT_MS) {
          reject(new Error(
            `DUST ledger sync stalled (no progress for ${STALL_TIMEOUT_MS / 1000}s) at ${percentLabel()}. `
            + 'Progress was saved — sending again resumes where this left off.',
          ));
        } else if (elapsed > MAX_SYNC_MS) {
          reject(new Error(
            `DUST ledger sync still incomplete after ${Math.round(elapsed / 60_000)} minutes (${percentLabel()}). `
            + 'Progress was saved — sending again resumes where this left off.',
          ));
        }
      }, 5_000);
    });

    try {
      await Promise.race([dustWallet.waitForSyncedState(), watchdog]);
      debugLog(`🌙 dust sync: done (${Date.now() - syncStartMs}ms, totalStateUpdates=${totalStateUpdates}, ${percentLabel()})`);
    } catch (syncErr) {
      // Bank whatever progress this attempt made before failing the send.
      await persistCheckpoint('failure');
      throw syncErr;
    } finally {
      if (watchdogHandle) clearInterval(watchdogHandle);
    }

    // Persist the now-synced dust state so the NEXT send restores warm
    // instead of cold-syncing again. Best-effort: a save failure only costs
    // a cold sync next time. Done before the fee-balance step so even if
    // balancing throws we keep the sync progress we paid for.
    await persistCheckpoint('synced');

    // ── Add DUST fee inputs (the step that needs the dust secret) ─
    // `dust.balanceTransactions` does NOT mutate or wrap the input tx — it
    // returns a SEPARATE dust-only fee tx with its own intent containing the
    // DustActions. The caller is responsible for merging that fee tx into the
    // unshielded transfer; see wallet-sdk-facade/dist/index.js:280-283 for
    // the canonical pattern:
    //   feeBalancingTx = dust.balanceTransactions(dustSk, [transferTx], ttl)
    //   balancedTx     = transferTx.merge(feeBalancingTx)
    // Without the merge, signUnprovenTransaction signs the fee-only tx (no
    // unshielded inputs in scope), the chain receives an unbalanced tx and
    // rejects with "Invalid signature value" inside the ledger WASM.
    const feeBalancingTx = await dustWallet.balanceTransactions(
      dustSk,
      [unprovenTransfer],
      args.ttl,
    );
    debugLog('🌙 dust fee tx built');
    const mergedTx = (unprovenTransfer as unknown as {
      merge: (other: ledger.UnprovenTransaction) => ledger.UnprovenTransaction;
    }).merge(feeBalancingTx as ledger.UnprovenTransaction);
    debugLog('🌙 transfer + dust fee merged');

    // ── Sign each unshielded input with the NightExternal key ─────
    const signSegment = (data: Uint8Array): ledger.Signature =>
      keystore.signData(data);
    const signedTx = await unshieldedWallet.signUnprovenTransaction(
      mergedTx,
      signSegment,
    );
    debugLog('🌙 transfer signed');

    const signedBytes = (signedTx as unknown as { serialize: () => Uint8Array }).serialize();
    const signedTxHex = Buffer.from(signedBytes).toString('hex');
    debugLog('🌙 transfer serialized', { bytes: signedBytes.length });
    return signedTxHex;
  } finally {
    try { dustSubscription?.unsubscribe(); } catch { /* swallow */ }
    try { await unshieldedWallet?.stop(); } catch { /* swallow */ }
    try { await dustWallet?.stop(); } catch { /* swallow */ }
    try { (dustSk as unknown as { clear?: () => void } | undefined)?.clear?.(); } catch { /* swallow */ }
  }
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length === 0 || clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) {
    throw new Error('unprovenTxHex is not valid hex');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// Small thunks so the awaited type is inferred for the let-bindings above.
async function unshieldedBuilderStart(
  builder: ReturnType<typeof import('@midnightntwrk/wallet-sdk-unshielded-wallet').UnshieldedWallet>,
  publicKey: Parameters<typeof builder.startWithPublicKey>[0],
) {
  const w = builder.startWithPublicKey(publicKey);
  await w.start();
  return w;
}

async function dustBuilderStart(
  builder: ReturnType<typeof import('@midnightntwrk/wallet-sdk-dust-wallet').DustWallet>,
  sk: ledger.DustSecretKey,
  dustParams: ledger.DustParameters,
  persistedState?: string | null,
  network?: string,
  identitySeed?: Uint8Array,
) {
  // Warm restore when we have persisted state; otherwise cold init. Both
  // paths return the wallet instance and then need start(sk) to open the WS
  // subscription — restore resumes from the saved appliedIndex cursor, cold
  // init starts from genesis. If restore throws (corrupt / incompatible blob
  // across an SDK upgrade), drop the bad state and cold-init this run so we
  // self-heal instead of failing every send.
  let w: ReturnType<typeof builder.startWithSecretKey>;
  if (persistedState) {
    try {
      w = builder.restore(persistedState);
      debugLog('🌙 dust wallet: restored from persisted state (warm)');
    } catch (e) {
      debugLog('🌙 dust wallet: restore failed — clearing bad state, cold init', e);
      if (network && identitySeed) {
        try { await clearWalletState(network, 'dust', identitySeed); } catch { /* swallow */ }
      }
      w = builder.startWithSecretKey(sk, dustParams);
    }
  } else {
    w = builder.startWithSecretKey(sk, dustParams);
  }
  await w.start(sk);
  return w;
}
