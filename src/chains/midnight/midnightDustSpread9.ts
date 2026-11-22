// Pay a ledger 9 fee with the FEWEST DUST spends the ledger's validation-time
// limit accepts, inside the wallet's own intent.
//
// Ledger 9 refuses a transaction whose modelled validation time ("time to
// dismiss") is over max(15 ms, about 2 microseconds per byte). Every signed
// coin input costs about 3.5 ms and every DUST spend about 2.3 ms, while a
// DUST spend's proof adds about 3 KB (6 ms of allowance). So the count that
// fits is not monotonic: a swap with one input on each side fits with one
// spend, is refused with two, and fits again from three; a swap with three
// signed inputs needs four (measured under mainnet and Preview parameters,
// midnightDustSpread9.spec.ts). The ledger's own `cost(parameters, true)` is
// asked for every count, on the merged shape with mock proofs.
//
// PRIVACY: never log transaction bytes, proofs or keys.

import * as ledger from '@midnightntwrk/ledger-v9';
import { CoreWallet, CoinsAndBalances, Keys, Transacting } from 'midnight-v9-dust-wallet/v2';
import { MIDNIGHT_DUST_COINS_SHORT } from './midnightConnectorIntent';
import { dustHexBytes } from './midnightDustLightSync';

/** A proven, signed and bound ledger 9 transaction (another party's part of a swap). */
export type SealedTransaction9 = ledger.Transaction<ledger.SignatureEnabled, ledger.Proof, ledger.Binding>;

/**
 * No count of DUST spends the wallet can make both covers the fee and fits the
 * limit. Thrown before anything is signed; the message is the code
 * `midnight-tx.service` says in the user's language.
 */
export class DustSpreadError extends Error {
  constructor(readonly coinsWithDust: number, readonly spendsTried: number) {
    super(MIDNIGHT_DUST_COINS_SHORT);
    this.name = 'DustSpreadError';
  }
}

/** Never more spends than this: each is a proof the wallet makes (about 8 s on this device). */
export const DUST_SPREAD_MAXIMUM_SPENDS = 8;

export interface DustSpread9Options {
  /** Cap on the number of spends tried (default {@link DUST_SPREAD_MAXIMUM_SPENDS}). */
  maximumSpends?: number;
}

/** The SDK prices a candidate set of DUST inputs with this (on its capability implementation). */
type DryRunFee = (inputs: ReadonlyArray<{ token: ledger.QualifiedDustOutput; value: bigint }>,
  transactions: readonly unknown[], key: ledger.DustSecretKey, wallet: ReturnType<typeof CoreWallet.init>,
  ttl: Date, time: Date, parameters: ledger.LedgerParameters) => bigint;

/** `need` split over `coins`: every coin spends at least one unit, the first as much as it can, then the next. */
function splitFee(need: bigint, coins: ReadonlyArray<{ value: bigint }>): bigint[] | undefined {
  const values = coins.map(() => 1n);
  let rest = need - BigInt(coins.length);
  for (let i = 0; i < coins.length && rest > 0n; i++) {
    const add = coins[i].value - 1n < rest ? coins[i].value - 1n : rest;
    values[i] += add;
    rest -= add;
  }
  return rest > 0n ? undefined : values;
}

/**
 * `carrier` (the wallet's own unproven transaction of exactly one intent, or a
 * new empty intent when there is none) with DUST spends added to that intent:
 * they pay the fee of `fixed` plus the carrier, with the fewest spends for
 * which the merged transaction passes the ledger's validation-time limit.
 *
 * The fee is priced with the SDK's `dryRunFee`, which prices the spends in an
 * intent of their own: never less than the same spends inside the carrier.
 *
 * @throws DustSpreadError when no count the wallet can make fits.
 */
export function spreadLightDust9(state: ledger.DustLocalState, key: ledger.DustSecretKey, network: string,
  fixed: readonly SealedTransaction9[], carrier: ledger.UnprovenTransaction | undefined,
  ttl: Date, timestamp: Date, parameters: string, options: DustSpread9Options = {}): ledger.UnprovenTransaction {
  const params = ledger.LedgerParameters.deserialize(dustHexBytes(parameters));
  const keysCapability = Keys.makeDefaultKeysCapability();
  const coinsAndBalancesCapability = CoinsAndBalances.makeDefaultCoinsAndBalancesCapability({}, () => ({ keysCapability }));
  const context = { keysCapability, coinSelection: CoinsAndBalances.chooseCoin, coinsAndBalancesCapability };
  const capability = Transacting.makeDefaultTransactingCapability({ networkId: network, costParameters: { feeBlocksMargin: 1 } }, () => context);
  const dryRunFee = (capability as { dryRunFee?: DryRunFee }).dryRunFee?.bind(capability);
  if (!dryRunFee) throw new Error('The DUST wallet cannot price a fee for a chosen set of coins');
  const wallet = CoreWallet.init(state, key, network);
  // Largest first: the first coin pays, the others spend one unit each.
  const coins = coinsAndBalancesCapability.getAvailableCoinsWithGeneratedDust(wallet, timestamp).filter(coin => coin.value > 0n)
    .toSorted((a, b) => (a.value > b.value ? -1 : a.value < b.value ? 1 : 0));

  const taken = new Set(fixed.flatMap(tx => [...(tx.intents?.keys() ?? [])]));
  let free = 1;
  while (taken.has(free)) free++;
  const carrierBytes = (carrier
    ?? ledger.Transaction.fromParts(network).addIntent({ tag: 'specific', value: free }, ledger.Intent.new(ttl))).serialize();
  /** A fresh copy for every trial: adding DUST actions mutates the intent. */
  const blank = (): ledger.UnprovenTransaction => ledger.Transaction.deserialize('signature', 'pre-proof', 'pre-binding', carrierBytes);
  if ((blank().intents?.size ?? 0) !== 1) throw new Error('The fee carrier must hold exactly one intent');

  const limit = Math.min(coins.length, options.maximumSpends ?? DUST_SPREAD_MAXIMUM_SPENDS);
  for (let count = 1; count <= limit; count++) {
    const set = coins.slice(0, count);
    const price = (values: bigint[]) => dryRunFee(set.map((coin, i) => ({ token: coin.token, value: values[i] })),
      [...fixed, blank()], key, wallet, ttl, timestamp, params);
    // The fee follows the size, which the spend values move a little (their
    // encoding): settle at a fixed point, never paying less than priced.
    let need = price(set.map(() => 1n));
    let values: bigint[] | undefined;
    for (let round = 0; round < 8; round++) {
      values = splitFee(need, set);
      if (!values) break;
      const priced = price(values);
      if (priced <= need) break;
      need = priced;
      if (round === 7) values = undefined;
    }
    if (!values) continue;
    const paid = values;
    const [spends] = CoreWallet.spendCoins(wallet, key, set.map((coin, i) => ({ token: coin.token, value: paid[i] })), timestamp);
    const tx = blank();
    const [segment, intent] = [...tx.intents!][0];
    intent.dustActions = new ledger.DustActions('signature', 'pre-proof', timestamp, [...spends], []);
    tx.intents = tx.intents!.set(segment, intent);
    const mock: SealedTransaction9 = ledger.Transaction.deserialize('signature', 'proof', 'binding', tx.mockProve().serialize());
    try {
      [...fixed, mock].reduce((sum, part) => sum.merge(part)).cost(params, true);
      return tx;
    } catch {
      // Over the limit with this many spends (or the parts do not merge): one more.
    }
  }
  throw new DustSpreadError(coins.length, limit);
}
