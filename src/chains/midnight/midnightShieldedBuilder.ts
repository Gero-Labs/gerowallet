// BG-side build + sign for shielded NIGHT transfers.
//
// Why this can't follow the unshielded split: shielded notes are encrypted to
// the user's Zswap encryption key — only the wallet can see them. So the
// wallet has to own the ENTIRE pre-prove pipeline:
//
//   1. Run the shielded SDK's transferTransaction(zswapKeys, outputs) which
//      reads the wallet's note set, picks input notes, builds change, signs
//      with the Zswap secret keys, and returns an UnprovenTransaction.
//   2. Serialize → hex.
//
// Sidecar (/tx/prove-and-submit) then does ZK proof + bind + substrate
// submit. The witness data the prover needs is embedded in the unproven tx
// hex — when shipping to Gero Cloud the user has explicitly consented to
// us seeing it (see ShieldedProvingConsentDialog in Step 5).
//
// Local-proving alternative (WP-P2, 2026-07-13): when the caller supplies
// `proving: { url }`, step 2 above is replaced by prove+bind against a
// self-hosted docker proof server BEFORE serializing, so the returned hex
// is a FinalizedTransaction ready for Nexus's /tx/submit-proven instead of
// /tx/prove-and-submit — no witness data leaves this machine. See
// midnightLocalProver.ts.
//
// Phase 1 wallet sync model: the SDK is started with the raw seed each send,
// then sync from scratch until it has the user's notes. Cold-sync from a
// full chain is slow (~10s-1m on preview). When state-persistence lands
// (using ShieldedWalletClass.restore(serializedState)) this becomes O(notes
// since last persist).
//
// `NIGHT_RAW_TOKEN_TYPE`, `startShieldedWallet`, and `startAndSyncShieldedWallet`
// are exported (not just used internally) so `midnightShieldSwapBuilder.ts`
// (WP-SH2, 2026-07-13) can build a shielded `initSwap` output through the
// exact same wallet-startup/sync/restore pipeline as a plain shielded send,
// instead of forking it (WP-SH2).

import type * as ledger from '@midnight-ntwrk/ledger-v8';
import type { MidnightNetworkEndpoints } from '@/chains/midnight/midnightConfig';
import { debugLog } from '@/utils/debug';
import {
  loadWalletState,
  saveWalletState,
  clearWalletState,
} from '@/chains/midnight/midnightWalletStatePersistence';

/**
 * Native NIGHT is the 32-byte-zero RawTokenType. The SDK accepts any 32-byte
 * hex, but callers use this canonical zero form so they don't need to know
 * the magic value. Shared (not redeclared) by `midnightShieldSwapBuilder.ts`.
 */
export const NIGHT_RAW_TOKEN_TYPE =
  '0000000000000000000000000000000000000000000000000000000000000000' as ledger.RawTokenType;

export interface BuildAndSignShieldedTransferOutput {
  /** Hex-encoded shielded address (`mn_shield-addr_…`) of the recipient. */
  readonly receiverAddress: string;
  /** Amount in base units (NIGHT = 6 decimals). */
  readonly amount: bigint;
  /**
   * Raw token type. Native NIGHT is the 32-byte-zero token type; custom
   * tokens supply their own. Phase 1 callers should pass {@code 'native'}.
   */
  readonly tokenType: ledger.RawTokenType | 'native';
}

export interface BuildAndSignShieldedTransferArgs {
  /** SDK network ID — 'mainnet' / 'preview' / 'preprod' / 'testnet'. */
  readonly sdkNetworkId: string;
  /** Indexer URLs (the BG knows these via midnightConfig). */
  readonly endpoints: MidnightNetworkEndpoints;
  /**
   * The wallet's 32-byte Zswap secret-key seed (from
   * {@link MidnightDerivedKeys.zswapSecretKey}). Caller wipes after.
   * ZswapSecretKeys.fromSeed(seed) inside this function derives the full
   * key bundle (coin + encryption); both are needed by transferTransaction
   * to spend existing notes and encrypt new outputs.
   */
  readonly zswapSecretKeySeed: Uint8Array;
  /** Single-recipient v1; multi-recipient is a follow-up. */
  readonly outputs: readonly BuildAndSignShieldedTransferOutput[];
  /**
   * When present, prove (and bind) the transfer against a native-API proof
   * server at {@code url} before returning, instead of leaving it unproven
   * for Gero Cloud — self-hosted docker, or Arkhia zkPaaS with its
   * {@code x-api-key}/{@code x-api-secret} auth in {@code headers}. See
   * {@link BuildAndSignShieldedTransferResult.proven}.
   */
  readonly proving?: { readonly url: string; readonly headers?: Record<string, string> };
}

/** Result of {@link buildAndSignShieldedTransfer}. */
export interface BuildAndSignShieldedTransferResult {
  /**
   * Hex-encoded transaction. Its markers depend on {@code proven}:
   * signed-but-unproven (SignatureEnabled/PreProof/PreBinding) when
   * {@code proven} is false, or fully finalized
   * (SignatureEnabled/Proof/Binding) when {@code proven} is true.
   */
  readonly txHex: string;
  /**
   * {@code true} when {@code args.proving} was supplied and this hex was
   * proven+bound locally (route callers to Nexus's `/tx/submit-proven`).
   * {@code false} for the default remote path (route callers to
   * `/tx/prove-and-submit`). Callers must branch on this rather than
   * assuming based on which path they think they took — it's authoritative.
   */
  readonly proven: boolean;
  /**
   * Wall-clock time spent in `prove()` + `bind()` against the local proof
   * server. Only present when {@code proven} is true. Callers use this to
   * populate {@link MidnightProvingLogEntry} — see {@code walletBg.ts}.
   */
  readonly proveDurationMs?: number;
}

/**
 * Thrown when local proving (against a self-hosted proof server) fails.
 * Carries the elapsed time up to the point of failure so the caller can
 * still record an accurate proving-history entry — `message` is safe to
 * surface as-is (see {@code postToProver}'s error text, which never
 * includes the request payload).
 */
export class LocalProvingError extends Error {
  readonly durationMs: number;
  constructor(message: string, durationMs: number, options?: ErrorOptions) {
    super(message, options);
    this.name = 'LocalProvingError';
    this.durationMs = durationMs;
  }
}

/**
 * Build a shielded NIGHT transfer, signed and — depending on
 * {@code args.proving} — either left unproven for Gero Cloud or proven and
 * bound locally.
 *
 * Default (no {@code proving}): returns the serialized
 * {@code UnprovenTransaction} (markers {@code SignatureEnabled, PreProof,
 * PreBinding}) — sidecar takes this, runs the ZK prover, binds, submits.
 * Caller MUST treat the hex as privacy-sensitive (carries witness data that
 * links notes to spend).
 *
 * With {@code args.proving}: proves and binds against the given proof
 * server before returning, so the hex is a finalized transaction ready for
 * Nexus's `/tx/submit-proven` (no re-proving, no witness data in that
 * request). See {@link BuildAndSignShieldedTransferResult}.
 */
export async function buildAndSignShieldedTransfer(
  args: BuildAndSignShieldedTransferArgs,
): Promise<BuildAndSignShieldedTransferResult> {
  debugLog('🌙 midnight shielded tx-builder: starting', {
    network: args.sdkNetworkId,
    outputCount: args.outputs.length,
  });

  if (args.outputs.length === 0) {
    throw new Error('At least one output is required for a shielded transfer');
  }

  const [ledgerMod, addressFormatMod] = await Promise.all([
    import('@midnight-ntwrk/ledger-v8'),
    import('@midnightntwrk/wallet-sdk-address-format'),
  ]);
  const { ZswapSecretKeys } = ledgerMod;
  // ShieldedAddress has NO static parse() (verified against the package's
  // own index.d.ts) — bech32m strings round-trip through MidnightBech32m,
  // decoded with the SAME networkId string the key manager encoded with
  // (see midnightKeyManager.ts's ShieldedAddress.codec.encode call).
  const { MidnightBech32m, ShieldedAddress } = addressFormatMod;

  // Derive the full ZswapSecretKeys from the seed. We deliberately re-derive
  // here (rather than have the caller pass the SecretKeys object) so the
  // lifetime of the SDK-owned key handle is bounded by this function — the
  // `finally` below calls .clear() to wipe the WASM-side memory regardless
  // of success/failure.
  const zswapKeys = ZswapSecretKeys.fromSeed(args.zswapSecretKeySeed);

  let shieldedWallet: Awaited<ReturnType<typeof startAndSyncShieldedWallet>> | undefined;
  try {
    shieldedWallet = await startAndSyncShieldedWallet(
      {
        sdkNetworkId: args.sdkNetworkId,
        endpoints: args.endpoints,
        zswapSecretKeySeed: args.zswapSecretKeySeed,
      },
      zswapKeys,
    );

    // Map our wire outputs into the SDK's TokenTransfer shape.
    const sdkOutputs = args.outputs.map((o) => {
      const tokenType = o.tokenType === 'native' ? NIGHT_RAW_TOKEN_TYPE : o.tokenType;
      return {
        amount: o.amount,
        type: tokenType,
        receiverAddress: ShieldedAddress.codec.decode(
          args.sdkNetworkId,
          MidnightBech32m.parse(o.receiverAddress),
        ),
      };
    });

    const unprovenTx = await shieldedWallet.transferTransaction(zswapKeys, sdkOutputs);
    debugLog('🌙 shielded transferTransaction returned');

    if (args.proving) {
      // Wallet-side proving: run the ZK prover against the caller's proof
      // server (the user's own docker server, or the Arkhia zkPaaS gateway
      // via auth headers) instead of shipping the unproven
      // (witness-carrying) hex to Gero Cloud. prove() -> bind() is the
      // exact sequence the Nexus sidecar runs server-side
      // (provingService.ts) — see plan section 0. Narrow-cast the
      // SDK-returned tx the same way the plain serialize() path below does.
      type ProvableTx = {
        prove: (provider: ledger.ProvingProvider, costModel: ledger.CostModel) =>
          Promise<{ bind: () => { serialize: () => Uint8Array } }>;
      };
      // URL only — never the auth header values (file-header privacy note).
      debugLog('🌙 shielded tx: proving wallet-side', { url: args.proving.url });
      const proveStartMs = Date.now();
      let proven: { bind: () => { serialize: () => Uint8Array } };
      try {
        const { makeLocalProvingProvider } = await import('@/chains/midnight/midnightLocalProver');
        const provider = makeLocalProvingProvider(args.proving.url, { headers: args.proving.headers });
        proven = await (unprovenTx as unknown as ProvableTx).prove(
          provider, ledgerMod.CostModel.initialCostModel(),
        );
      } catch (err) {
        // Re-thrown as LocalProvingError so the caller (walletBg.ts) can
        // record a failed proving-history entry with an accurate duration,
        // then propagate the same message through its own error handling —
        // this is not a substitute for that handling, just a duration carrier.
        const durationMs = Date.now() - proveStartMs;
        const message = err instanceof Error ? err.message : String(err);
        debugLog(`🌙 shielded tx: wallet-side proof failed after ${durationMs}ms`, message);
        throw new LocalProvingError(message, durationMs, { cause: err });
      }
      const boundBytes = proven.bind().serialize();
      const proveDurationMs = Date.now() - proveStartMs;
      debugLog(`🌙 shielded tx: wallet-side proof + bind complete (${proveDurationMs}ms)`);
      const txHex = Buffer.from(boundBytes).toString('hex');
      debugLog('🌙 shielded tx serialized (proven)', { bytes: boundBytes.length });
      return { txHex, proven: true, proveDurationMs };
    }

    const signedBytes = (unprovenTx as unknown as { serialize: () => Uint8Array }).serialize();
    const signedTxHex = Buffer.from(signedBytes).toString('hex');
    debugLog('🌙 shielded tx serialized', { bytes: signedBytes.length });
    return { txHex: signedTxHex, proven: false };
  } finally {
    try { await shieldedWallet?.stop(); } catch { /* swallow */ }
    try { zswapKeys.clear(); } catch { /* swallow */ }
  }
}

/**
 * Shape returned by the SDK's `ShieldedWallet(config)` instance. Exported so
 * `midnightShieldSwapBuilder.ts` can name the type of what
 * {@link startAndSyncShieldedWallet} hands back (e.g. for its own
 * `initSwap` call) without re-declaring a parallel shape.
 */
export type ShieldedWalletInstance = {
  start: (keys: ledger.ZswapSecretKeys) => Promise<void>;
  waitForSyncedState: (allowedGap?: bigint) => Promise<unknown>;
  transferTransaction: (
    keys: ledger.ZswapSecretKeys,
    outputs: ReadonlyArray<unknown>,
  ) => Promise<ledger.UnprovenTransaction>;
  initSwap: (
    keys: ledger.ZswapSecretKeys,
    desiredInputs: Record<ledger.RawTokenType, bigint>,
    desiredOutputs: ReadonlyArray<unknown>,
  ) => Promise<ledger.UnprovenTransaction>;
  serializeState: () => Promise<string>;
  stop: () => Promise<void>;
};

export interface StartAndSyncShieldedWalletArgs {
  /** SDK network ID — 'mainnet' / 'preview' / 'preprod' / 'testnet'. */
  readonly sdkNetworkId: string;
  /** Indexer URLs (the BG knows these via midnightConfig). */
  readonly endpoints: MidnightNetworkEndpoints;
  /**
   * Same seed used to derive {@code zswapKeys} — used only as the
   * warm-restart persistence key here, never re-read for key material.
   */
  readonly zswapSecretKeySeed: Uint8Array;
}

/**
 * Start (or warm-restore) the shielded SDK wallet and block until it reports
 * a synced state, persisting the resulting checkpoint for next time.
 *
 * Shared by `buildAndSignShieldedTransfer` (plain shielded sends) and
 * `midnightShieldSwapBuilder.ts` (shield/unshield conversions, WP-SH2) —
 * both need the identical cold/warm-sync dance; do not fork it.
 *
 * Caller owns {@code zswapKeys}'s lifetime (derives it, clears it in its own
 * `finally`) and the returned wallet instance's `.stop()` — this function's
 * job ends once the instance is live and synced, because the caller still
 * needs the live instance afterward (`transferTransaction` or `initSwap`).
 */
export async function startAndSyncShieldedWallet(
  args: StartAndSyncShieldedWalletArgs,
  zswapKeys: ledger.ZswapSecretKeys,
): Promise<ShieldedWalletInstance> {
  const [shieldedMod, abstractionsMod] = await Promise.all([
    import('@midnightntwrk/wallet-sdk-shielded'),
    import('@midnightntwrk/wallet-sdk-abstractions'),
  ]);
  const { ShieldedWallet } = shieldedMod as unknown as {
    ShieldedWallet: (config: unknown) => {
      startWithSecretKeys: (keys: ledger.ZswapSecretKeys) => ShieldedWalletInstance;
      restore: (serializedState: string) => ShieldedWalletInstance;
    };
  };
  const { InMemoryTransactionHistoryStorage } = abstractionsMod;
  const txHistoryNs = (abstractionsMod as unknown as {
    TransactionHistoryStorage: { TransactionHistoryCommonSchema: unknown };
  }).TransactionHistoryStorage;

  const txHistoryStorage = new InMemoryTransactionHistoryStorage(
    txHistoryNs.TransactionHistoryCommonSchema as ConstructorParameters<
      typeof InMemoryTransactionHistoryStorage
    >[0],
  );
  const shieldedBuilder = ShieldedWallet({
    networkId: args.sdkNetworkId,
    indexerClientConnection: {
      indexerHttpUrl: args.endpoints.publicIndexerUrl,
      indexerWsUrl: args.endpoints.publicIndexerWsUrl,
    },
    txHistoryStorage,
  });

  // Warm-restart: load this wallet's persisted shielded SDK state (keyed by
  // network + zswap seed hash). Shielded cold sync is the slowest path in
  // the wallet (it walks every shielded tx the user can decrypt + maintains
  // the commitment tree), so restoring from the saved appliedIndex cursor is
  // the single biggest send-latency win. Miss / stale / corrupt → cold init.
  const persistedShieldedState = await loadWalletState(
    args.sdkNetworkId, 'shielded', args.zswapSecretKeySeed,
  );
  const shieldedWallet = await startShieldedWallet(
    shieldedBuilder, zswapKeys, persistedShieldedState,
    args.sdkNetworkId, args.zswapSecretKeySeed,
  );
  debugLog('🌙 shielded SDK: started, waiting for synced state');

  // Cold sync: walk the full shielded chain. Slow on preview/mainnet — see
  // the file header for why we accept this in Phase 1. Bounded wait +
  // timeout-then-retry-with-gap, same pattern as the dust sync in
  // midnightTxBuilder.ts. Shielded cold sync is longer than dust (every
  // shielded tx the user can decrypt vs. just dust events for one address),
  // so the timeout budget is doubled. State-persistence follow-up will
  // eliminate the cold sync entirely.
  const syncStartMs = Date.now();
  const SYNC_TIMEOUT_MS = 180_000;
  try {
    await Promise.race([
      shieldedWallet.waitForSyncedState(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`shielded sync timed out after ${SYNC_TIMEOUT_MS / 1000}s`)), SYNC_TIMEOUT_MS),
      ),
    ]);
    debugLog(`🌙 shielded SDK: synced (${Date.now() - syncStartMs}ms)`);
  } catch (timeoutErr) {
    debugLog(`🌙 shielded SDK: sync TIMEOUT after ${Date.now() - syncStartMs}ms — retrying with allowedGap=1000`, timeoutErr);
    await Promise.race([
      shieldedWallet.waitForSyncedState(1000n),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('shielded sync (gap=1000) timed out after 60s')), 60_000),
      ),
    ]);
    debugLog(`🌙 shielded SDK: synced with gap (${Date.now() - syncStartMs}ms)`);
  }

  // Persist the now-synced shielded state so the next call restores warm.
  // Best-effort; a save failure only costs a cold sync next time. Saved
  // before the caller's tx-build step so we keep the (expensive) sync
  // progress even if that step throws.
  try {
    const serialized = await shieldedWallet.serializeState();
    await saveWalletState(args.sdkNetworkId, 'shielded', args.zswapSecretKeySeed, serialized);
  } catch (e) {
    debugLog('🌙 shielded state persist failed (non-fatal)', e);
  }

  return shieldedWallet;
}

/**
 * Start (or warm-restore) a `ShieldedWallet` builder into a live instance.
 * Exported so `midnightShieldSwapBuilder.ts` can reuse the exact restore/
 * cold-init decision instead of forking it — see the file header.
 *
 * Takes the concrete {@link ShieldedWalletInstance} shape directly (not
 * generic over it) — a generic `<I extends {...}>` version was tried first
 * but TypeScript's inference for `I` fell back to the bare constraint shape
 * (dropping `initSwap`) rather than the caller's actual wider instance type,
 * which only surfaced once a second caller (`midnightShieldSwapBuilder.ts`,
 * via `startAndSyncShieldedWallet`) needed `initSwap` on the result.
 */
export async function startShieldedWallet(
  builder: {
    startWithSecretKeys: (keys: ledger.ZswapSecretKeys) => ShieldedWalletInstance;
    restore: (serializedState: string) => ShieldedWalletInstance;
  },
  keys: ledger.ZswapSecretKeys,
  persistedState?: string | null,
  network?: string,
  identitySeed?: Uint8Array,
): Promise<ShieldedWalletInstance> {
  // Warm restore when we have persisted state; else cold init. Both return
  // the instance and then need start(keys) to open the WS subscription —
  // restore resumes from the saved cursor, cold init from genesis. If restore
  // throws (corrupt / SDK-upgrade-incompatible blob), drop the bad state and
  // cold-init this run so we self-heal rather than failing every send.
  let wallet: ShieldedWalletInstance;
  if (persistedState) {
    try {
      wallet = builder.restore(persistedState);
      debugLog('🌙 shielded wallet: restored from persisted state (warm)');
    } catch (e) {
      debugLog('🌙 shielded wallet: restore failed — clearing bad state, cold init', e);
      if (network && identitySeed) {
        try { await clearWalletState(network, 'shielded', identitySeed); } catch { /* swallow */ }
      }
      wallet = builder.startWithSecretKeys(keys);
    }
  } else {
    wallet = builder.startWithSecretKeys(keys);
  }
  await wallet.start(keys);
  return wallet;
}
