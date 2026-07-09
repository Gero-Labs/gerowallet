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
import { getNexusAccessToken, reauthenticateNexus } from '@/services/nexusDevice.service';

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
  /**
   * When the wallet registered for DUST generation (or the earliest bound
   * the caller can assert — wallet creation time works: a wallet can't have
   * registered before it existed). Drives the Nexus snapshot-bootstrap fast
   * path: on a local-checkpoint miss, the builder asks Nexus for a dust
   * state snapshot taken BEFORE this time and replays only the tail instead
   * of the full ledger. Omit to skip the fast path entirely.
   */
  readonly dustRegisteredAt?: Date;
  /**
   * Optional live-progress sink for the (long) DUST-ledger sync sub-step.
   * Called with a 0-100 percent (or -1 when the tip isn't known yet) so the
   * caller can drive a real progress bar. Best-effort and throttled by the
   * builder; a throwing callback must not break the send (caller wraps it).
   */
  readonly onDustSyncProgress?: (percent: number, detail: string) => void;
}

/**
 * Fetch a dust-ledger sync-bootstrap snapshot from Nexus: a serialized
 * dust-wallet SDK state captured by the sidecar's global dummy-key sync
 * BEFORE {@code registeredAt}. The state carries no key material — restore
 * happens locally and the wallet's own secret key drives own-UTxO detection
 * over the tail replay (cross-key restore verified against the SDK).
 *
 * Best-effort by design: any failure (404 while the server ring is warming,
 * auth trouble, timeout) returns null and the caller falls back to the
 * cold-replay path — this is an accelerator, never load-bearing.
 */
async function fetchDustBootstrapSnapshot(
  endpoints: MidnightNetworkEndpoints,
  sdkNetworkId: string,
  registeredAt: Date,
): Promise<string | null> {
  const url = `${endpoints.nexusBaseUrl}/api/midnight/midnight-${sdkNetworkId}`
    + `/dust/state-snapshot?registeredAt=${encodeURIComponent(registeredAt.toISOString())}`;
  const attempt = async (token: string): Promise<Response> => fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  try {
    let res = await attempt(await getNexusAccessToken());
    if (res.status === 401 || res.status === 403) {
      // Stale/under-scoped token — one reauth + retry, mirroring midnight-api.
      res = await attempt(await reauthenticateNexus());
    }
    if (!res.ok) {
      debugLog(`🌙 dust bootstrap: no snapshot (HTTP ${res.status}) — cold path`);
      return null;
    }
    const body = await res.json() as {
      serialized_state?: string;
      applied_index?: string;
      chain_time_ms?: number | null;
    };
    if (typeof body.serialized_state !== 'string' || body.serialized_state.length === 0) {
      return null;
    }
    debugLog(`🌙 dust bootstrap: snapshot received (appliedIndex=${body.applied_index ?? '?'}, `
      + `chainTime=${body.chain_time_ms ? new Date(body.chain_time_ms).toISOString() : 'unknown'}, `
      + `${body.serialized_state.length} chars)`);
    return body.serialized_state;
  } catch (e) {
    debugLog('🌙 dust bootstrap: fetch failed (non-fatal) — cold path', e);
    return null;
  }
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
    debugLog('🌙 dust sync: instrumentation BUILD=v6-stall-restart');

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

    // Numeric 0-100 percent (or -1 when the tip isn't known yet) for the UI
    // progress bar, plus a compact "applied / highest events" detail line.
    const emitProgress = (): void => {
      if (!args.onDustSyncProgress) return;
      const { applied, highest } = lastProgress;
      const percent = applied != null && highest != null && highest > 0n
        ? Number((applied * 10000n) / highest) / 100
        : -1;
      const detail = applied != null && highest != null && highest > 0n
        ? `${applied.toLocaleString('en-US')} / ${highest.toLocaleString('en-US')} events`
        : `${applied?.toLocaleString('en-US') ?? '0'} events`;
      try { args.onDustSyncProgress(percent, detail); } catch { /* UI sink must never break the send */ }
    };

    // ── Sync with stall-restart ───────────────────────────────────
    // Two SDK realities shape this loop (indexer-client 1.2.3 / dust-wallet
    // 4.2.0; no fixed stable release exists yet — only 5.0.0 canaries):
    //
    //  1. The indexer's dustLedgerEvents subscription has no address filter
    //     and no snapshot query (schema takes only a cursor `id`), so a cold
    //     wallet replays the ENTIRE global dust ledger — ~1.26M events on
    //     preprod. WASM apply throughput caps this at hundreds of events/s
    //     in the MV3 service worker, i.e. tens of minutes cold.
    //
    //  2. The SDK's backpressure wrapper (indexer-client effect/Backpressure)
    //     pauses by DISPOSING the graphql-ws subscription once `bufferSize`
    //     events are in flight, and is supposed to re-open it from the
    //     cursor after the consumer drains to `resumeThreshold` — but the
    //     re-open dies silently (the SDK swallows WS failures), so a cold
    //     sync reliably FREEZES after ~bufferSize + pre-pause events.
    //     Observed: stall at exactly 12,910 applied with the default 10k
    //     buffer (2,910 applied before pause + 10,000 drained from buffer).
    //
    // Workaround for (2): treat a stall as "subscription dead, state fine" —
    // checkpoint, tear the wallet down, rebuild from the checkpoint (which
    // opens a FRESH subscription at the cursor), continue. Each cycle nets
    // ~bufferSize events, so the buffer is raised to 100k to cut the cycle
    // count (peak memory ≈ bufferSize × event size, ~50MB transient worst
    // case). For (1), checkpoints every 30s + on failure make progress
    // durable across sends, so even a capped/failed attempt is never wasted.
    const STALL_MS = 45_000;
    // Absolute cap. Live-measured cold-sync rate is ~490 events/s (2ms/event
    // WASM apply), so preprod's full ~1.26M-event replay needs ~43 min — the
    // cap must clear that or a fresh wallet can never finish in one attempt.
    // Stall/barren guards (not this cap) are what catch dead syncs early.
    const MAX_SYNC_MS = 45 * 60_000;
    const MAX_RESTARTS = 100;
    const MAX_BARREN_ATTEMPTS = 3;
    const DUST_INDEXER_BUFFER = 100_000;

    let restarts = 0;
    let barrenAttempts = 0;
    let bootstrapTried = false;

    try {
      for (;;) {
        // (Re)build the wallet from the latest checkpoint — a fresh builder
        // is required per attempt because a stopped wallet can't restart.
        // On a checkpoint hit the wallet resumes from its saved appliedIndex
        // cursor; on a miss/corrupt blob dustBuilderStart cold-inits.
        let persistedDustState = await loadWalletState(
          args.sdkNetworkId, 'dust', args.dustSecretSeed,
        );
        // Local miss → snapshot bootstrap: ask Nexus for a global dust state
        // captured before this wallet's registration and start the tail
        // replay from there instead of genesis. Once the tail syncs, the
        // regular checkpointing below persists LOCAL state, so this fetch
        // happens at most once per wallet+device lifetime.
        if (!persistedDustState && !bootstrapTried && args.dustRegisteredAt) {
          bootstrapTried = true;
          persistedDustState = await fetchDustBootstrapSnapshot(
            args.endpoints, args.sdkNetworkId, args.dustRegisteredAt,
          );
        }
        const dustBuilder = DustWallet({
          networkId: args.sdkNetworkId as Parameters<typeof DustWallet>[0]['networkId'],
          indexerClientConnection: {
            indexerHttpUrl: args.endpoints.publicIndexerUrl,
            indexerWsUrl: args.endpoints.publicIndexerWsUrl,
            bufferSize: DUST_INDEXER_BUFFER,
          },
          // WASM apply batching. SDK defaults ({size: 10, timeout: 1,
          // spacing: 4}) force a 4ms idle gap between 10-event batches —
          // ~250 events/s. Bigger batches amortize the per-batch JS↔WASM
          // crossing; spacing 0 removes the gap. Per-event decode+apply
          // cost is the remaining wall (~2ms/event).
          batchUpdates: { size: 1000, timeout: 25, spacing: 0 },
          costParameters: { feeBlocksMargin: 1 },
        } as unknown as Parameters<typeof DustWallet>[0]);
        dustWallet = await dustBuilderStart(
          dustBuilder,
          dustSk,
          LedgerParameters.initialParameters().dust,
          persistedDustState,
          args.sdkNetworkId,
          args.dustSecretSeed,
        );

        // shareReplay({refCount:true}) on `state` requires an active
        // subscriber to drive sync; without one `waitForSyncedState` hangs.
        // The subscriber doubles as progress bookkeeping for the watchdog.
        const appliedAtAttemptStart = lastPersistedApplied;
        lastAdvanceMs = Date.now();
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
          // Log + surface progress every time appliedIndex advances by 100+.
          if (p.applied != null && (lastLoggedApplied < 0n || p.applied - lastLoggedApplied >= 100n)) {
            debugLog(`🌙 dust sync: progress applied=${p.applied} highest=${p.highest ?? '?'} connected=${p.isConnected ?? '?'} (Δ=${stateUpdateCount} updates, ${Date.now() - syncStartMs}ms)`);
            lastLoggedApplied = p.applied;
            stateUpdateCount = 0;
            emitProgress();
          }
        });
        if (restarts === 0) debugLog('🌙 dust sync: waiting');

        let watchdogHandle: ReturnType<typeof setInterval> | undefined;
        const watchdog = new Promise<'stalled'>((resolve, reject) => {
          watchdogHandle = setInterval(() => {
            const now = Date.now();
            const elapsed = now - syncStartMs;
            debugLog(`🌙 dust sync: heartbeat ${(elapsed / 1000).toFixed(1)}s totalUpdates=${totalStateUpdates} ${percentLabel()} connected=${lastProgress.isConnected ?? 'null'} restarts=${restarts}`);
            if (now - lastPersistMs >= PERSIST_INTERVAL_MS) void persistCheckpoint('interval');
            if (elapsed > MAX_SYNC_MS) {
              reject(new Error(
                `DUST ledger sync still incomplete after ${Math.round(elapsed / 60_000)} minutes (${percentLabel()}). `
                + 'Progress was saved — sending again resumes where this left off.',
              ));
            } else if (now - lastAdvanceMs > STALL_MS) {
              resolve('stalled');
            }
          }, 5_000);
        });

        let outcome: 'synced' | 'stalled';
        try {
          outcome = await Promise.race([
            dustWallet.waitForSyncedState().then(() => 'synced' as const),
            watchdog,
          ]);
        } finally {
          if (watchdogHandle) clearInterval(watchdogHandle);
        }

        if (outcome === 'synced') {
          debugLog(`🌙 dust sync: done (${Date.now() - syncStartMs}ms, totalStateUpdates=${totalStateUpdates}, restarts=${restarts}, ${percentLabel()})`);
          emitProgress();
          break;
        }

        // Stalled: bank progress, tear down, rebuild from the checkpoint.
        await persistCheckpoint('stall-restart');
        const advanced = lastPersistedApplied > appliedAtAttemptStart;
        barrenAttempts = advanced ? 0 : barrenAttempts + 1;
        restarts += 1;
        try { dustSubscription?.unsubscribe(); } catch { /* already torn down */ }
        dustSubscription = undefined;
        try { await dustWallet.stop(); } catch { /* already torn down */ }
        dustWallet = undefined;
        if (barrenAttempts >= MAX_BARREN_ATTEMPTS) {
          throw new Error(
            `DUST ledger sync is not receiving events (${barrenAttempts} attempts with zero progress) at ${percentLabel()}. `
            + 'Check the indexer connection and try again — saved progress is kept.',
          );
        }
        if (restarts >= MAX_RESTARTS) {
          throw new Error(
            `DUST ledger sync gave up after ${MAX_RESTARTS} subscription restarts at ${percentLabel()}. `
            + 'Progress was saved — sending again resumes where this left off.',
          );
        }
        debugLog(`🌙 dust sync: stalled at ${percentLabel()} — restarting subscription from checkpoint (restart #${restarts})`);
      }
    } catch (syncErr) {
      // Bank whatever progress this attempt made before failing the send.
      await persistCheckpoint('failure');
      throw syncErr;
    }

    if (!dustWallet) {
      // Unreachable: the loop only breaks with a live synced wallet.
      throw new Error('DUST wallet unavailable after sync');
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
