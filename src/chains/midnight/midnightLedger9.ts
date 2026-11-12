/** Ledger 9 (`@midnightntwrk/ledger-v9`) with wallet SDK 2.0.0, isolated from the ledger 8 SDK. */
import * as ledger from '@midnightntwrk/ledger-v9';
import { createKeystore } from 'midnight-v9-unshielded-wallet/v2';
import type { BalanceAndSignUnshieldedTransferArgs, SyncDustAndBalanceFeesArgs } from './midnightTxBuilder';
import {
  MidnightLedgerChangedError, midnightLedgerKey, midnightLedgerVersion, midnightNetworkName, strictMidnightHex,
} from './midnightLedger';
import { resolveMidnightLedger } from './midnightChainLedger';
import { readVerifiedMidnightChainIdentity, assertMidnightChainIdentityUnchanged } from './midnightChainIdentity';
import { reconstructDustState } from './midnightDustLightSync';
import { createDustLightTransport } from './midnightDustLightTransport';
import { dustLedger9, balanceLightDust9 } from './midnightDustLightLedger9';
import { DUST_SYNC_INACTIVITY_MS, dustSyncReporting, watchDustSync } from './midnightDustSyncWatch';

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

/** Sign only the sender's inputs using the canonical ledger 9 intent envelope. */
export function signLedger9Transaction(
  network: string,
  hex: string,
  secret: Uint8Array,
): string {
  const tx = deserializeLedger9Transaction(network, hex);
  const keystore = ledger9Keystore(secret, midnightLedgerKey(network));
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
  return Buffer.from(tx.serialize()).toString('hex');
}

export async function balanceAndSignLedger9Transfer(args: BalanceAndSignUnshieldedTransferArgs): Promise<string> {
  await resolveMidnightLedger(args.sdkNetworkId);
  const tx = deserializeLedger9Transaction(args.sdkNetworkId, args.unprovenTxHex);
  const fee = await balanceLedger9Fees(args, [tx]);
  const merged = tx.merge(fee);
  return signLedger9Transaction(args.sdkNetworkId, Buffer.from(merged.serialize()).toString('hex'), args.unshieldedSecretKey);
}

/** Fee ownership follows the supplied DUST seed, independently of the transaction signer. */
export async function balanceLedger9Fees(
  args: SyncDustAndBalanceFeesArgs,
  transactions: ledger.UnprovenTransaction[],
): Promise<ledger.UnprovenTransaction> {
  const network = midnightLedgerKey(args.sdkNetworkId);
  if (args.endpoints.sdkNetworkId !== network) throw new Error('Midnight endpoint network mismatch');
  if (await resolveMidnightLedger(network) !== 9) throw new MidnightLedgerChangedError(network, midnightLedgerVersion(network));
  if (!transactions.length) throw new Error('At least one Midnight transaction is required');
  if (!Number.isFinite(args.ttl.getTime()) || args.ttl.getTime() <= Date.now()) throw new Error('Midnight transaction expiry must be in the future');
  for (const tx of transactions) ledger.Transaction.fromParts(network).merge(tx);
  const dustKey = ledger.DustSecretKey.fromSeed(args.dustSecretSeed);
  const controller = new AbortController();
  // The same silence and TTL bounds as the ledger 8 builder (gero-ios#241), not a flat time.
  const watchdog = watchDustSync(controller, DUST_SYNC_INACTIVITY_MS, args.ttl.getTime());
  const { progress, reply } = dustSyncReporting(watchdog, args.onDustSyncProgress);
  try {
    const identity = await readVerifiedMidnightChainIdentity(args.endpoints, controller.signal);
    watchdog.activity();
    const { state, block } = await reconstructDustState(dustLedger9, dustKey, network,
      createDustLightTransport(args.endpoints, controller.signal, reply), progress);
    controller.signal.throwIfAborted();
    const fee = balanceLightDust9(state, dustKey, network, transactions, args.ttl, new Date(block.timestamp), block.ledgerParameters);
    watchdog.activity();
    await assertMidnightChainIdentityUnchanged(args.endpoints, identity, controller.signal);
    return fee;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('DUST synchronization timed out. Please try again shortly.');
    throw error;
  } finally {
    watchdog.stop();
    controller.abort();
    dustKey.clear();
  }
}
