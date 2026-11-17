import * as ledger from '@midnightntwrk/ledger-v9';
import { DustAddress } from 'midnight-v9-address-format';
import { CoreWallet, CoinsAndBalances, Keys, Transacting } from 'midnight-v9-dust-wallet/v2';
import { dustHexBytes, type DustLightLedger, type DustSpendEvent } from './midnightDustLightSync';

export const dustLedger9: DustLightLedger<ledger.DustLocalState, ledger.DustSecretKey> = {
  ledger: 9,
  createState: raw => new ledger.DustLocalState(ledger.LedgerParameters.deserialize(dustHexBytes(raw)).dust),
  publicKey: key => key.publicKey,
  address: (key, network) => DustAddress.encodePublicKey(network, key.publicKey),
  insertGeneration: (state, index, generation) => state.insertGenerationInfo(BigInt(index), generation, generation.nonce),
  applyGeneration: (state, raw) => state.applyGenerationCollapsedUpdate(ledger.DustStateMerkleTreeCollapsedUpdate.deserialize(dustHexBytes(raw))),
  applyCommitment: (state, raw) => state.applyCommitmentCollapsedUpdate(ledger.DustStateMerkleTreeCollapsedUpdate.deserialize(dustHexBytes(raw))),
  insertCoin: (state, key, coin) => state.insertCommitment(coin.mtIndex, coin, true).addUtxo(ledger.dustNullifier(coin, key), coin),
  nullifier: ledger.dustNullifier,
  commitment: ledger.dustCommitment,
  decodeSpend: raw => {
    const event = ledger.Event.deserialize(dustHexBytes(raw)).content;
    return event.tag === 'dustSpendProcessed' ? event as DustSpendEvent : null;
  },
  successor: (coin, generation, spend, parameters, key) => ledger.successorDustUtxo(coin, spend.declaredTime, spend.vFee,
    spend.commitmentIndex, generation, key, ledger.LedgerParameters.deserialize(dustHexBytes(parameters)).dust),
  roots: state => [state.generatingTreeRoot(), state.commitmentTreeRoot()],
};

/** What the DUST fee balancer accepts: unproven, or proven and not yet bound (a dApp's). */
export type DustBalanceable9 = ledger.UnprovenTransaction | ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>;

export interface BalanceLightDust9Options {
  /**
   * Pay the fee with at least this many DUST spends when the wallet holds
   * enough coins: 2 for a dApp's contract call. Ledger 9 can reject a contract
   * call whose fee is paid with exactly one DUST spend (`OutsideTimeToDismiss`;
   * midnight-ledger#838); zero or two and more are accepted. With fewer coins,
   * or when spreading the fee cannot cover it, the SDK's own selection stands.
   */
  minimumSpends?: number;
}

function dustSpends(tx: ledger.UnprovenTransaction): ledger.DustSpend<ledger.PreProof>[] {
  return [...(tx.intents?.values() ?? [])].flatMap(intent => intent.dustActions?.spends ?? []);
}

/** The SDK prices a candidate set of DUST inputs with this (on its capability implementation). */
type DryRunFee = (inputs: ReadonlyArray<{ token: ledger.QualifiedDustOutput; value: bigint }>,
  transactions: readonly DustBalanceable9[], key: ledger.DustSecretKey, wallet: ReturnType<typeof CoreWallet.init>,
  ttl: Date, time: Date, parameters: ledger.LedgerParameters) => bigint;

export function balanceLightDust9(state: ledger.DustLocalState, key: ledger.DustSecretKey, network: string,
  transactions: readonly DustBalanceable9[], ttl: Date, timestamp: Date, parameters: string,
  options: BalanceLightDust9Options = {}): ledger.UnprovenTransaction {
  const params = ledger.LedgerParameters.deserialize(dustHexBytes(parameters));
  const keysCapability = Keys.makeDefaultKeysCapability();
  const coinsAndBalancesCapability = CoinsAndBalances.makeDefaultCoinsAndBalancesCapability({}, () => ({ keysCapability }));
  const context = { keysCapability, coinSelection: CoinsAndBalances.chooseCoin, coinsAndBalancesCapability };
  const capability = Transacting.makeDefaultTransactingCapability({ networkId: network, costParameters: { feeBlocksMargin: 1 } }, () => context);
  const wallet = CoreWallet.init(state, key, network);
  const result = capability.balanceTransactions(key, wallet, transactions, ttl, timestamp, params);
  if (result._tag === 'Left') throw result.left;
  const fee = result.right[0];
  const single = dustSpends(fee);
  if ((options.minimumSpends ?? 0) < 2 || single.length !== 1) return fee;
  return withSecondDustSpend(fee, single[0], { capability, coinsAndBalancesCapability, wallet, key, network, transactions, ttl, timestamp, params });
}

/**
 * Re-pay a fee the SDK paid with one DUST spend with two: the SDK's own coin
 * (as much as it can give) and the wallet's next smallest coin (the rest, at
 * least one unit). Priced with the SDK's `dryRunFee` for exactly that set and
 * built as `balanceTransactions` builds it. Keeps the single spend when the
 * wallet has no second coin with DUST, or two coins cannot cover the fee.
 */
function withSecondDustSpend(single: ledger.UnprovenTransaction, spend: ledger.DustSpend<ledger.PreProof>, c: {
  capability: object; coinsAndBalancesCapability: ReturnType<typeof CoinsAndBalances.makeDefaultCoinsAndBalancesCapability>;
  wallet: ReturnType<typeof CoreWallet.init>; key: ledger.DustSecretKey; network: string;
  transactions: readonly DustBalanceable9[]; ttl: Date; timestamp: Date; params: ledger.LedgerParameters;
}): ledger.UnprovenTransaction {
  const dryRunFee = (c.capability as { dryRunFee?: DryRunFee }).dryRunFee?.bind(c.capability);
  if (!dryRunFee) return single;
  const coins = c.coinsAndBalancesCapability.getAvailableCoinsWithGeneratedDust(c.wallet, c.timestamp)
    .filter(coin => coin.value > 0n);
  const first = coins.find(coin => ledger.dustNullifier(coin.token, c.key) === spend.oldNullifier);
  const second = coins.filter(coin => coin !== first)
    .toSorted((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0)).at(0);
  if (!first || !second) return single;
  const price = (v1: bigint, v2: bigint) => dryRunFee([{ token: first.token, value: v1 }, { token: second.token, value: v2 }],
    c.transactions, c.key, c.wallet, c.ttl, c.timestamp, c.params);
  // The dust the transactions already carry: the one-spend total fee less what that spend paid.
  const existing = dryRunFee([{ token: first.token, value: spend.vFee }], c.transactions, c.key, c.wallet, c.ttl, c.timestamp, c.params) - spend.vFee;
  // The fee follows the transaction's size, which the spend values move a
  // little (their encoding): settle the split at a fixed point, never paying
  // less than the fee priced for the values actually spent.
  let need = price(1n, 1n) - existing;
  let fromFirst = 0n;
  let fromSecond = 0n;
  for (let round = 0; round < 8; round++) {
    fromSecond = need - first.value > 1n ? need - first.value : 1n;
    fromFirst = need - fromSecond;
    if (fromSecond > second.value || fromFirst <= 0n || fromFirst > first.value) return single;
    const priced = price(fromFirst, fromSecond) - existing;
    if (priced <= need) break;
    need = priced;
    if (round === 7) return single;
  }
  const [spends] = CoreWallet.spendCoins(c.wallet, c.key,
    [{ token: first.token, value: fromFirst }, { token: second.token, value: fromSecond }], c.timestamp);
  const intent = ledger.Intent.new(c.ttl);
  intent.dustActions = new ledger.DustActions('signature', 'pre-proof', c.timestamp, [...spends], []);
  const merged = c.transactions.map(tx => tx.eraseProofs()).reduce((a, b) => a.merge(b));
  const segment = Transacting.findAvailableSegmentId(merged);
  return ledger.Transaction.fromParts(c.network).addIntent({ tag: 'specific', value: segment._tag === 'Some' ? segment.value : 1 }, intent);
}
