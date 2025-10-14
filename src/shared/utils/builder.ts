import {
  Address,
  BigNum,
  Certificate,
  Certificates,
  CoinSelectionStrategyCIP2,
  ExUnitPrices,
  LinearFee,
  RewardAddress,
  TransactionBody,
  TransactionBuilder,
  TransactionBuilderConfigBuilder,
  TransactionOutputs,
  TransactionUnspentOutputs,
  UnitInterval,
  Withdrawals,
} from '@emurgo/cardano-serialization-lib-browser';
import { AssetWithQuantity } from '@/shared/models/asset-quantity';
import { DEFAULT_TTL, Withdrawal } from '@/models/types';
import { Cardano } from '@cardano-sdk/core';
import {
  InputSelector,
  ChangeAddressResolver,
  SelectionSkeleton,
  roundRobinRandomImprove,
  ImplicitValue,
  ProtocolParametersForInputSelection,
  EstimateTxCosts
} from '@cardano-sdk/input-selection';
import {
  computeMinimumCoinQuantity,
  tokenBundleSizeExceedsLimit,
  computeSelectionLimit
} from '@cardano-sdk/tx-construction';
import type { BuildTx } from '@cardano-sdk/tx-construction';
import { BrowserTxConstruction } from '@/chrome/cardanoJsSdkCbor';

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

  // add utxos to the transaction as inputs
  // const shouldUseAllUtxos = hasDeregistrationCert || withdrawals.length > 0; // length > 0 || withdrawals.length > 0;
  try {
    addInputUtxos(txBuilder, utxos, outputs, false);
    const calcChangeAddress = Address.from_bech32(changeAddress);
    txBuilder.add_change_if_needed(calcChangeAddress);
  } catch (e: unknown) {
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

export function diffAssetsFromIncomingToOutgoing(inputAssets: Cardano.Value, outputAssets: Cardano.Value) {
  if (!inputAssets || !outputAssets) {
    return null;
  }
  const allAssets: Set<Cardano.AssetId> = new Set([
    ...(inputAssets.assets ? inputAssets.assets.keys() : []),
    ...(outputAssets.assets ? outputAssets.assets.keys() : []),
  ]);
  const assetsArray = Array.from(allAssets)
    .map(assetId => {
      const inValue: bigint = inputAssets.assets ? inputAssets.assets.get(assetId) : 0n;
      const outValue: bigint = outputAssets.assets ? outputAssets.assets.get(assetId) : 0n;
      const difference: bigint = inValue - outValue;
      return {
        assetName: Cardano.AssetName.toUTF8(Cardano.AssetId.getAssetName(assetId), true),
        policy: Cardano.AssetId.getPolicyId(assetId),
        quantity: difference,
        id: assetId,
      };
    }).filter(asset => asset.quantity !== 0n);
  const cardano = {
    assetName: 'cardano',
    policy: '',
    quantity: inputAssets.coins - outputAssets.coins,
    id: 'cardano'
  }
  return [cardano, ...assetsArray]
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

/**
 * Generic transaction builder using Cardano JS SDK
 * Supports any transaction with certificates, withdrawals, and outputs
 */
export async function buildCardanoTransaction({
  certificates = [],
  withdrawals = [],
  outputs = [],
  utxos,
  epochParams,
  changeAddress,
  tip,
  implicitCoin = BigInt(0)
}: {
  certificates?: Cardano.Certificate[];
  withdrawals?: Cardano.Withdrawal[];
  outputs?: Cardano.TxOut[];
  utxos: Cardano.Utxo[];
  epochParams: any;
  changeAddress: string;
  tip: any;
  implicitCoin?: bigint; // For deposits (positive) or deposit returns (negative)
}): Promise<Cardano.Tx> {
  // Check if we have epoch parameters
  if (!epochParams) {
    throw new Error('Epoch parameters not available');
  }

  // Calculate total withdrawals amount
  let totalWithdrawals = BigInt(0);
  if (withdrawals.length > 0) {
    totalWithdrawals = withdrawals.reduce((sum, withdrawal) => sum + withdrawal.quantity, BigInt(0));
  }

  // Create a change address resolver for input selection
  const changeAddressResolver: ChangeAddressResolver = {
    resolve: async (selectionSkeleton: SelectionSkeleton) => {
      // Calculate change amounts for both ADA and native tokens
      const totalInput = Array.from(selectionSkeleton.inputs).reduce((sum, [, utxo]) => sum + utxo.value.coins, BigInt(0));
      const totalOutput = Array.from(selectionSkeleton.outputs).reduce((sum, output) => sum + output.value.coins, BigInt(0));
      const implicitCost = implicitCoin + selectionSkeleton.fee;
      // Add withdrawals to the available balance (withdrawals are incoming funds)
      const changeAmount = totalInput + totalWithdrawals - totalOutput - implicitCost;

      console.log('🔧 Change address resolver called:', {
        totalInput: totalInput.toString(),
        totalOutput: totalOutput.toString(),
        totalWithdrawals: totalWithdrawals.toString(),
        implicitCoin: implicitCoin.toString(),
        skeletonFee: selectionSkeleton.fee.toString(),
        implicitCost: implicitCost.toString(),
        calculatedChange: changeAmount.toString(),
        hasExplicitOutputs: selectionSkeleton.outputs.size > 0,
        hasCertificates: certificates.length > 0,
        hasWithdrawals: withdrawals.length > 0
      });

      // Calculate change assets by aggregating all input assets and subtracting output assets
      const changeAssets = new Map<Cardano.AssetId, bigint>();


      // Add all input assets
      for (const [, utxo] of selectionSkeleton.inputs) {
        if (utxo.value.assets) {
          for (const [assetId, quantity] of utxo.value.assets) {
            const currentQuantity = changeAssets.get(assetId) || BigInt(0);
            const newQuantity = currentQuantity + quantity;
            changeAssets.set(assetId, newQuantity);
          }
        }
      }


      // Subtract all output assets
      for (const output of selectionSkeleton.outputs) {
        if (output.value.assets) {
          for (const [assetId, quantity] of output.value.assets) {
            const currentQuantity = changeAssets.get(assetId) || BigInt(0);
            const newQuantity = currentQuantity - quantity;
            if (newQuantity > BigInt(0)) {
              changeAssets.set(assetId, newQuantity);
            } else {
              changeAssets.delete(assetId);
            }
          }
        }
      }


      // CRITICAL FIX: For transactions with certificates or withdrawals (and no explicit outputs),
      // we ALWAYS need a change output to return the remaining balance to the wallet.
      // The issue is that during fee estimation, the fee might be underestimated, causing
      // changeAmount to appear negative or zero. But we still need to create the change output
      // so the actual fee calculation (with witness overhead) includes its size.
      const isCertificateOrWithdrawalOnly = (certificates.length > 0 || withdrawals.length > 0) && selectionSkeleton.outputs.size === 0;

      // Only skip change output if:
      // 1. There's definitely no change (negative or zero)
      // 2. AND there are no remaining assets
      // 3. AND this is NOT a certificate/withdrawal-only transaction
      if (changeAmount <= BigInt(0) && changeAssets.size === 0 && !isCertificateOrWithdrawalOnly) {
        console.log('🔧 No change output needed (negative change and no assets)');
        return []; // No change needed
      }

      // Ensure we have at least minimum ADA for the change output
      // For certificate/withdrawal transactions, use a reasonable minimum even if calculated change is low
      let finalChangeAmount: bigint;
      if (changeAmount > BigInt(0)) {
        finalChangeAmount = changeAmount;
      } else if (isCertificateOrWithdrawalOnly) {
        // For certificate/withdrawal transactions, ensure minimum change
        // This will be refined during input selection iterations
        finalChangeAmount = BigInt(1000000); // 1 ADA minimum
        console.log('🔧 Using minimum change for certificate/withdrawal transaction');
      } else {
        finalChangeAmount = BigInt(1000000); // 1 ADA minimum
      }

      // Create change output to a specified address
      const changeOutput: Cardano.TxOut = {
        address: changeAddress as Cardano.PaymentAddress,
        value: {
          coins: finalChangeAmount,
          assets: changeAssets
        }
      };

      console.log('🔧 Creating change output:', {
        changeAmount: finalChangeAmount.toString(),
        changeAmountAda: (Number(finalChangeAmount) / 1000000).toFixed(6),
        assetsCount: changeAssets.size
      });

      return [changeOutput];
    }
  };

  // Use Cardano JS SDK input selection
  const selector: InputSelector = roundRobinRandomImprove({
    changeAddressResolver
  });

  // Create protocol parameters for fee calculation
  const protocolParams: ProtocolParametersForInputSelection = {
    coinsPerUtxoByte: epochParams.coinsPerUtxoByte,
    maxTxSize: epochParams.maxTxSize,
    maxValueSize: epochParams.maxValueSize,
    minFeeCoefficient: epochParams.minFeeCoefficient,
    minFeeConstant: epochParams.minFeeConstant,
    prices: epochParams.prices,
    minFeeRefScriptCostPerByte: epochParams.minFeeRefScriptCostPerByte
  };

  // Create a buildTx function that properly constructs the transaction
  const buildTx: BuildTx = async (selectionSkeleton: SelectionSkeleton) => {
    // Build transaction body with selected inputs and outputs
    const txBody: Cardano.TxBody = {
      inputs: Array.from(selectionSkeleton.inputs).map(utxo => utxo[0]),
      outputs: Array.from(selectionSkeleton.outputs),
      fee: selectionSkeleton.fee,
      validityInterval: {
        invalidHereafter: Cardano.Slot(Number(tip.slot) + 3600) // 1 hour from now
      }
    };

    // Add certificates if provided
    if (certificates.length > 0) {
      txBody.certificates = certificates;
    }

    // Add withdrawals if provided
    if (withdrawals.length > 0) {
      txBody.withdrawals = withdrawals;
    }

    // Return the complete transaction
    return {
      id: Cardano.TransactionId('0'.repeat(64)),
      body: txBody,
      witness: { signatures: new Map() }
    };
  };

  // Create custom computeMinimumCost that uses our witness-aware fee calculation
  const computeMinimumCost: EstimateTxCosts = async (selectionSkeleton: SelectionSkeleton) => {
    console.log('🔧 computeMinimumCost called with skeleton:', {
      inputsCount: selectionSkeleton.inputs.size,
      outputsCount: selectionSkeleton.outputs.size,
      skeletonFee: selectionSkeleton.fee.toString()
    });

    // CRITICAL: Resolve change outputs before building transaction for fee calculation
    // The change output significantly affects transaction size and thus fee
    const changeOutputs = await changeAddressResolver.resolve(selectionSkeleton);

    // Build skeleton with change outputs included for accurate fee calculation
    const skeletonWithChange: SelectionSkeleton = {
      ...selectionSkeleton,
      outputs: new Set([...selectionSkeleton.outputs, ...changeOutputs])
    };

    // Build the transaction to get the actual structure (including change output)
    const tx = await buildTx(skeletonWithChange);

    console.log('🔧 Built transaction for fee calculation:', {
      hasCertificates: tx.body.certificates && tx.body.certificates.length > 0,
      hasWithdrawals: tx.body.withdrawals && tx.body.withdrawals.length > 0,
      inputsCount: tx.body.inputs.length,
      outputsCount: tx.body.outputs.length,
      changeOutputsCount: changeOutputs.length
    });

    // Convert selection skeleton inputs to resolved UTXOs for fee calculation
    const resolvedInputs = Array.from(selectionSkeleton.inputs);

    // Use our witness-aware fee calculation
    console.log('🔧 About to call BrowserTxConstruction.minFee');
    const fee = BrowserTxConstruction.minFee(tx, resolvedInputs, protocolParams);
    console.log('🔧 BrowserTxConstruction.minFee returned:', fee.toString());

    return { fee };
  };

  // Use SDK's constraint functions but with our custom fee calculator
  const constraints = {
    computeMinimumCost,
    computeMinimumCoinQuantity: computeMinimumCoinQuantity(protocolParams.coinsPerUtxoByte),
    tokenBundleSizeExceedsLimit: tokenBundleSizeExceedsLimit(protocolParams.maxValueSize),
    computeSelectionLimit: computeSelectionLimit(protocolParams.maxTxSize, buildTx)
  };

  // Convert UTXOs to proper format with BigInt values and ensure assets is always a Map
  const formattedUtxos: Cardano.Utxo[] = utxos.map((utxo: any) => {

    // Ensure assets is always a Map (not undefined or null)
    let assets: Map<Cardano.AssetId, bigint>;

    if (utxo[1].value.assets instanceof Map) {
      assets = utxo[1].value.assets;
    } else if (utxo[1].value.assets && typeof utxo[1].value.assets === 'object') {
      // Handle case where assets might be an object instead of Map
      assets = new Map();
      Object.entries(utxo[1].value.assets).forEach(([assetId, quantity]) => {
        assets.set(assetId as Cardano.AssetId, BigInt(quantity as any));
      });
    } else {
      assets = new Map();
    }


    return [
      utxo[0], // TxIn remains the same
      {
        ...utxo[1], // TxOut
        value: {
          coins: BigInt(utxo[1].value.coins), // Ensure BigInt
          assets: assets
        }
      }
    ];
  });


  // Convert arrays to Sets for input selection
  const utxoSet = new Set(formattedUtxos);

  // Ensure outputs have proper asset structure (Map, not undefined)
  const normalizedOutputs = outputs.map(output => ({
    ...output,
    value: {
      ...output.value,
      assets: output.value.assets || new Map()
    }
  }));

  const outputsSet = new Set<Cardano.TxOut>(normalizedOutputs);

  // Handle deposit/return as an implicit coin for input selection
  const implicitValue: ImplicitValue = {
    coin: implicitCoin !== BigInt(0) ? {
      // For deposits (positive): we need to pay a deposit (reduces available funds)
      // For deposit returns (negative): we get a deposit back (increases available funds)
      deposit: implicitCoin
    } : undefined
  };


  // Perform input selection with implicit value for deposits
  const selectionResult = await selector.select({
    preSelectedUtxo: new Set(),
    utxo: utxoSet,
    outputs: outputsSet,
    constraints,
    implicitValue
  });


  // Build the final transaction body - include both requested outputs and change outputs
  // Ensure change outputs also have proper asset structure
  const normalizedChange = selectionResult.selection.change.map(output => ({
    ...output,
    value: {
      ...output.value,
      assets: output.value.assets || new Map()
    }
  }));
  const finalOutputs = [...normalizedOutputs, ...normalizedChange];


  const txBody: Cardano.TxBody = {
    inputs: Array.from(selectionResult.selection.inputs).map(utxo => utxo[0]),
    outputs: finalOutputs,
    fee: selectionResult.selection.fee,
    validityInterval: {
      invalidHereafter: Cardano.Slot(Number(tip.slot) + 3600) // 1 hour from now
    }
  };

  // Add certificates if provided
  if (certificates.length > 0) {
    txBody.certificates = certificates;
  }

  // Add withdrawals if provided
  if (withdrawals.length > 0) {
    txBody.withdrawals = withdrawals;
  }

  // Create a final transaction
  return {
    id: Cardano.TransactionId('0'.repeat(64)), // Temporary ID
    body: txBody,
    witness: {
      signatures: new Map()
    }
  };
}

