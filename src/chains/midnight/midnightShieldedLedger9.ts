import * as ledger from '@midnightntwrk/ledger-v9';
import type { ShieldedWalletState } from 'midnight-v9-shielded';
import { InMemoryTransactionHistoryStorage, TransactionHistoryStorage } from 'midnight-v9-abstractions';
import { ledger9ShieldedWallet, unprovenTransactionFromHandle, type Ledger9ShieldedWallet } from './midnightShieldedWallet9';
import type { BuildAndSignShieldedTransferArgs, BuildAndSignShieldedTransferResult } from './midnightShieldedBuilder';
import { midnightLedgerKey, midnightNetworkName } from './midnightLedger';
import { resolveMidnightChain } from './midnightChainLedger';
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
  const network = midnightLedgerKey(args.sdkNetworkId);
  if (args.endpoints.sdkNetworkId !== network) throw new Error('Midnight endpoint network mismatch');
  const chain = await resolveMidnightChain(network);
  if (chain.ledger !== 9) {
    throw new Error(`Midnight ${midnightNetworkName(network)} runs ledger ${chain.ledger}; this is a ledger 9 shielded transfer`);
  }
  // The ledger 9 shielded wallet alone cannot read the ledger 8 history of a
  // chain that crossed the upgrade, so it would miss notes from before it.
  // That needs wallet SDK 2's fork-aware shielded wallet (#1452 M9).
  if (!chain.bornOnLedger9) {
    throw new Error(`Private sends on Midnight ${midnightNetworkName(network)} need its history from before the ledger 9 upgrade, which this version can't read yet`);
  }
  if (!args.dustSecretSeed || args.dustSecretSeed.length !== 32) throw new Error('Shielded transfers require a DUST fee key');
  if (!args.outputs.length) throw new Error('At least one shielded output is required');
  const outputs = args.outputs.map(output => {
    if (output.amount <= 0n) throw new Error('Shielded transfer amount must be positive');
    return {
      amount: output.amount,
      type: validateShieldedTokenType(output.tokenType),
      receiverAddress: decodeShieldedAddress9(network, output.receiverAddress),
    };
  });
  const ttl = args.ttl ?? new Date(Date.now() + 30 * 60_000);
  if (!Number.isFinite(ttl.getTime()) || ttl.getTime() <= Date.now()) throw new Error('Shielded transfer expiry must be in the future');
  const identity = await readVerifiedMidnightChainIdentity(args.endpoints);
  const stateNetwork = midnightCheckpointNamespace(identity);
  const keys = ledger.ZswapSecretKeys.fromSeed(args.zswapSecretKeySeed);
  let wallet: Ledger9ShieldedWallet | undefined;
  let subscription: { unsubscribe(): void } | undefined;
  try {
    const history = new InMemoryTransactionHistoryStorage(TransactionHistoryStorage.TransactionHistoryEntryCommonSchema);
    const builder = ledger9ShieldedWallet(network, args.endpoints, history);
    const saved = await loadWalletState(stateNetwork, 'shielded', args.zswapSecretKeySeed);
    if (saved) {
      try { wallet = builder.restore(saved); } catch {
        await clearWalletState(stateNetwork, 'shielded', args.zswapSecretKeySeed);
      }
    }
    wallet ??= builder.startWithSecretKeys(keys);
    await bounded(wallet.start({ v9: keys }), 30_000, 'shielded wallet startup');
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
    const transfer = unprovenTransactionFromHandle(
      await bounded(wallet.transferTransaction(outputs), 60_000, 'shielded transaction construction'));
    ledger.Transaction.fromParts(network).merge(transfer);
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
        sdkNetworkId: network, signedTxHex: txHex, proving: args.proving,
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
