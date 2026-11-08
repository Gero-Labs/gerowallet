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
//
// `syncDustWalletAndBalanceFees` and `signUnshieldedSegments` (below) are
// exported as standalone steps — not just inlined in
// `balanceAndSignUnshieldedTransfer` — so `midnightShieldSwapBuilder.ts`
// (WP-SH2, 2026-07-13) can reuse the identical DUST-sync and NightExternal-
// signing pipelines for the unshielded half of a shield/unshield conversion,
// instead of forking either (WP-SH2).

import type * as ledger from '@midnight-ntwrk/ledger-v8';
import { DustSecretKey } from '@midnight-ntwrk/ledger-v8';
import { dustLedger8, balanceLightDust8 } from './midnightDustLightLedger8';
import { reconstructDustState } from './midnightDustLightSync';
import { createDustLightTransport } from './midnightDustLightTransport';
import { midnightLedgerVersion, requireMidnightLedger8 } from './midnightLedger';
import type { MidnightNetworkEndpoints } from '@/chains/midnight/midnightConfig';
import { debugLog } from '@/utils/debug';
import { readVerifiedMidnightChainIdentity, assertMidnightChainIdentityUnchanged } from './midnightChainIdentity';

export interface BalanceAndSignUnshieldedTransferArgs {
  /** SDK network ID — 'mainnet' / 'stagenet' / 'preprod' / 'testnet'. */
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
   * @deprecated Compact DUST sync discovers registrations from the chain.
   * Kept for callers built against the former snapshot-bootstrap interface.
   */
  readonly dustRegisteredAt?: Date;
  /**
   * Optional progress sink for compact DUST synchronization (0-100 percent).
   * Updates describe phases; a throwing callback cannot break preparation.
   */
  readonly onDustSyncProgress?: (percent: number, detail: string) => void;
}

/**
 * Sub-args for {@link syncDustWalletAndBalanceFees} — the DUST-secret-scoped
 * subset of {@link BalanceAndSignUnshieldedTransferArgs} (no unshielded key,
 * no unproven-tx hex — this function balances fees for whatever tx(s) the
 * caller passes in).
 */
export interface SyncDustAndBalanceFeesArgs {
  readonly sdkNetworkId: string;
  readonly endpoints: MidnightNetworkEndpoints;
  readonly dustSecretSeed: Uint8Array;
  readonly ttl: Date;
  readonly dustRegisteredAt?: Date;
  readonly onDustSyncProgress?: (percent: number, detail: string) => void;
}

/** Transactions that can be balanced with DUST, including dapp-provided proofs. */
export type DustBalanceableTransaction =
  | ledger.UnprovenTransaction
  | ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>;

/**
 * Longest silence allowed while preparing a DUST fee: no reply from Nexus and no sync step.
 * A slow device on a long DUST history can need many minutes for one pass, and every attempt
 * starts from zero, so the sync is bounded by silence and by the transaction's TTL rather than
 * by a flat time (gero-ios#241: a flat 120 s stopped every send on a slow device). Keep this
 * well under the mobile apps' 150 s watchdog (`dustSyncInactivityLimit`) so the sync reports
 * its own timeout first.
 */
export const DUST_SYNC_INACTIVITY_MS = 60_000;

/**
 * While replies keep arriving, repeat the last progress step at most this often. A pass can
 * spend minutes between steps, and callers watching progress for silence (the mobile apps'
 * watchdogs) must still see a live sync.
 */
const DUST_SYNC_PROGRESS_REPEAT_MS = 10_000;

/** Aborts `controller` after `inactivityMs` without activity, or at `deadline`, whichever comes first. */
function watchDustSync(controller: AbortController, inactivityMs: number, deadline: number) {
  let lastActivity = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Measured from the last activity when the timer fires, not from when it was set: long
  // synchronous ledger work holds the timer back, and the activity just before it counts.
  const check = () => {
    const now = Date.now();
    const remaining = Math.min(lastActivity + inactivityMs, deadline) - now;
    if (remaining <= 0) { timer = undefined; controller.abort(); return; }
    timer = setTimeout(check, remaining);
  };
  check();
  return {
    activity: () => { lastActivity = Date.now(); },
    stop: () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; },
  };
}

/** Nexus supplies compact public projections; only key-dependent work stays local. */
export async function syncDustWalletAndBalanceFees(
  args: SyncDustAndBalanceFeesArgs,
  txs: ReadonlyArray<DustBalanceableTransaction>,
): Promise<ledger.UnprovenTransaction> {
  requireMidnightLedger8(args.sdkNetworkId, 'DUST balancing');
  if (args.endpoints.sdkNetworkId !== args.sdkNetworkId) throw new Error('Midnight endpoint network mismatch');
  if (!txs.length) throw new Error('At least one Midnight transaction is required');
  if (!Number.isFinite(args.ttl.getTime()) || args.ttl.getTime() <= Date.now()) throw new Error('Midnight transaction expiry must be in the future');
  const key = DustSecretKey.fromSeed(args.dustSecretSeed);
  const controller = new AbortController();
  // A fee for a transaction past its TTL is useless, so the TTL bounds the whole preparation.
  const watchdog = watchDustSync(controller, DUST_SYNC_INACTIVITY_MS, args.ttl.getTime());
  let lastStep: { percent: number; detail: string } | undefined;
  let lastReportAt = 0;
  const report = (percent: number, detail: string) => {
    lastReportAt = Date.now();
    try { args.onDustSyncProgress?.(percent, detail); } catch { /* advisory */ }
  };
  const progress = (percent: number, detail: string) => {
    watchdog.activity();
    lastStep = { percent, detail };
    report(percent, detail);
  };
  const reply = () => {
    watchdog.activity();
    if (lastStep && Date.now() - lastReportAt >= DUST_SYNC_PROGRESS_REPEAT_MS) report(lastStep.percent, lastStep.detail);
  };
  try {
    const identity = await readVerifiedMidnightChainIdentity(args.endpoints, controller.signal);
    watchdog.activity();
    const { state, block } = await reconstructDustState(dustLedger8, key, args.sdkNetworkId,
      createDustLightTransport(args.endpoints, controller.signal, reply), progress);
    controller.signal.throwIfAborted();
    const fee = balanceLightDust8(state, key, args.sdkNetworkId, txs, args.ttl, new Date(block.timestamp), block.ledgerParameters);
    watchdog.activity();
    await assertMidnightChainIdentityUnchanged(args.endpoints, identity, controller.signal);
    debugLog('🌙 DUST fee prepared from verified compact state');
    return fee;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('DUST synchronization timed out. Please try again shortly.');
    throw error;
  } finally {
    watchdog.stop();
    controller.abort();
    key.clear();
  }
}

/**
 * Sign each unshielded-role segment of `tx` with the sender's NightExternal
 * key (BIP-340 via `keystore.signData`), returning the signed tx.
 *
 * No UTxO sync needed: `signUnprovenTransaction` walks the tx's segments
 * directly (no UTxO state read) — only `start()` is required to make the
 * SDK's signing capability available, same as the plain-send path this was
 * extracted from.
 *
 * Shared by `balanceAndSignUnshieldedTransfer` (plain unshielded NIGHT
 * sends) and `midnightShieldSwapBuilder.ts` (shield/unshield conversions,
 * WP-SH2, 2026-07-13) — both need the identical NightExternal segment-
 * signing pipeline; do not fork it.
 */
export async function signUnshieldedSegments(
  sdkNetworkId: string,
  endpoints: MidnightNetworkEndpoints,
  unshieldedSecretKey: Uint8Array,
  tx: ledger.UnprovenTransaction,
): Promise<ledger.UnprovenTransaction> {
  // signUnprovenTransaction walks the tx's segments directly; it doesn't
  // read UTxO state. start() is enough; we skip waitForSyncedState.
  const { wallet: unshieldedWallet, keystore } = await startUnshieldedWalletForKey(
    sdkNetworkId, endpoints, unshieldedSecretKey,
  );

  try {
    const signSegment = (data: Uint8Array): ledger.Signature =>
      keystore.signData(data);
    const signedTx = await unshieldedWallet.signUnprovenTransaction(tx, signSegment);
    debugLog('🌙 unshielded segments signed');
    return signedTx;
  } finally {
    try { await unshieldedWallet.stop(); } catch { /* swallow */ }
  }
}

/**
 * A STARTED (not synced) ledger-8 unshielded SDK wallet for
 * `unshieldedSecretKey`, plus its keystore. `start()` opens the indexer
 * subscription; callers that need UTxO state (coin selection in
 * `midnightDappBalancer.ts`) must additionally `waitForSyncedState()`;
 * signing-only callers ({@link signUnshieldedSegments}) need not. The caller
 * owns `wallet.stop()`.
 *
 * Shared by the wallet's own segment signing and the DApp Connector's
 * balancing path — do not fork the builder setup.
 */
export async function startUnshieldedWalletForKey(
  sdkNetworkId: string,
  endpoints: MidnightNetworkEndpoints,
  unshieldedSecretKey: Uint8Array,
): Promise<{
  wallet: Awaited<ReturnType<typeof unshieldedBuilderStart>>;
  keystore: ReturnType<typeof import('@midnightntwrk/wallet-sdk-unshielded-wallet').createKeystore>;
}> {
  requireMidnightLedger8(sdkNetworkId, 'Legacy segment signing');
  const [{ UnshieldedWallet, createKeystore }, abstractionsMod] = await Promise.all([
    import('@midnightntwrk/wallet-sdk-unshielded-wallet'),
    import('@midnightntwrk/wallet-sdk-abstractions'),
  ]);

  // Tx history schema namespace is re-exported from abstractions as
  // `export * as TransactionHistoryStorage`. The schema we need is
  // `TransactionHistoryCommonSchema` on that namespace.
  const { InMemoryTransactionHistoryStorage } = abstractionsMod;
  const txHistoryNs = (abstractionsMod as unknown as {
    TransactionHistoryStorage: { TransactionHistoryCommonSchema: unknown };
  }).TransactionHistoryStorage;

  const keystore = createKeystore(unshieldedSecretKey, sdkNetworkId);
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
    networkId: sdkNetworkId as Parameters<typeof UnshieldedWallet>[0]['networkId'],
    indexerClientConnection: {
      indexerHttpUrl: endpoints.publicIndexerUrl,
      indexerWsUrl: endpoints.publicIndexerWsUrl,
    },
    txHistoryStorage: txHistoryStorage as unknown as Parameters<
      typeof UnshieldedWallet
    >[0]['txHistoryStorage'],
  });
  const wallet = await unshieldedBuilderStart(unshieldedBuilder, publicKey);
  return { wallet, keystore };
}

/**
 * DUST-balance + sign the unproven unshielded-NIGHT tx that Nexus built.
 * Returns the SIGNED-but-UNPROVEN tx as a hex string ready for the sidecar's
 * prove+submit step.
 */
export async function balanceAndSignUnshieldedTransfer(
  args: BalanceAndSignUnshieldedTransferArgs,
): Promise<string> {
  if (midnightLedgerVersion(args.sdkNetworkId) === 9) {
    const { balanceAndSignLedger9Transfer } = await import('./midnightLedger9');
    return balanceAndSignLedger9Transfer(args);
  }
  debugLog('🌙 midnight tx-builder: starting', {
    network: args.sdkNetworkId,
    unprovenBytes: args.unprovenTxHex.length / 2,
  });

  const { Transaction } = await import('@midnight-ntwrk/ledger-v8');

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

  // ── DUST-balance, then merge the fee tx into the transfer ─────
  const feeBalancingTx = await syncDustWalletAndBalanceFees(
    {
      sdkNetworkId: args.sdkNetworkId,
      endpoints: args.endpoints,
      dustSecretSeed: args.dustSecretSeed,
      ttl: args.ttl,
      dustRegisteredAt: args.dustRegisteredAt,
      onDustSyncProgress: args.onDustSyncProgress,
    },
    [unprovenTransfer],
  );
  const mergedTx = (unprovenTransfer as unknown as {
    merge: (other: ledger.UnprovenTransaction) => ledger.UnprovenTransaction;
  }).merge(feeBalancingTx);
  debugLog('🌙 transfer + dust fee merged');

  // ── Sign each unshielded input with the NightExternal key ─────
  const signedTx = await signUnshieldedSegments(
    args.sdkNetworkId, args.endpoints, args.unshieldedSecretKey, mergedTx,
  );
  debugLog('🌙 transfer signed');

  const signedBytes = (signedTx as unknown as { serialize: () => Uint8Array }).serialize();
  const signedTxHex = Buffer.from(signedBytes).toString('hex');
  debugLog('🌙 transfer serialized', { bytes: signedBytes.length });
  return signedTxHex;
}

/**
 * Exported so shield-swap response decoding uses the same validation.
 */
export function hexToBytes(hex: string): Uint8Array {
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
