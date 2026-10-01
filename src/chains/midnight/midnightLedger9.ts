/** The Stagenet rc.3 stack is isolated from Mainnet/Preprod's ledger 8 SDK. */
import * as ledger from '@midnightntwrk/ledger-v9';
import { createKeystore } from 'midnight-v9-unshielded-wallet';
import type { BalanceAndSignUnshieldedTransferArgs, SyncDustAndBalanceFeesArgs } from './midnightTxBuilder';
import { midnightLedgerVersion, strictMidnightHex } from './midnightLedger';
import { readVerifiedMidnightChainIdentity, assertMidnightChainIdentityUnchanged } from './midnightChainIdentity';
import { reconstructDustState } from './midnightDustLightSync';
import { createDustLightTransport } from './midnightDustLightTransport';
import { dustLedger9, balanceLightDust9 } from './midnightDustLightLedger9';

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
  const dustKey = ledger.DustSecretKey.fromSeed(args.dustSecretSeed);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const identity = await readVerifiedMidnightChainIdentity(args.endpoints, controller.signal);
    const { state, block } = await reconstructDustState(dustLedger9, dustKey, 'stagenet',
      createDustLightTransport(args.endpoints, controller.signal), args.onDustSyncProgress);
    controller.signal.throwIfAborted();
    const fee = balanceLightDust9(state, dustKey, transactions, args.ttl, new Date(block.timestamp), block.ledgerParameters);
    await assertMidnightChainIdentityUnchanged(args.endpoints, identity, controller.signal);
    return fee;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('DUST synchronization timed out. Please try again shortly.');
    throw error;
  } finally {
    clearTimeout(timeout);
    controller.abort();
    dustKey.clear();
  }
}
