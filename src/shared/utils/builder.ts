import {
  Address,
  AssetName,
  Assets,
  BigNum, CoinSelectionStrategyCIP2,
  DataCost,
  ExUnitPrices,
  LinearFee,
  min_ada_for_output,
  MultiAsset,
  RewardAddress,
  ScriptHash,
  StakeCredential,
  TransactionBuilder,
  TransactionBuilderConfigBuilder, TransactionOutput,
  TransactionUnspentOutput, TransactionUnspentOutputs,
  UnitInterval,
  Value,

} from '@emurgo/cardano-serialization-lib-browser';
import networks from '@/shared/utils/networks';
import { AssetWithQuantity } from '@/shared/models/asset-quantity';
import { TransactionOutputs } from '@emurgo/cardano-serialization-lib-browser/cardano_serialization_lib';
import {DEFAULT_TTL} from "@/models/types";

export const buildRewardAddress = (networkId, stakeKeyHash) => {
  return RewardAddress.new(networkId, StakeCredential.from_keyhash(stakeKeyHash));
};

export function  getTransactionBuilder(chain: string, network: string): TransactionBuilder {
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
  const txBuilder = getTransactionBuilder(senderWallet.chain, senderWallet.network);

  const hasMetadata = false // !(metadata == null || metadata === undefined);

  // add certificates
  // addCertificates(txBuilder, certificates);

  // add withdrawal
  // addWithdrawals(txBuilder, withdrawals);

  // add metadata
  if (hasMetadata) {
    // txBuilder.set_auxiliary_data(metadata);
  }

  // set ttl
  const ttlValue = currentSlot + DEFAULT_TTL;
  txBuilder.set_ttl_bignum(BigNum.from_str(ttlValue.toString()));
  // add outputs
  addOutputs(txBuilder, outputs);

  // add utxos to the transaction as inputs
  const shouldUseAllUtxos = false //TODO certificates.length > 0 || withdrawals.length > 0;
  try {
    addInputUtxos(txBuilder, utxos, outputs, shouldUseAllUtxos);
    const calcChangeAddress = Address.from_bech32(changeAddress);
    txBuilder.add_change_if_needed(calcChangeAddress);
  }
  catch (e: unknown) {
    const error = e as string;
    if (isNotEnoughBalanceError(error) && !shouldUseAllUtxos) {
      addInputUtxos(txBuilder, utxos, outputs, true);
      const calcChangeAddress = Address.from_bech32(changeAddress);
      txBuilder.add_change_if_needed(calcChangeAddress);
    }
  }
  // tx build
  return txBuilder.build_tx()
}

function isNotEnoughBalanceError(error: string) {
  const balanceErrors = [
    'not enough ada',
    'insufficient input',
    'utxo balance insufficient',
  ];
  return balanceErrors.some(balanceError => error.toLowerCase().includes(balanceError));
}

function addOutputs(txBuilder: TransactionBuilder, outputs: TransactionOutputs): number {
  let minAdaRequired = 0;
  for (let i = 0 ; i< outputs.len() ; i++) {
    minAdaRequired += Number(min_ada_for_output(outputs.get(i), DataCost.new_coins_per_word(BigNum.from_str('34482'))).to_str());
    txBuilder.add_output(outputs.get(i));
  }
  return minAdaRequired;
}

function addInputUtxos(
    txBuilder: TransactionBuilder,
    utxos: TransactionUnspentOutput[],
    outputs: TransactionOutputs,
    useAllUtxos = false
) {
  const utxosCIP  = TransactionUnspentOutputs.new();
  utxos.forEach(utxo => {
    utxosCIP.add(utxo);
  })
  if (!useAllUtxos) {
    const strategy = outputHasAssets(outputs) ? CoinSelectionStrategyCIP2.RandomImproveMultiAsset : CoinSelectionStrategyCIP2.RandomImprove;
    txBuilder.add_inputs_from(utxosCIP, strategy);
  } else {
    utxos.forEach(utxo => {
      txBuilder.add_input(utxo.output().address(), utxo.input(), utxo.output().amount());
    });
  }
}

function outputHasAssets(outputs: TransactionOutputs) {
  if (outputs?.len() > 0) {
    for (let i = 0 ; i< outputs.len() ; i++) {
      if (outputs.get(i).amount().multiasset()?.len() > 0) {
        return true
      }
    }
  }
  return false;
}

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
