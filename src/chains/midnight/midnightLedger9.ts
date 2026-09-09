/** The Stagenet rc.3 stack is isolated from Mainnet/Preprod's ledger 8 SDK. */
import * as ledger from '@midnightntwrk/ledger-v9';
import { createKeystore } from 'midnight-v9-unshielded-wallet';
import { DustWallet } from 'midnight-v9-dust-wallet';
import { InMemoryTransactionHistoryStorage, TransactionHistoryStorage } from 'midnight-v9-abstractions';
import type { BalanceAndSignUnshieldedTransferArgs } from './midnightTxBuilder';
import { midnightLedgerVersion, strictMidnightHex } from './midnightLedger';
import { loadWalletState, saveWalletState, clearWalletState } from './midnightWalletStatePersistence';

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
  if (args.endpoints.sdkNetworkId !== 'stagenet') throw new Error('Midnight endpoint network mismatch');
  const dustKey = ledger.DustSecretKey.fromSeed(args.dustSecretSeed);
  // A separate namespace prevents restoring an old ledger-8 Stagenet checkpoint.
  const stateNetwork = 'stagenet-ledger9-rc3';
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
  let wallet: ReturnType<typeof builder.startWithSecretKey> | undefined;
  let subscription: { unsubscribe(): void } | undefined;
  try {
    const saved = await loadWalletState(stateNetwork, 'dust', args.dustSecretSeed);
    if (saved) {
      try { wallet = builder.restore(saved); } catch {
        await clearWalletState(stateNetwork, 'dust', args.dustSecretSeed);
      }
    }
    wallet ??= builder.startWithSecretKey(dustKey, ledger.LedgerParameters.initialParameters().dust);
    await bounded(wallet.start(dustKey), 30_000, 'DUST startup');
    subscription = wallet.state.subscribe(() => {
      try { args.onDustSyncProgress?.(-1, 'Synchronizing Stagenet DUST'); } catch { /* progress is advisory */ }
    });
    await bounded(wallet.waitForSyncedState(), 15 * 60_000, 'DUST synchronization');
    const serialized = await wallet.serializeState();
    await saveWalletState(stateNetwork, 'dust', args.dustSecretSeed, serialized).catch(() => {});
    const fee = await bounded<{ transaction: ledger.UnprovenTransaction }>(wallet.balanceTransactions(dustKey, [tx], args.ttl), 60_000, 'DUST fee calculation');
    const merged = tx.merge(fee.transaction);
    return signLedger9Transaction('stagenet', Buffer.from(merged.serialize()).toString('hex'), args.unshieldedSecretKey);
  } finally {
    subscription?.unsubscribe();
    try { await wallet?.stop(); } finally { dustKey.clear(); }
  }
}
