import * as ledger from '@midnightntwrk/ledger-v9';
import { DustAddress } from 'midnight-v9-address-format';
import { CoreWallet, CoinsAndBalances, Keys, Transacting } from 'midnight-v9-dust-wallet/v1';
import { dustHexBytes, type DustLightLedger, type DustSpendEvent } from './midnightDustLightSync';

export const dustLedger9: DustLightLedger<ledger.DustLocalState, ledger.DustSecretKey> = {
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

export function balanceLightDust9(state: ledger.DustLocalState, key: ledger.DustSecretKey,
  transactions: readonly ledger.UnprovenTransaction[], ttl: Date, timestamp: Date, parameters: string): ledger.UnprovenTransaction {
  const keysCapability = Keys.makeDefaultKeysCapability();
  const context = { keysCapability, coinSelection: CoinsAndBalances.chooseCoin,
    coinsAndBalancesCapability: CoinsAndBalances.makeDefaultCoinsAndBalancesCapability({}, () => ({ keysCapability })) };
  const capability = Transacting.makeDefaultTransactingCapability({ networkId: 'stagenet', costParameters: { feeBlocksMargin: 1 } }, () => context);
  const result = capability.balanceTransactions(key, CoreWallet.init(state, key, 'stagenet'), transactions, ttl, timestamp,
    ledger.LedgerParameters.deserialize(dustHexBytes(parameters)));
  if (result._tag === 'Left') throw result.left;
  return result.right[0];
}
