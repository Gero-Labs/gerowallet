import {
  Address,
  AssetName,
  Assets,
  BigNum,
  Certificate,
  Certificates,
  CoinSelectionStrategyCIP2,
  DataCost,
  ExUnitPrices,
  hash_transaction,
  LinearFee,
  min_ada_for_output,
  MultiAsset,
  RewardAddress,
  ScriptHash,
  StakeCredential, Transaction,
  TransactionBody,
  TransactionBuilder,
  TransactionBuilderConfigBuilder, TransactionHash, TransactionInput,
  TransactionOutput,
  TransactionUnspentOutput,
  TransactionUnspentOutputs, TransactionWitnessSet,
  UnitInterval,
  Value,
  Withdrawals,
} from '@emurgo/cardano-serialization-lib-browser';
import networks from '@/shared/utils/networks';
import { DEFAULT_TTL, ERROR, TransactionToken, TX, TxOutput, Withdrawal } from '@/models/types';
import { normalizeToAddress } from '@/shared/utils/converter';
import { AssetWithQuantity } from '@/shared/models/asset-quantity';
import { TransactionOutputs } from '@emurgo/cardano-serialization-lib-browser/cardano_serialization_lib';
import CoinSelection from '@/shared/utils/coinSelection';
import coinSelection from '@/shared/utils/coinSelection';

export const buildRewardAddress = (networkId, stakeKeyHash) => {
  return RewardAddress.new(networkId, StakeCredential.from_keyhash(stakeKeyHash));
};

export function getTransactionBuilder(chain: string, network: string): TransactionBuilder {
  const pp = networks.resolveNetwork(chain, network).protocolParams;

  return TransactionBuilder.new(TransactionBuilderConfigBuilder.new()
    .fee_algo(
      LinearFee.new(
        BigNum.from_str(pp.min_fee_a.toString()),
        BigNum.from_str(pp.min_fee_b.toString()),
      ),
    )
    .pool_deposit(BigNum.from_str(pp.pool_deposit))
    .key_deposit(BigNum.from_str(pp.key_deposit))
    .max_value_size(pp.max_val_size)
    .max_tx_size(pp.max_tx_size)
    .coins_per_utxo_byte(BigNum.from_str(pp.coins_per_utxo_size))
    .ex_unit_prices(
      ExUnitPrices.new(
        UnitInterval.new(
          BigNum.from_str('577'),
          BigNum.from_str('10000'),
        ),
        UnitInterval.new(
          BigNum.from_str('721'),
          BigNum.from_str('10000000'),
        ),
      ),
    )
    .prefer_pure_change(true)
    .build());
}

export function buildTx(senderWallet, outputs: TransactionOutputs, utxos: TransactionUnspentOutput[], currentSlot: number, changeAddress: string) {
    const protocolParameters = networks.resolveNetwork(senderWallet.chain, senderWallet.network).protocolParams;
    coinSelection.setProtocolParameters(protocolParameters.min_utxo_value, protocolParameters.min_fee_a, protocolParameters.min_fee_b, protocolParameters.max_tx_size, protocolParameters.coins_per_utxo_size)
    const txBuilder = getTransactionBuilder(senderWallet.chain, senderWallet.network);
    const totalAssets = multiAssetCount(outputs.get(0).amount().multiasset());
    const selection = CoinSelection.randomImprove(utxos, outputs, 20 + totalAssets);
    const inputs: TransactionUnspentOutput[] = selection.input;

    for (let i = 0; i < inputs.length; i++) {
      const utxo = inputs[i];
      txBuilder.add_input(
        utxo.output().address(),
        utxo.input(),
        utxo.output().amount()
      );
    }

  for (let i = 0; i < selection.output.len(); i++) {
    const utxo = selection.output.get(i);
    txBuilder.add_output(utxo);
  }

    // console.log('output', outputs.get(0).to_json())
    // txBuilder.add_output(outputs.get(0));

    const change = selection.change;
    const changeMultiAssets = change.multiasset();
    console.log(change.to_json())
    // check if change value is too big for single output
    if (changeMultiAssets && change.to_bytes().length * 2 > protocolParameters.max_val_size) {
      const partialChange = Value.new(BigNum.from_str('0'));

      const partialMultiAssets = MultiAsset.new();
      const policies = changeMultiAssets.keys();
      const makeSplit = () => {
        for (let j = 0; j < changeMultiAssets.len(); j++) {
          const policy = policies.get(j);
          const policyAssets = changeMultiAssets.get(policy);
          const assetNames = policyAssets.keys();
          const assets = Assets.new();
          for (let k = 0; k < assetNames.len(); k++) {
            const policyAsset = assetNames.get(k);
            const quantity = policyAssets.get(policyAsset);
            assets.insert(policyAsset, quantity);
            //check size
            const checkMultiAssets = MultiAsset.from_bytes(partialMultiAssets.to_bytes());
            checkMultiAssets.insert(policy, assets);
            const checkValue = Value.new(BigNum.from_str('0'));
            checkValue.set_multiasset(checkMultiAssets);
            if (checkValue.to_bytes().length * 2 >= protocolParameters.max_val_size) {
              partialMultiAssets.insert(policy, assets);
              return;
            }
          }
          partialMultiAssets.insert(policy, assets);
        }
      };
      makeSplit();
      partialChange.set_multiasset(partialMultiAssets);
      const minAda = min_ada_for_output(
        TransactionOutput.new(Address.from_bech32(changeAddress), partialChange),
        DataCost.new_coins_per_byte(BigNum.from_str(protocolParameters.coins_per_utxo_size))
      );

      partialChange.set_coin(minAda);

      txBuilder.add_output(TransactionOutput.new(Address.from_bech32(changeAddress), partialChange));
    }

    txBuilder.set_ttl(currentSlot + TX.invalid_hereafter);
    txBuilder.add_change_if_needed(Address.from_bech32(changeAddress));

    const transaction = Transaction.new(
      txBuilder.build(),
      TransactionWitnessSet.new()
    );

    const size = transaction.to_bytes().length * 2;
    if (size > protocolParameters.max_tx_size) throw ERROR.txTooBig;

    return transaction;
}

export const multiAssetCount = (multiAsset) => {
  if (!multiAsset) return 0;
  let count = 0;
  const policies = multiAsset.keys();
  for (let j = 0; j < multiAsset.len(); j++) {
    const policy = policies.get(j);
    const policyAssets = multiAsset.get(policy);
    const assetNames = policyAssets.keys();
    for (let k = 0; k < assetNames.len(); k++) {
      count++;
    }
  }
  return count;
};

export function cardanoValueFromRemoteFormat(utxo) {
  const cardanoValue = Value.new(BigNum.from_str(utxo.value));
  if (!utxo.asset_list || utxo.asset_list.length === 0) {
    return cardanoValue;
  }
  const assets = MultiAsset.new();
  utxo.asset_list.forEach(asset => {
    const policyId = ScriptHash.from_bytes(Buffer.from(asset.policy_id, 'hex'));
    const assetName = AssetName.new(Buffer.from(asset.asset_name || '', 'hex'));
    const quantity = BigNum.from_str(asset.quantity);
    const policyContent = assets.get(policyId) ?? Assets.new();
    policyContent.insert(assetName, quantity);
    assets.insert(policyId, policyContent);
  });
  if (assets.len() > 0) {
    cardanoValue.set_multiasset(assets);
  }
  return cardanoValue;
}

export function getAssetsFromMultiAsset(multiAsset) {
  if (!multiAsset) return [];
  const result = [];
  const hashes = multiAsset.keys();
  for (let i = 0; i < hashes.len(); i++) {
    const policyId = hashes.get(i);
    const assetsForPolicy = multiAsset.get(policyId);
    if (assetsForPolicy == null) continue;
    const policies = assetsForPolicy.keys();
    for (let j = 0; j < policies.len(); j++) {
      const assetName = policies.get(j);
      const amount = assetsForPolicy.get(assetName);
      if (amount == null) continue;
      const parsedQuantity = amount.to_str();
      const parsedName = Buffer.from(assetName.name()).toString('hex');
      const parsedPolicyId = Buffer.from(policyId.to_bytes()).toString('hex');
      const parsedAssetId = `${parsedPolicyId}${parsedName}`;
      result.push(new AssetWithQuantity(parsedName, parsedQuantity, parsedAssetId, parsedPolicyId));
    }
  }
  return result;
}

export function diffAssetsFromIncomingToOutgoing(inputAssets, outputAssets) {
  console.log('test')
  if (!inputAssets || !outputAssets) {
    return null;
  }
  const allAssets = new Set([
    ...inputAssets.map(input => input.asset.name),
    ...outputAssets.map(output => output.asset.name),
  ]);
  return Array.from(allAssets)
    .map(assetName => {
      const inValue = inputAssets.find(input => input.asset.name === assetName);
      const outValue = outputAssets.find(output => output.asset.name === assetName);
      const difference = BigInt(inValue ? inValue.quantity : '') - BigInt(outValue ? outValue.quantity : '');
      if (assetName === 'cardano') {
        return { assetName, quantity: difference, id: 'cardano' };
      }
      const policy = assetName.slice(0, 56);
      return {
        assetName,
        quantity: difference,
        policy,
        id: inValue ? inValue.asset.id : outValue?.asset.id,
      };
    }).filter(asset => asset.quantity !== BigInt(0));
}

export function getPayAndReceiveTokens(diff) {
  const payTokens = [];
  const receiveTokens = [];
  for (let i = 0; i < diff.length; i++) {
    if (diff[i].quantity > BigInt(0)) {
      payTokens.push({
        name: diff[i].assetName,
        amount: diff[i].quantity.toString(),
        id: diff[i].id,
      });
    } else if (diff[i].quantity < BigInt(0)) {
      receiveTokens.push({
        name: diff[i].assetName,
        amount: (diff[i].quantity * BigInt(-1)).toString(),
        id: diff[i].id,
      });
    }
  }
  return { payTokens, receiveTokens };
}
