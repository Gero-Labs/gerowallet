// BG-side build + balance + sign for unshielded NIGHT transfers.
//
// Why this exists: every Midnight tx except first-time DUST registration
// must pay its fee with a DUST coin spend. Spending a DUST coin requires
// constructing a nullifier from the user's dust secret key + the coin's
// nonce — the SDK's `balanceTransactions(dustSecretKey, ...)` is the only
// canonical entry point and it touches the secret cryptographically.
//
// That rules out our seedless server-side architecture for non-trivial
// txs (we hit chain error `1010: Custom error 138` when we tried with a
// throwaway dust key). Tx ASSEMBLY moves into the wallet's BG service
// worker — where the mnemonic is already decrypted at sign-time. The
// sidecar still does ZK PROVING and SUBMISSION (heavy WASM + key material,
// best kept server-side).
//
// This matches Lace's architecture: wallets live in the MV3 service worker,
// the user's secrets are re-derived JIT per tx, and only proving is
// remote. See the SDK research notes in this session for citations.

import type * as ledger from '@midnight-ntwrk/ledger-v8';
import type { MidnightNetworkEndpoints } from '@/chains/midnight/midnightConfig';
import { debugLog } from '@/utils/debug';

export interface UnshieldedTransferOutput {
  /** Recipient unshielded address (bech32m `mn_addr_<network>1…`). */
  readonly address: string;
  /** Atomic units. NIGHT = 6 decimals. */
  readonly amount: bigint;
}

export interface BuildAndSignUnshieldedTransferArgs {
  /** SDK network ID — 'mainnet' / 'preview' / 'preprod' / 'testnet'. */
  readonly sdkNetworkId: string;
  /** Indexer URLs (the BG knows these via midnightConfig). */
  readonly endpoints: MidnightNetworkEndpoints;
  /** Sender's NightExternal secret key (Uint8Array). Caller wipes after. */
  readonly unshieldedSecretKey: Uint8Array;
  /** Sender's DUST secret seed (Uint8Array). Caller wipes after. */
  readonly dustSecretSeed: Uint8Array;
  readonly outputs: ReadonlyArray<UnshieldedTransferOutput>;
  readonly ttl: Date;
}

/**
 * Build + balance + sign an unshielded NIGHT transfer. Returns the SIGNED
 * but UNPROVEN tx as a hex string ready for the sidecar's prove+submit
 * step.
 *
 * Sync timing: both UnshieldedWallet and DustWallet run a brief sync
 * against the indexer to populate state. Cold sync ~5-30s; once state
 * persistence lands (next step in the plan), warm syncs will be sub-second.
 */
export async function buildAndSignUnshieldedTransfer(
  args: BuildAndSignUnshieldedTransferArgs,
): Promise<string> {
  debugLog('🌙 midnight tx-builder: starting', {
    network: args.sdkNetworkId,
    outputCount: args.outputs.length,
  });

  // Dynamic imports keep cold-start cheap if no one's sending NIGHT yet
  // (the SDK is non-trivial in size). Once we add persistence + warm
  // wallets, this can move to a top-level import.
  const [
    { UnshieldedWallet, createKeystore },
    { DustWallet },
    ledgerMod,
    { MidnightBech32m, UnshieldedAddress },
    abstractionsMod,
  ] = await Promise.all([
    import('@midnight-ntwrk/wallet-sdk-unshielded-wallet'),
    import('@midnight-ntwrk/wallet-sdk-dust-wallet'),
    import('@midnight-ntwrk/ledger-v8'),
    import('@midnight-ntwrk/wallet-sdk-address-format'),
    import('@midnight-ntwrk/wallet-sdk-abstractions'),
  ]);
  const { LedgerParameters, DustSecretKey, nativeToken } = ledgerMod;
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
  let unshieldedSubscription: { unsubscribe: () => void } | undefined;
  let dustSubscription: { unsubscribe: () => void } | undefined;

  try {
    // ── UnshieldedWallet ──────────────────────────────────────────
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
    // shareReplay({refCount:true}) on `state` requires an active
    // subscriber to drive sync; without this `waitForSyncedState`
    // can hang. The dust wallet has the same pattern.
    unshieldedSubscription = unshieldedWallet.state.subscribe(() => { /* keep-alive */ });
    debugLog('🌙 unshielded sync: waiting');
    await unshieldedWallet.waitForSyncedState();
    debugLog('🌙 unshielded sync: done');

    // ── DustWallet ────────────────────────────────────────────────
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
    dustSubscription = dustWallet.state.subscribe(() => { /* keep-alive */ });
    debugLog('🌙 dust sync: waiting');
    await dustWallet.waitForSyncedState();
    debugLog('🌙 dust sync: done');

    // ── Build the transfer (unproven, no dust fee inputs yet) ─────
    const ledgerOutputs = args.outputs.map((o) => ({
      receiverAddress: UnshieldedAddress.codec.decode(
        args.sdkNetworkId as unknown as Parameters<typeof UnshieldedAddress.codec.decode>[0],
        MidnightBech32m.parse(o.address),
      ),
      amount: o.amount,
      type: nativeToken().raw,
    }));
    const unprovenTransfer = await unshieldedWallet.transferTransaction(
      ledgerOutputs as Parameters<typeof unshieldedWallet.transferTransaction>[0],
      args.ttl,
    );
    debugLog('🌙 transfer built (unproven, no dust fee inputs)');

    // ── Add DUST fee inputs (requires the dust secret to derive
    //     nullifiers — this is the step the seedless sidecar couldn't
    //     do). Returns the same tx augmented with the dust spends.
    const balancedTx = await dustWallet.balanceTransactions(
      dustSk,
      [unprovenTransfer],
      args.ttl,
    );
    debugLog('🌙 transfer balanced with dust fee inputs');

    // ── Sign each input with the NightExternal key ────────────────
    const signSegment = (data: Uint8Array): ledger.Signature =>
      keystore.signData(data);
    const signedTx = await unshieldedWallet.signUnprovenTransaction(
      balancedTx,
      signSegment,
    );
    debugLog('🌙 transfer signed');

    const signedBytes = (signedTx as unknown as { serialize: () => Uint8Array }).serialize();
    const signedTxHex = Buffer.from(signedBytes).toString('hex');
    debugLog('🌙 transfer serialized', { bytes: signedBytes.length });
    return signedTxHex;
  } finally {
    try { unshieldedSubscription?.unsubscribe(); } catch { /* swallow */ }
    try { dustSubscription?.unsubscribe(); } catch { /* swallow */ }
    try { await unshieldedWallet?.stop(); } catch { /* swallow */ }
    try { await dustWallet?.stop(); } catch { /* swallow */ }
    try { (dustSk as unknown as { clear?: () => void } | undefined)?.clear?.(); } catch { /* swallow */ }
  }
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
