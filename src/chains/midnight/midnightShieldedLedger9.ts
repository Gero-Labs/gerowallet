import * as ledger from '@midnightntwrk/ledger-v9';
import { ShieldedWallet, type ShieldedWalletState } from 'midnight-v9-shielded';
import { InMemoryTransactionHistoryStorage, TransactionHistoryStorage } from 'midnight-v9-abstractions';
import type { BuildAndSignShieldedTransferArgs, BuildAndSignShieldedTransferResult } from './midnightShieldedBuilder';
import { midnightLedgerVersion } from './midnightLedger';
import { decodeShieldedAddress9 } from './midnightAddress9';
import { validateShieldedTokenType } from './midnightTokenCapabilities';
import { loadWalletState, saveWalletState, clearWalletState } from './midnightWalletStatePersistence';
import { balanceLedger9Fees } from './midnightLedger9';
import { proveUnshieldedTransfer } from './midnightUnshieldedProver';
import {
  readVerifiedMidnightChainIdentity,
  midnightCheckpointNamespace,
  assertMidnightChainIdentityUnchanged,
} from './midnightChainIdentity';

async function bounded<T>(work: Promise<T>, milliseconds: number, operation: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Midnight ${operation} timed out`)), milliseconds);
      }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

/** Fully sync the private note set, build the transfer, then fund its DUST fee. */
export async function buildAndSignShieldedLedger9Transfer(
  args: BuildAndSignShieldedTransferArgs,
): Promise<BuildAndSignShieldedTransferResult> {
  if (midnightLedgerVersion(args.sdkNetworkId) !== 9 || args.endpoints.sdkNetworkId !== 'stagenet') {
    throw new Error('Ledger 9 shielded transfers require Stagenet endpoints');
  }
  if (!args.dustSecretSeed || args.dustSecretSeed.length !== 32) throw new Error('Shielded transfers require a DUST fee key');
  if (!args.outputs.length) throw new Error('At least one shielded output is required');
  const outputs = args.outputs.map(output => {
    if (output.amount <= 0n) throw new Error('Shielded transfer amount must be positive');
    return {
      amount: output.amount,
      type: validateShieldedTokenType(output.tokenType),
      receiverAddress: decodeShieldedAddress9('stagenet', output.receiverAddress),
    };
  });
  const ttl = args.ttl ?? new Date(Date.now() + 30 * 60_000);
  if (!Number.isFinite(ttl.getTime()) || ttl.getTime() <= Date.now()) throw new Error('Shielded transfer expiry must be in the future');
  const identity = await readVerifiedMidnightChainIdentity(args.endpoints);
  const stateNetwork = midnightCheckpointNamespace(identity);
  const keys = ledger.ZswapSecretKeys.fromSeed(args.zswapSecretKeySeed);
  let wallet: ReturnType<ReturnType<typeof ShieldedWallet>['startWithSecretKeys']> | undefined;
  let subscription: { unsubscribe(): void } | undefined;
  try {
    const history = new InMemoryTransactionHistoryStorage(TransactionHistoryStorage.TransactionHistoryEntryCommonSchema);
    const builder = ShieldedWallet({
      networkId: 'stagenet',
      indexerClientConnection: {
        indexerHttpUrl: args.endpoints.publicIndexerUrl,
        indexerWsUrl: args.endpoints.publicIndexerWsUrl,
      },
      txHistoryStorage: history,
    });
    const saved = await loadWalletState(stateNetwork, 'shielded', args.zswapSecretKeySeed);
    if (saved) {
      try { wallet = builder.restore(saved); } catch {
        await clearWalletState(stateNetwork, 'shielded', args.zswapSecretKeySeed);
      }
    }
    wallet ??= builder.startWithSecretKeys(keys);
    await bounded(wallet.start(keys), 30_000, 'shielded wallet startup');
    subscription = wallet.state.subscribe({ error: () => {} });
    // A timeout is not a synced wallet: never sign against a deliberately stale gap.
    const state = await bounded<ShieldedWalletState>(wallet.waitForSyncedState(), 3 * 60_000, 'shielded synchronization');
    if (state.coinPublicKey.toHexString() !== keys.coinPublicKey
      || state.encryptionPublicKey.toHexString() !== keys.encryptionPublicKey) {
      await clearWalletState(stateNetwork, 'shielded', args.zswapSecretKeySeed);
      throw new Error('Shielded checkpoint belongs to a different wallet');
    }
    const snapshot = await bounded<string>(wallet.serializeState(), 10_000, 'shielded checkpoint');
    await assertMidnightChainIdentityUnchanged(args.endpoints, identity);
    await saveWalletState(stateNetwork, 'shielded', args.zswapSecretKeySeed, snapshot).catch(() => {});
    const transfer = await bounded<ledger.UnprovenTransaction>(wallet.transferTransaction(keys, outputs), 60_000, 'shielded transaction construction');
    ledger.Transaction.fromParts('stagenet').merge(transfer);
    const fees = await balanceLedger9Fees({
      sdkNetworkId: args.sdkNetworkId,
      endpoints: args.endpoints,
      dustSecretSeed: args.dustSecretSeed,
      ttl,
      dustRegisteredAt: args.dustRegisteredAt,
      onDustSyncProgress: args.onDustSyncProgress,
    }, [transfer]);
    await assertMidnightChainIdentityUnchanged(args.endpoints, identity);
    const combined = transfer.merge(fees);
    const txHex = Buffer.from(combined.serialize()).toString('hex');
    if (args.proving) {
      const { provenTxHex, proveDurationMs } = await proveUnshieldedTransfer({
        sdkNetworkId: 'stagenet', signedTxHex: txHex, proving: args.proving,
      });
      await assertMidnightChainIdentityUnchanged(args.endpoints, identity);
      return { txHex: provenTxHex, proven: true, proveDurationMs };
    }
    return { txHex, proven: false };
  } finally {
    subscription?.unsubscribe();
    try { if (wallet) await bounded(wallet.stop(), 30_000, 'shielded wallet shutdown'); }
    finally { keys.clear(); }
  }
}
