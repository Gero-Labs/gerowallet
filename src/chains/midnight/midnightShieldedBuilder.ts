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
// Phase 1 wallet sync model: the SDK is started with the raw seed each send,
// then sync from scratch until it has the user's notes. Cold-sync from a
// full chain is slow (~10s-1m on preview). When state-persistence lands
// (using ShieldedWalletClass.restore(serializedState)) this becomes O(notes
// since last persist).

import type * as ledger from '@midnight-ntwrk/ledger-v8';
import type { MidnightNetworkEndpoints } from '@/chains/midnight/midnightConfig';
import { debugLog } from '@/utils/debug';
import {
  loadWalletState,
  saveWalletState,
  clearWalletState,
} from '@/chains/midnight/midnightWalletStatePersistence';

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
}

/**
 * Build a SIGNED-but-UNPROVEN shielded NIGHT transfer.
 *
 * The returned hex is the serialized {@code UnprovenTransaction} (markers
 * {@code SignatureEnabled, PreProof, PreBinding}) — sidecar takes this,
 * runs the ZK prover, binds, submits. Caller MUST treat the hex as
 * privacy-sensitive (carries witness data that links notes to spend).
 */
export async function buildAndSignShieldedTransfer(
  args: BuildAndSignShieldedTransferArgs,
): Promise<string> {
  debugLog('🌙 midnight shielded tx-builder: starting', {
    network: args.sdkNetworkId,
    outputCount: args.outputs.length,
  });

  if (args.outputs.length === 0) {
    throw new Error('At least one output is required for a shielded transfer');
  }

  const [
    shieldedMod,
    ledgerMod,
    abstractionsMod,
    addressFormatMod,
  ] = await Promise.all([
    import('@midnightntwrk/wallet-sdk-shielded'),
    import('@midnight-ntwrk/ledger-v8'),
    import('@midnightntwrk/wallet-sdk-abstractions'),
    import('@midnightntwrk/wallet-sdk-address-format'),
  ]);
  type ShieldedWalletInstance = {
    start: (keys: ledger.ZswapSecretKeys) => Promise<void>;
    waitForSyncedState: (allowedGap?: bigint) => Promise<unknown>;
    transferTransaction: (
      keys: ledger.ZswapSecretKeys,
      outputs: ReadonlyArray<unknown>,
    ) => Promise<ledger.UnprovenTransaction>;
    serializeState: () => Promise<string>;
    stop: () => Promise<void>;
  };
  const { ShieldedWallet } = shieldedMod as unknown as {
    ShieldedWallet: (config: unknown) => {
      startWithSecretKeys: (keys: ledger.ZswapSecretKeys) => ShieldedWalletInstance;
      restore: (serializedState: string) => ShieldedWalletInstance;
    };
  };
  const { ZswapSecretKeys } = ledgerMod;
  const { InMemoryTransactionHistoryStorage } = abstractionsMod;
  const txHistoryNs = (abstractionsMod as unknown as {
    TransactionHistoryStorage: { TransactionHistoryCommonSchema: unknown };
  }).TransactionHistoryStorage;
  const { ShieldedAddress } = addressFormatMod as unknown as {
    ShieldedAddress: { parse: (s: string) => unknown };
  };

  // Native NIGHT is the 32-byte-zero RawTokenType. The SDK accepts any
  // 32-byte hex, but here we map the convenient 'native' shorthand to the
  // canonical zero form so callers don't need to know the magic value.
  const NIGHT_RAW_TOKEN_TYPE =
    '0000000000000000000000000000000000000000000000000000000000000000' as ledger.RawTokenType;

  // Derive the full ZswapSecretKeys from the seed. We deliberately re-derive
  // here (rather than have the caller pass the SecretKeys object) so the
  // lifetime of the SDK-owned key handle is bounded by this function — the
  // `finally` below calls .clear() to wipe the WASM-side memory regardless
  // of success/failure.
  const zswapKeys = ZswapSecretKeys.fromSeed(args.zswapSecretKeySeed);

  let shieldedWallet: Awaited<ReturnType<typeof startShieldedWallet>> | undefined;
  try {
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
    shieldedWallet = await startShieldedWallet(
      shieldedBuilder, zswapKeys, persistedShieldedState,
      args.sdkNetworkId, args.zswapSecretKeySeed,
    );
    debugLog('🌙 shielded SDK: started, waiting for synced state');

    // Cold sync: walk the full shielded chain. Slow on preview/mainnet —
    // see the file header for why we accept this in Phase 1.
    // Bounded wait + timeout-then-retry-with-gap, same pattern as the dust
    // sync in midnightTxBuilder.ts. Shielded cold sync is longer than dust
    // (every shielded tx the user can decrypt vs. just dust events for one
    // address), so the timeout budget is doubled. State-persistence
    // follow-up will eliminate the cold sync entirely.
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

    // Persist the now-synced shielded state so the next send restores warm.
    // Best-effort; a save failure only costs a cold sync next time. Saved
    // before transferTransaction so we keep the (expensive) sync progress
    // even if the transfer build throws.
    try {
      const serialized = await shieldedWallet.serializeState();
      await saveWalletState(args.sdkNetworkId, 'shielded', args.zswapSecretKeySeed, serialized);
    } catch (e) {
      debugLog('🌙 shielded state persist failed (non-fatal)', e);
    }

    // Map our wire outputs into the SDK's TokenTransfer shape.
    const sdkOutputs = args.outputs.map((o) => {
      const tokenType = o.tokenType === 'native' ? NIGHT_RAW_TOKEN_TYPE : o.tokenType;
      return {
        amount: o.amount,
        type: tokenType,
        receiverAddress: ShieldedAddress.parse(o.receiverAddress),
      };
    });

    const unprovenTx = await shieldedWallet.transferTransaction(zswapKeys, sdkOutputs);
    debugLog('🌙 shielded transferTransaction returned');

    const signedBytes = (unprovenTx as unknown as { serialize: () => Uint8Array }).serialize();
    const signedTxHex = Buffer.from(signedBytes).toString('hex');
    debugLog('🌙 shielded tx serialized', { bytes: signedBytes.length });
    return signedTxHex;
  } finally {
    try { await shieldedWallet?.stop(); } catch { /* swallow */ }
    try { zswapKeys.clear(); } catch { /* swallow */ }
  }
}

async function startShieldedWallet<
  I extends {
    start: (keys: ledger.ZswapSecretKeys) => Promise<void>;
    waitForSyncedState: (allowedGap?: bigint) => Promise<unknown>;
    transferTransaction: (
      keys: ledger.ZswapSecretKeys,
      outputs: ReadonlyArray<unknown>,
    ) => Promise<ledger.UnprovenTransaction>;
    serializeState: () => Promise<string>;
    stop: () => Promise<void>;
  },
  W extends {
    startWithSecretKeys: (keys: ledger.ZswapSecretKeys) => I;
    restore: (serializedState: string) => I;
  },
>(
  builder: W,
  keys: ledger.ZswapSecretKeys,
  persistedState?: string | null,
  network?: string,
  identitySeed?: Uint8Array,
): Promise<I> {
  // Warm restore when we have persisted state; else cold init. Both return
  // the instance and then need start(keys) to open the WS subscription —
  // restore resumes from the saved cursor, cold init from genesis. If restore
  // throws (corrupt / SDK-upgrade-incompatible blob), drop the bad state and
  // cold-init this run so we self-heal rather than failing every send.
  let wallet: I;
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
