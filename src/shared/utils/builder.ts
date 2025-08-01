import {
  Address,
  AssetName,
  Assets,
  BigNum,
  Certificate,
  Certificates,
  CoinSelectionStrategyCIP2,
  ExUnitPrices,
  LinearFee,
  MultiAsset,
  RewardAddress,
  ScriptHash,
  Credential, TransactionBody,
  TransactionBuilder,
  TransactionBuilderConfigBuilder,
  TransactionOutputs,
  TransactionUnspentOutputs,
  UnitInterval,
  Value, Withdrawals,
} from '@emurgo/cardano-serialization-lib-browser';
import { AssetWithQuantity } from '@/shared/models/asset-quantity';
import { DEFAULT_TTL, Withdrawal } from '@/models/types';
import { Cardano } from '@cardano-sdk/core';

export const buildRewardAddress = (networkId, stakeKeyHash) => {
  return RewardAddress.new(networkId, Credential.from_keyhash(stakeKeyHash));
};

export function getTransactionBuilder(pp: Cardano.ProtocolParameters): TransactionBuilder {
  return TransactionBuilder.new(TransactionBuilderConfigBuilder.new()
    .fee_algo(LinearFee.new(BigNum.from_str(pp.minFeeCoefficient.toString()), BigNum.from_str(pp.minFeeConstant.toString())))
    .pool_deposit(BigNum.from_str(pp.poolDeposit.toString()))
    .key_deposit(BigNum.from_str(pp.stakeKeyDeposit.toString()))
    .max_value_size(pp.maxValueSize)
    .max_tx_size(pp.maxTxSize)
    .coins_per_utxo_byte(BigNum.from_str(pp.coinsPerUtxoByte.toString()))
    .ex_unit_prices(ExUnitPrices.new(UnitInterval.new(BigNum.from_str((pp.prices.memory*10000).toString()), BigNum.from_str('10000')), UnitInterval.new(BigNum.from_str((pp.prices.steps*10000000).toString()), BigNum.from_str('10000000'))))
    .ref_script_coins_per_byte(UnitInterval.new(BigNum.from_str(pp.minFeeRefScriptCostPerByte.toString()), BigNum.from_str('1')))
    .prefer_pure_change(true)
    .build());
}

export function buildTx(protocolParams: Cardano.ProtocolParameters, outputs: TransactionOutputs, utxos: TransactionUnspentOutputs, currentSlot: number, changeAddress: string, certificates: Certificate[] = [], withdrawals: Withdrawal[] = [], metadata = undefined): TransactionBody {
  if (!changeAddress) {
    console.log('Change Address', changeAddress)
    return null;
  }
  const txBuilder = getTransactionBuilder(protocolParams);

  const hasMetadata = !(metadata == null || metadata === undefined);

  // Add Certificates
  if (certificates.length > 0) {
    const certsArray = certificates.reduce((certs, cert) => {
      certs.add(cert);
      return certs;
    }, Certificates.new());
    txBuilder.set_certs(certsArray);
  }

  // Add Withdrawals
  if (withdrawals.length > 0) {
    const processed = withdrawals.map((withdrawal) => {
      const address = Address.from_bech32(withdrawal.address);
      return {
        address: RewardAddress.from_address(address),
        amount: BigNum.from_str(withdrawal.amount),
      };
    });

    const withdrawalArray = processed.reduce((withs, withdrawal) => {
      withs.insert(withdrawal.address, withdrawal.amount);
      return withs;
    }, Withdrawals.new());
    txBuilder.set_withdrawals(withdrawalArray);
  }

  // add metadata
  if (hasMetadata) {
    // txBuilder.set_auxiliary_data(metadata);
    //   console.log('hasMetadata')
    //   txBuilder.add_json_metadatum(BigNum.from_str("721"), JSON.stringify(metadata));
  }

  // set ttl
  const ttlValue = currentSlot + DEFAULT_TTL;
  txBuilder.set_ttl_bignum(BigNum.from_str(ttlValue.toString()));

  // add outputs
  if (outputs) {
    for (let i = 0 ; i< outputs.len() ; i++) {
      txBuilder.add_output(outputs.get(i));
    }
  }

  txBuilder.set_validity_start_interval(0)

  const hasDeregistrationCert = !!certificates.find(certificate => certificate.kind() == 1)
  console.log(hasDeregistrationCert) // TODO Fix
  // add utxos to the transaction as inputs
  // const shouldUseAllUtxos = hasDeregistrationCert || withdrawals.length > 0; // length > 0 || withdrawals.length > 0;
  try {
    addInputUtxos(txBuilder, utxos, outputs, false);
    const calcChangeAddress = Address.from_bech32(changeAddress);
    txBuilder.add_change_if_needed(calcChangeAddress);
  } catch (e: unknown) {
    console.log(e)
    const error = e as string;
    if (isNotEnoughBalanceError(error)) {
      addInputUtxos(txBuilder, utxos, outputs, true);
      const calcChangeAddress = Address.from_bech32(changeAddress);
      txBuilder.add_change_if_needed(calcChangeAddress);
    }
  }
  // tx build
  return txBuilder.build()
}

function isNotEnoughBalanceError(error: string) {
  const balanceErrors = [
    'not enough ada',
    'insufficient input',
    'utxo balance insufficient',
  ];
  return balanceErrors.some(balanceError => error.toLowerCase().includes(balanceError));
}

function addInputUtxos(
    txBuilder: TransactionBuilder,
    utxos: TransactionUnspentOutputs,
    outputs: TransactionOutputs,
    useAllUtxos = false
) {
  if (!useAllUtxos) {
    const strategy = outputHasAssets(outputs) ? CoinSelectionStrategyCIP2.RandomImproveMultiAsset : CoinSelectionStrategyCIP2.LargestFirst;
    txBuilder.add_inputs_from(utxos, strategy);
  } else {
    for (let i = 0 ; i < utxos.len() ; i++) {
      const utxo = utxos.get(i)
      txBuilder.add_regular_input(utxo.output().address(), utxo.input(), utxo.output().amount());
    }
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

export function cardanoValueFromRemoteFormat(utxo: Cardano.Utxo) {
  const cardanoValue: Value = Value.new(BigNum.from_str(utxo[1].value.coins.toString()));
  if (!utxo[1].value.assets || utxo[1].value.assets.size === 0) {
    return cardanoValue;
  }
  const assets: MultiAsset = MultiAsset.new();
  Object.entries(utxo[1].value.assets).forEach((entry: [Cardano.AssetId, string]) => {
    const policyId: ScriptHash = ScriptHash.from_hex(Cardano.AssetId.getPolicyId(entry[0]));
    const assetName: AssetName = AssetName.new(Buffer.from(Cardano.AssetId.getAssetName(entry[0]) || '', 'hex'));
    const quantity: BigNum = BigNum.from_str(entry[1]);
    const policyContent: Assets = assets.get(policyId) ?? Assets.new();
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

