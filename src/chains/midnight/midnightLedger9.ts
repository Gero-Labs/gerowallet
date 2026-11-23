/** Ledger 9 (`@midnightntwrk/ledger-v9`) with wallet SDK 2.0.0, isolated from the ledger 8 SDK. */
import * as ledger from '@midnightntwrk/ledger-v9';
import { createKeystore } from 'midnight-v9-unshielded-wallet/v2';
import type { BalanceAndSignUnshieldedTransferArgs, SyncDustAndBalanceFeesArgs } from './midnightTxBuilder';
import {
  MIDNIGHT_LEDGER9_FIRST_BLOCK, MidnightLedgerChangedError, midnightLedgerKey, midnightLedgerVersion, midnightNetworkName,
  strictMidnightHex,
} from './midnightLedger';
import { resolveMidnightLedger } from './midnightChainLedger';
import { readVerifiedMidnightChainIdentity, assertMidnightChainIdentityUnchanged } from './midnightChainIdentity';
import { reconstructDustState } from './midnightDustLightSync';
import { createDustLightTransport } from './midnightDustLightTransport';
import { dustLedger9, balanceLightDust9, type DustBalanceable9 } from './midnightDustLightLedger9';
import { spreadLightDust9, type SealedTransaction9 } from './midnightDustSpread9';
import { DUST_SYNC_INACTIVITY_MS, dustSyncReporting, watchDustSync } from './midnightDustSyncWatch';
import { midnightTimer, timedDustTransport } from './midnightTiming';
import { dustSpendCheckpointWriter, loadDustSpendCheckpoint } from './midnightDustSpendCheckpoint';

const CHECKPOINT_LOAD_TIMEOUT_MS = 3_000;

/** `promise`, or `fallback` when it has not settled within `ms`. */
function withinMs<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([promise, new Promise<T>(resolve => { timer = setTimeout(() => resolve(fallback), ms); })])
    .finally(() => clearTimeout(timer));
}

/** Wallet SDK 2's Schnorr keystore for the unshielded key on `network`. */
export function ledger9Keystore(secret: Uint8Array, network: string) {
  return createKeystore({ kind: 'schnorr', secret }, network);
}

/** Deserialize unproven ledger-9 transaction bytes; throws when they are not one. */
export function readLedger9UnprovenTransaction(bytes: Uint8Array): ledger.UnprovenTransaction {
  return ledger.Transaction.deserialize('signature', 'pre-proof', 'pre-binding', bytes);
}

/** Throws unless `tx` was built for `network`: the generation tag alone does not validate the embedded network ID. */
export function assertLedger9TransactionNetwork(network: string, tx: ledger.UnprovenTransaction): void {
  ledger.Transaction.fromParts(midnightLedgerKey(network)).merge(tx);
}

/**
 * True when `bytes` are an unproven ledger-9 transaction for `network`. On a
 * network this build signs with ledger 8, that tells "the network moved to a
 * newer ledger" apart from bytes that are simply unreadable.
 */
export function isLedger9TransactionFor(network: string, bytes: Uint8Array): boolean {
  try {
    assertLedger9TransactionNetwork(network, readLedger9UnprovenTransaction(bytes));
    return true;
  } catch {
    return false;
  }
}

/** Throws unless `network`'s chain was last read on ledger 9 (the caller resolves it first). */
export function requireLedger9Chain(network: string): void {
  const current = midnightLedgerVersion(network);
  if (current !== 9) {
    throw new Error(`Midnight ${midnightNetworkName(network)} runs ledger ${current}; this is a ledger 9 transaction path`);
  }
}

export function deserializeLedger9Transaction(network: string, hex: string): ledger.UnprovenTransaction {
  requireLedger9Chain(network);
  const tx = readLedger9UnprovenTransaction(strictMidnightHex(hex));
  assertLedger9TransactionNetwork(network, tx);
  return tx;
}

/** A ledger 9 transaction whose intents can still take signatures: unproven, or proven and not yet bound. */
export type Ledger9SignableTransaction = ledger.Transaction<ledger.SignatureEnabled, ledger.Proofish, ledger.PreBinding>;

/**
 * Sign every unsigned unshielded input of `tx` that `keystore`'s key owns, in
 * every intent, over the canonical intent envelope. Refuses an unsigned input
 * of another key: signing it would not authorise it, and an approval never
 * covers someone else's coins. Mutates and returns `tx`.
 */
export function signLedger9Intents<T extends Ledger9SignableTransaction>(
  tx: T,
  keystore: { getPublicKey(): ledger.SignatureVerifyingKey; signData(data: Uint8Array): ledger.Signature },
): T {
  const key = keystore.getPublicKey();
  for (const [segment, intent] of tx.intents ?? []) {
    const signature = keystore.signData(intent.signatureData(segment));
    for (const field of ['guaranteedUnshieldedOffer', 'fallibleUnshieldedOffer'] as const) {
      const offer = intent[field];
      if (!offer) continue;
      const signatures = offer.inputs.map((input, index) => {
        const existing = offer.signatures[index];
        if (existing) return existing;
        if (input.owner.tag !== key.tag || input.owner.value !== key.value) {
          throw new Error('Midnight transaction contains an unsigned input belonging to another key');
        }
        return new ledger.SignatureEnabled(signature);
      });
      if (offer.signatures.length > offer.inputs.length) throw new Error('Too many Midnight input signatures');
      intent[field] = ledger.UnshieldedOffer.new(offer.inputs, offer.outputs, signatures);
    }
    if (tx.intents) tx.intents = tx.intents.set(segment, intent);
  }
  return tx;
}

/** Sign only the sender's inputs using the canonical ledger 9 intent envelope. */
export function signLedger9Transaction(
  network: string,
  hex: string,
  secret: Uint8Array,
): string {
  const tx = deserializeLedger9Transaction(network, hex);
  signLedger9Intents(tx, ledger9Keystore(secret, midnightLedgerKey(network)));
  return Buffer.from(tx.serialize()).toString('hex');
}

export async function balanceAndSignLedger9Transfer(args: BalanceAndSignUnshieldedTransferArgs): Promise<string> {
  await resolveMidnightLedger(args.sdkNetworkId);
  const tx = deserializeLedger9Transaction(args.sdkNetworkId, args.unprovenTxHex);
  const fee = await balanceLedger9Fees(args, [tx]);
  const merged = tx.merge(fee);
  return signLedger9Transaction(args.sdkNetworkId, Buffer.from(merged.serialize()).toString('hex'), args.unshieldedSecretKey);
}

/**
 * Pay inside `carrier` (the wallet's own one-intent transaction; a new intent
 * when absent) with the fewest DUST spends that fit. `sign` signs the wallet's
 * inputs once the spends are in, so the limit is checked on the signed shape
 * (`DustSpread9Options.sign`).
 */
export interface Ledger9FeeSpread {
  readonly carrier?: ledger.UnprovenTransaction;
  readonly sign?: (tx: ledger.UnprovenTransaction) => ledger.UnprovenTransaction;
}

/**
 * Fee ownership follows the supplied DUST seed, independently of the
 * transaction signer. `minimumDustSpends: 2` for a dApp's contract call (see
 * `BalanceLightDust9Options`). With `spread`, the transactions are other
 * parties' sealed parts and the result is the carrier with the DUST spends in
 * its intent (midnightDustSpread9.ts), not a fee transaction of its own.
 */
export async function balanceLedger9Fees(
  args: SyncDustAndBalanceFeesArgs & { readonly spread: Ledger9FeeSpread },
  transactions: SealedTransaction9[],
): Promise<ledger.UnprovenTransaction>;
export async function balanceLedger9Fees(
  args: SyncDustAndBalanceFeesArgs & { readonly minimumDustSpends?: number; readonly spread?: undefined },
  transactions: DustBalanceable9[],
): Promise<ledger.UnprovenTransaction>;
export async function balanceLedger9Fees(
  args: SyncDustAndBalanceFeesArgs & { readonly minimumDustSpends?: number; readonly spread?: Ledger9FeeSpread },
  transactions: Array<DustBalanceable9 | SealedTransaction9>,
): Promise<ledger.UnprovenTransaction> {
  const network = midnightLedgerKey(args.sdkNetworkId);
  if (args.endpoints.sdkNetworkId !== network) throw new Error('Midnight endpoint network mismatch');
  if (await resolveMidnightLedger(network) !== 9) throw new MidnightLedgerChangedError(network, midnightLedgerVersion(network));
  if (!transactions.length) throw new Error('At least one Midnight transaction is required');
  if (!Number.isFinite(args.ttl.getTime()) || args.ttl.getTime() <= Date.now()) throw new Error('Midnight transaction expiry must be in the future');
  // The ledger refuses to merge transactions of different networks; proofs are erased so a dApp's proven one merges too.
  for (const tx of transactions) ledger.Transaction.fromParts(network).eraseProofs().merge(tx.eraseProofs());
  const dustKey = ledger.DustSecretKey.fromSeed(args.dustSecretSeed);
  const controller = new AbortController();
  // The same silence and TTL bounds as the ledger 8 builder (gero-ios#241), not a flat time.
  const watchdog = watchDustSync(controller, DUST_SYNC_INACTIVITY_MS, args.ttl.getTime());
  const { progress, reply } = dustSyncReporting(watchdog, args.onDustSyncProgress);
  const timer = midnightTimer('dust fee (ledger 9)');
  let outcome: 'ok' | 'failed' = 'failed';
  try {
    const identity = await timer.time('chainIdentity', () => readVerifiedMidnightChainIdentity(args.endpoints, controller.signal));
    watchdog.activity();
    // Resume each DUST spend chain where the last build left it (a full scan is minutes on mainnet).
    // A hint: a store that does not answer in time costs a cold scan, not the build.
    const saved = await timer.time('checkpointLoad', () => withinMs(loadDustSpendCheckpoint(network, args.dustSecretSeed, identity),
      CHECKPOINT_LOAD_TIMEOUT_MS, null));
    // One writer for all of this build's saves: they are stored in the order made, so the
    // save at the end is the one that stays, however slow an earlier write was.
    const saveCheckpoint = dustSpendCheckpointWriter(network, args.dustSecretSeed, identity);
    const reconstructStart = Date.now();
    const { state, block, checkpoint } = await reconstructDustState(dustLedger9, dustKey, network,
      timedDustTransport(createDustLightTransport(args.endpoints, controller.signal, reply), timer), progress,
      { checkpoint: saved, ledgerFirstBlock: Object.hasOwn(MIDNIGHT_LEDGER9_FIRST_BLOCK, network) ? MIDNIGHT_LEDGER9_FIRST_BLOCK[network] : undefined,
        // Kept as the scan goes, so a build that fails later (a timeout, a server error, the TTL)
        // leaves the next one only the rest to scan. Not awaited, like the save below.
        onCheckpoint: partial => { void saveCheckpoint(partial); } });
    timer.note({ reconstructMs: Date.now() - reconstructStart, resumedBlocks: saved ? block.height - saved.checkedThrough : undefined });
    controller.signal.throwIfAborted();
    timer.lap('reconstructLocal');
    const fee = args.spread
      ? spreadLightDust9(state, dustKey, network, transactions as SealedTransaction9[], args.spread.carrier, args.ttl,
        new Date(block.timestamp), block.ledgerParameters, { sign: args.spread.sign })
      : balanceLightDust9(state, dustKey, network, transactions as DustBalanceable9[], args.ttl, new Date(block.timestamp),
        block.ledgerParameters, { minimumSpends: args.minimumDustSpends });
    timer.lap('balance');
    watchdog.activity();
    await timer.time('chainIdentityRecheck', () => assertMidnightChainIdentityUnchanged(args.endpoints, identity, controller.signal));
    // Not awaited: the fee is ready, and a stalled store must not hold it back. The
    // writer hashed the seed into its row key when it was made, so wiping the seed
    // after this returns cannot change the row (midnightDustSpendCheckpoint.spec).
    if (checkpoint) void saveCheckpoint(checkpoint);
    outcome = 'ok';
    return fee;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('DUST synchronization timed out. Please try again shortly.');
    throw error;
  } finally {
    timer.done(outcome);
    watchdog.stop();
    controller.abort();
    dustKey.clear();
  }
}
