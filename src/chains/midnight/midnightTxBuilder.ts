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
    import('@midnight-ntwrk/wallet-sdk-unshielded-wallet'),
    import('@midnight-ntwrk/wallet-sdk-dust-wallet'),
    import('@midnight-ntwrk/ledger-v8'),
    import('@midnight-ntwrk/wallet-sdk-abstractions'),
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
      costParameters: { feeBlocksMargin: 1 },
    } as unknown as Parameters<typeof DustWallet>[0]);

    dustWallet = await dustBuilderStart(
      dustBuilder,
      dustSk,
      LedgerParameters.initialParameters().dust,
    );
    // shareReplay({refCount:true}) on `state` requires an active subscriber
    // to drive sync; without this `waitForSyncedState` can hang. We use the
    // subscriber for two things here: (a) keep-alive for the refCount, and
    // (b) progress logging — without observability the dust sync can sit at
    // "waiting" for minutes on cold sync with no visible signal of whether
    // the WS is delivering data or stalled. Logging is heuristic (the SDK
    // doesn't publish a stable progress schema across versions) — we probe
    // common shapes and fall through on misses.
    // BUILD-ID marker so we can confirm at runtime which version of this
    // module is loaded into the BG service worker. If the user reports
    // "still hangs" but doesn't see this exact line, the dev-server
    // background bundle didn't rebuild (Vite has separate watch configs
    // for the page bundle vs. background bundle — they don't always
    // hot-reload in sync).
    debugLog('🌙 dust sync: instrumentation BUILD=v2-heartbeat');

    let lastLoggedHeight = -1;
    let stateUpdateCount = 0;
    let totalStateUpdates = 0;
    let lastStateSnapshot: unknown = null;
    const syncStartMs = Date.now();
    dustSubscription = dustWallet.state.subscribe((state: unknown) => {
      stateUpdateCount += 1;
      totalStateUpdates += 1;
      lastStateSnapshot = state;
      // First update: dump the entire state shape so we can see what the
      // SDK is actually publishing. The probing in the heuristic block
      // below is only useful if we know the field names.
      if (totalStateUpdates === 1) {
        try {
          debugLog('🌙 dust sync: FIRST state update', {
            keys: state && typeof state === 'object' ? Object.keys(state) : [],
            stringified: JSON.stringify(
              state,
              (_k, v) => (typeof v === 'bigint' ? `bigint:${v.toString()}` : v),
            ).slice(0, 500),
          });
        } catch {
          debugLog('🌙 dust sync: FIRST state update (unserializable)', { type: typeof state });
        }
      }
      // Probe shapes we've seen on the dust/unshielded SDK state types.
      const s = state as Record<string, unknown> | undefined;
      const progress = (s?.['progress'] as Record<string, unknown> | undefined) ?? undefined;
      const synced = (progress?.['synced'] as Record<string, unknown> | undefined) ?? undefined;
      const height = typeof synced?.['height'] === 'number'
        ? (synced['height'] as number)
        : typeof (s?.['syncHeight'] as unknown) === 'number'
          ? (s['syncHeight'] as number)
          : null;
      if (typeof height === 'number' && height - lastLoggedHeight >= 100) {
        debugLog(`🌙 dust sync: progress height=${height} (Δ=${stateUpdateCount} updates, ${Date.now() - syncStartMs}ms)`);
        lastLoggedHeight = height;
        stateUpdateCount = 0;
      }
    });
    debugLog('🌙 dust sync: waiting');

    // 5s heartbeat so silent hangs are visible. Distinguishes three
    // failure modes that all currently look identical:
    //   - BG service worker still alive but SDK observable is silent
    //     (heartbeat fires, totalStateUpdates stays 0)
    //   - SDK observable emitting but our height extraction missed the
    //     shape (heartbeat fires AND totalStateUpdates>0 but no
    //     "progress height=" line)
    //   - BG SW killed mid-await by Chrome's idle timeout (heartbeat
    //     STOPS firing, send dialog hangs forever)
    const heartbeatHandle = setInterval(() => {
      const elapsed = Date.now() - syncStartMs;
      debugLog(`🌙 dust sync: heartbeat ${(elapsed / 1000).toFixed(1)}s, totalStateUpdates=${totalStateUpdates}, lastHeight=${lastLoggedHeight}`);
      // Dump state shape periodically too if we still have no progress.
      if (totalStateUpdates > 0 && lastLoggedHeight < 0) {
        try {
          debugLog('🌙 dust sync: NO HEIGHT in state', {
            keys: lastStateSnapshot && typeof lastStateSnapshot === 'object' ? Object.keys(lastStateSnapshot as object) : [],
          });
        } catch { /* ignore */ }
      }
    }, 5_000);
    // Bounded wait. Without this, a cold-sync that never converges (stuck
    // indexer subscription, unmet allowedGap default, partial network
    // drop) hangs the send dialog forever with no signal. 90s is a soft
    // cap for preview's typical first-sync; if we hit it we retry with
    // a generous allowedGap so the fee balance can still attempt.
    const SYNC_TIMEOUT_MS = 90_000;
    try {
      await Promise.race([
        dustWallet.waitForSyncedState(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`dust sync timed out after ${SYNC_TIMEOUT_MS / 1000}s`)), SYNC_TIMEOUT_MS),
        ),
      ]);
      debugLog(`🌙 dust sync: done (${Date.now() - syncStartMs}ms, totalStateUpdates=${totalStateUpdates})`);
    } catch (timeoutErr) {
      debugLog(`🌙 dust sync: TIMEOUT after ${Date.now() - syncStartMs}ms (totalStateUpdates=${totalStateUpdates}) — retrying with allowedGap=1000`, timeoutErr);
      // Second attempt with a non-zero allowedGap. Caps at a separate
      // 30s budget — if THIS times out, we let the original error bubble
      // so the UI can surface a useful failure instead of hanging.
      await Promise.race([
        dustWallet.waitForSyncedState(1000n),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('dust sync (gap=1000) timed out after 30s')), 30_000),
        ),
      ]);
      debugLog(`🌙 dust sync: done with gap (${Date.now() - syncStartMs}ms, totalStateUpdates=${totalStateUpdates})`);
    } finally {
      clearInterval(heartbeatHandle);
    }

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
  builder: ReturnType<typeof import('@midnight-ntwrk/wallet-sdk-unshielded-wallet').UnshieldedWallet>,
  publicKey: Parameters<typeof builder.startWithPublicKey>[0],
) {
  const w = builder.startWithPublicKey(publicKey);
  await w.start();
  return w;
}

async function dustBuilderStart(
  builder: ReturnType<typeof import('@midnight-ntwrk/wallet-sdk-dust-wallet').DustWallet>,
  sk: ledger.DustSecretKey,
  dustParams: ledger.DustParameters,
) {
  const w = builder.startWithSecretKey(sk, dustParams);
  await w.start(sk);
  return w;
}
