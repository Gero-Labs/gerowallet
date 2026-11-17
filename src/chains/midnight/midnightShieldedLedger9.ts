import * as ledger from '@midnightntwrk/ledger-v9';
import type { ShieldedWalletState } from 'midnight-v9-shielded';
import { InMemoryTransactionHistoryStorage, TransactionHistoryStorage } from 'midnight-v9-abstractions';
import {
  assertLedger9Handle, forkingShieldedWallet, ledger9ShieldedWallet, shieldedKeysByEpoch, unprovenTransactionFromHandle,
  type ForkingShieldedWallet, type Ledger9ShieldedWallet,
} from './midnightShieldedWallet9';
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
  // A chain that crossed the upgrade (mainnet, preprod) keeps notes from
  // before it: only wallet SDK 2's fork-aware wallet reads that ledger 8
  // history (#1452 M9). A chain born on ledger 9 needs the ledger 9 side only.
  const forking = !chain.bornOnLedger9;
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
  let keys8: { clear(): void } | undefined;
  let wallet: Ledger9ShieldedWallet | ForkingShieldedWallet | undefined;
  let subscription: { unsubscribe(): void } | undefined;
  try {
    const history = new InMemoryTransactionHistoryStorage(TransactionHistoryStorage.TransactionHistoryEntryCommonSchema);
    const saved = await loadWalletState(stateNetwork, 'shielded', args.zswapSecretKeySeed);
    let start: { v9: ledger.ZswapSecretKeys; v8?: unknown } = { v9: keys };
    if (forking) {
      const both = await shieldedKeysByEpoch(args.zswapSecretKeySeed);
      both.v9.clear();
      keys8 = both.v8;
      start = { v8: both.v8, v9: keys };
      const builder = forkingShieldedWallet(network, args.endpoints, history);
      if (saved) {
        try { wallet = builder.restore(saved); } catch {
          await clearWalletState(stateNetwork, 'shielded', args.zswapSecretKeySeed);
        }
      }
      wallet ??= await bounded(builder.startWithKeys(start as Parameters<typeof builder.startWithKeys>[0]), 30_000, 'shielded wallet startup');
    } else {
      const builder = ledger9ShieldedWallet(network, args.endpoints, history);
      if (saved) {
        try { wallet = builder.restore(saved); } catch {
          await clearWalletState(stateNetwork, 'shielded', args.zswapSecretKeySeed);
        }
      }
      wallet ??= builder.startWithSecretKeys(keys);
    }
    // Both wallet kinds take { v9 } (the fork-aware one also { v8 }); called as a method, `this` intact.
    await bounded((wallet as unknown as { start(keys: typeof start): Promise<void> }).start(start), 30_000, 'shielded wallet startup');
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
    type Handle = { readonly protocolVersion: bigint; serialize(): Uint8Array };
    const handle = await bounded<Handle>((wallet as unknown as { transferTransaction(o: typeof outputs): Promise<Handle> })
      .transferTransaction(outputs), 60_000, 'shielded transaction construction');
    // A fork-aware wallet still on the ledger 8 side would build for a ledger the chain left.
    // (The ledger 9-only wallet stamps every handle with the SDK's minimum version.)
    if (forking) assertLedger9Handle(handle);
    const transfer = unprovenTransactionFromHandle(handle);
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
    finally { keys.clear(); keys8?.clear(); }
  }
}
