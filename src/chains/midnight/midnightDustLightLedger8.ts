import * as ledger from '@midnight-ntwrk/ledger-v8';
import { DustAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { CoreWallet, CoinsAndBalances, Keys, Transacting } from '@midnightntwrk/wallet-sdk-dust-wallet/v1';
import { dustHexBytes, type DustLightLedger, type DustSpendEvent } from './midnightDustLightSync';
import type { DustBalanceableTransaction } from './midnightTxBuilder';

export const dustLedger8: DustLightLedger<ledger.DustLocalState, ledger.DustSecretKey> = {
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
  successor: (coin, generation, spend, parameters, key) => new ledger.DustLocalState(ledger.LedgerParameters.deserialize(dustHexBytes(parameters)).dust)
    .insertGenerationInfo(0n, generation, generation.nonce)
    .successorUtxo(coin, spend.declaredTime, spend.vFee, spend.commitmentIndex, key),
  roots: state => [state.generatingTreeRoot(), state.commitmentTreeRoot()],
};

/** Use the SDK's canonical fee algorithm against already verified state. No event subscription. */
export function balanceLightDust8(state: ledger.DustLocalState, key: ledger.DustSecretKey, network: string,
  transactions: readonly DustBalanceableTransaction[], ttl: Date, timestamp: Date, parameters: string): ledger.UnprovenTransaction {
  const keysCapability = Keys.makeDefaultKeysCapability();
  const context = { keysCapability, coinSelection: CoinsAndBalances.chooseCoin,
    coinsAndBalancesCapability: CoinsAndBalances.makeDefaultCoinsAndBalancesCapability({}, () => ({ keysCapability })) };
  const capability = Transacting.makeDefaultTransactingCapability({ networkId: network, costParameters: { feeBlocksMargin: 1 } }, () => context);
  const result = capability.balanceTransactions(key, CoreWallet.init(state, key, network), transactions, ttl, timestamp,
    ledger.LedgerParameters.deserialize(dustHexBytes(parameters)));
  if (result._tag === 'Left') throw result.left;
  return result.right[0];
}
