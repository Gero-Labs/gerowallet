/** The Stagenet rc.3 stack is isolated from Mainnet/Preprod's ledger 8 SDK. */
import * as ledger from '@midnightntwrk/ledger-v9';
import { createKeystore } from 'midnight-v9-unshielded-wallet';
import { DustWallet } from 'midnight-v9-dust-wallet';
import { InMemoryTransactionHistoryStorage, TransactionHistoryStorage } from 'midnight-v9-abstractions';
import type { BalanceAndSignUnshieldedTransferArgs, SyncDustAndBalanceFeesArgs } from './midnightTxBuilder';
import { midnightLedgerVersion, strictMidnightHex } from './midnightLedger';
import { loadWalletState, saveWalletState, clearWalletState } from './midnightWalletStatePersistence';
import { shouldDiscardCheckpoint } from './midnightDustCheckpoint';
import { readVerifiedMidnightChainIdentity, midnightCheckpointNamespace, assertMidnightChainIdentityUnchanged, fetchLedger9DustSnapshot } from './midnightChainIdentity';

export function deserializeLedger9Transaction(network: string, hex: string): ledger.UnprovenTransaction {
  if (midnightLedgerVersion(network) !== 9) throw new Error('Ledger 9 requires Midnight Stagenet');
  const tx: ledger.UnprovenTransaction = ledger.Transaction.deserialize('signature', 'pre-proof', 'pre-binding', strictMidnightHex(hex));
  // The generation tag alone does not validate the embedded network ID.
  ledger.Transaction.fromParts('stagenet').merge(tx);
  return tx;
}

/** Sign only the sender's inputs using the canonical rc.3 intent envelope. */
export function signLedger9Transaction(
  network: string,
  hex: string,
  secret: Uint8Array,
): string {
  const tx = deserializeLedger9Transaction(network, hex);
  const keystore = createKeystore({ kind: 'schnorr', secret }, 'stagenet');
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

async function bounded<T>(promise: Promise<T>, milliseconds: number, operation: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Midnight ${operation} timed out`)), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function balanceAndSignLedger9Transfer(args: BalanceAndSignUnshieldedTransferArgs): Promise<string> {
  const tx = deserializeLedger9Transaction(args.sdkNetworkId, args.unprovenTxHex);
  const fee = await balanceLedger9Fees(args, [tx]);
  const merged = tx.merge(fee);
  return signLedger9Transaction('stagenet', Buffer.from(merged.serialize()).toString('hex'), args.unshieldedSecretKey);
}

/** Fee ownership follows the supplied DUST seed, independently of the transaction signer. */
export async function balanceLedger9Fees(
  args: SyncDustAndBalanceFeesArgs,
  transactions: ledger.UnprovenTransaction[],
): Promise<ledger.UnprovenTransaction> {
  if (midnightLedgerVersion(args.sdkNetworkId) !== 9 || args.endpoints.sdkNetworkId !== 'stagenet') {
    throw new Error('Midnight endpoint network mismatch');
  }
  if (!transactions.length) throw new Error('At least one Midnight transaction is required');
  if (!Number.isFinite(args.ttl.getTime()) || args.ttl.getTime() <= Date.now()) throw new Error('Midnight transaction expiry must be in the future');
  for (const tx of transactions) ledger.Transaction.fromParts('stagenet').merge(tx);
  const identity = await readVerifiedMidnightChainIdentity(args.endpoints);
  const dustKey = ledger.DustSecretKey.fromSeed(args.dustSecretSeed);
  const stateNetwork = midnightCheckpointNamespace(identity);
  let wallet: ReturnType<ReturnType<typeof DustWallet>['startWithSecretKey']> | undefined;
  let subscription: { unsubscribe(): void } | undefined;
  let restoredFromLocal = false;
  try {
    const history = new InMemoryTransactionHistoryStorage(TransactionHistoryStorage.TransactionHistoryEntryCommonSchema);
    const configuration = {
      networkId: 'stagenet' as const,
      costParameters: { feeBlocksMargin: 1 },
      indexerClientConnection: {
        indexerHttpUrl: args.endpoints.publicIndexerUrl,
        indexerWsUrl: args.endpoints.publicIndexerWsUrl,
      },
      txHistoryStorage: history,
    };
    const builder = DustWallet(configuration);
    const saved = await loadWalletState(stateNetwork, 'dust', args.dustSecretSeed);
    if (saved) {
      try { wallet = builder.restore(saved); restoredFromLocal = true; } catch {
        await clearWalletState(stateNetwork, 'dust', args.dustSecretSeed);
      }
    }
    if (!wallet && args.dustRegisteredAt) {
      const snapshot = await fetchLedger9DustSnapshot(args.endpoints, identity, args.dustRegisteredAt);
      if (snapshot) {
        try { wallet = builder.restore(snapshot); } catch { /* incompatible snapshots fall back to replay */ }
      }
    }
    wallet ??= builder.startWithSecretKey(dustKey, ledger.LedgerParameters.initialParameters().dust);
    await bounded(wallet.start(dustKey), 30_000, 'DUST startup');
    subscription = wallet.state.subscribe({ next: () => {
      try { args.onDustSyncProgress?.(-1, 'Synchronizing Stagenet DUST'); } catch { /* progress is advisory */ }
    }, error: () => {} });
    await bounded(wallet.waitForSyncedState(), 15 * 60_000, 'DUST synchronization');
    const serialized = await bounded<string>(wallet.serializeState(), 10_000, 'DUST checkpoint');
    await assertMidnightChainIdentityUnchanged(args.endpoints, identity);
    await saveWalletState(stateNetwork, 'dust', args.dustSecretSeed, serialized).catch(() => {});
    const fee = await bounded<{ transaction: ledger.UnprovenTransaction }>(wallet.balanceTransactions(dustKey, transactions, args.ttl), 60_000, 'DUST fee calculation');
    await assertMidnightChainIdentityUnchanged(args.endpoints, identity);
    return fee.transaction;
  } catch (error) {
    const feeTimedOut = error instanceof Error && error.message === 'Midnight DUST fee calculation timed out';
    if (shouldDiscardCheckpoint(error, restoredFromLocal) || (restoredFromLocal && feeTimedOut)) {
      await clearWalletState(stateNetwork, 'dust', args.dustSecretSeed);
    }
    throw error;
  } finally {
    subscription?.unsubscribe();
    try { if (wallet) await bounded(wallet.stop(), 30_000, 'DUST shutdown'); } finally { dustKey.clear(); }
  }
}
